//! 单活动执行的线程控制；事件提交后才更新可见状态，终态拒绝晚到片段。
use crate::{
    run_context::{RunContext, RunLineage},
    run_provider::RunProvider,
    run_store::{RunStore, StoredRun},
    run_types::*,
    session_lifecycle::RunStatus,
};
use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, Weak,
    },
    thread::{self, JoinHandle},
};
#[derive(Debug)]
pub(crate) struct Inner {
    pub(crate) store: RunStore,
    pub(crate) current: Option<ActiveRun>,
    pub(crate) token: Option<Arc<AtomicBool>>,
    pub(crate) blocked: bool,
    pub(crate) tools_enabled: bool,
}
#[derive(Debug)]
pub struct RunController {
    pub(crate) inner: Arc<Mutex<Inner>>,
    pub(crate) worker: Mutex<Option<JoinHandle<()>>>,
}
impl RunController {
    pub(crate) fn authorize_redirect(
        &self,
        child: String,
        parent: crate::run_context::ParentRunRef,
    ) -> Result<(), RunError> {
        let mut inner = self.inner.lock().map_err(|_| RunError::StoreIo)?;
        inner.store.redirects.insert(child, parent);
        Ok(())
    }

    pub(crate) fn preflight_text_context(
        &self,
        request: &str,
        parent: Option<&str>,
        input: &str,
    ) -> Result<RunContext, RunError> {
        self.preflight_text_context_with_redirect(request, parent, input, None)
    }
    pub(crate) fn preflight_text_context_with_redirect(
        &self,
        request: &str,
        parent: Option<&str>,
        input: &str,
        redirect_sequence: Option<u64>,
    ) -> Result<RunContext, RunError> {
        let mut inner = self.inner.lock().map_err(|_| RunError::StoreIo)?;
        // 仅为已验证队列边的只读预算预检临时安装许可；返回前恢复，不发布执行权。
        let prior = if let Some(sequence) = redirect_sequence {
            let run_id = parent.ok_or(RunError::CorruptLog)?.to_owned();
            Some(inner.store.redirects.insert(
                request.to_owned(),
                crate::run_context::ParentRunRef { run_id, sequence },
            ))
        } else {
            None
        };
        let result = match parent {
            Some(parent) => inner
                .store
                .continuation_for_child(request, parent, input)
                .map(|(context, _)| context),
            None => Ok(RunContext::single(input)),
        };
        if let Some(prior) = prior {
            match prior {
                Some(proof) => {
                    inner.store.redirects.insert(request.to_owned(), proof);
                }
                None => {
                    inner.store.redirects.remove(request);
                }
            }
        }
        result
    }
    pub fn open(root: impl AsRef<Path>) -> Result<Self, RunError> {
        Self::from_store(RunStore::open(root)?)
    }
    /// 正式服务在持锁的全局预检成功后才进入恢复阶段。
    pub(crate) fn from_store(store: RunStore) -> Result<Self, RunError> {
        store.validate_all()?;
        let mut current = None;
        for id in store.ids()? {
            let mut run = store.load(&id)?;
            if !is_terminal(run.snapshot.status) {
                store.append(
                    &mut run,
                    RunRecordKind::Interrupted,
                    None,
                    Some("processInterrupted".into()),
                )?;
            }
            current = Some(ActiveRun::Text(Box::new(run)));
        }
        Ok(Self {
            inner: Arc::new(Mutex::new(Inner {
                store,
                current,
                token: None,
                blocked: false,
                tools_enabled: false,
            })),
            worker: Mutex::new(None),
        })
    }
    /// scenario仅用于旧日志及请求去重；执行行为完全由宿主注入的provider决定。
    pub fn start_with_provider(
        &self,
        request_id: String,
        input: String,
        scenario: OfflineScenario,
        provider: Arc<dyn RunProvider>,
    ) -> Result<RunSnapshot, RunError> {
        self.start_inner(request_id, input, scenario, provider, None)
    }
    pub fn continue_with_provider(
        &self,
        request_id: String,
        parent_run_id: String,
        input: String,
        scenario: OfflineScenario,
        provider: Arc<dyn RunProvider>,
    ) -> Result<RunSnapshot, RunError> {
        validate_id(&parent_run_id)?;
        if request_id == parent_run_id {
            return Err(RunError::RequestConflict);
        }
        self.start_inner(request_id, input, scenario, provider, Some(parent_run_id))
    }
    fn start_inner(
        &self,
        request_id: String,
        input: String,
        scenario: OfflineScenario,
        provider: Arc<dyn RunProvider>,
        parent_id: Option<String>,
    ) -> Result<RunSnapshot, RunError> {
        validate_id(&request_id)?;
        if input.trim().is_empty() {
            return Err(RunError::EmptyInput);
        }
        if input.len() > MAX_INPUT_BYTES {
            return Err(RunError::InputTooLarge);
        }
        let mut handle = self.worker.lock().map_err(|_| RunError::StoreIo)?;
        {
            let mut inner = self.inner.lock().map_err(|_| RunError::StoreIo)?;
            let is_current = inner
                .current
                .as_ref()
                .is_some_and(|run| run.id() == request_id);
            let previous = if is_current {
                inner.store.find_location(&request_id)?;
                inner
                    .current
                    .as_ref()
                    .map(|r| r.text().cloned())
                    .transpose()?
            } else {
                match inner.store.load(&request_id) {
                    Ok(run) => Some(run),
                    Err(RunError::RunNotFound) => None,
                    Err(error) => return Err(error),
                }
            };
            if let Some(run) = previous {
                if !is_current && !is_terminal(run.snapshot.status) {
                    inner.blocked = true;
                    return Err(RunError::RecoveryRequired);
                }
                let same_lineage = match (&run.lineage, &parent_id) {
                    (RunLineage::Standalone, None) => true,
                    (RunLineage::Continuation { parent, .. }, Some(id)) => parent.run_id == *id,
                    _ => false,
                };
                return if run.snapshot.input == input
                    && run.snapshot.scenario == scenario
                    && same_lineage
                {
                    Ok(run.snapshot)
                } else {
                    Err(RunError::RequestConflict)
                };
            }
            if inner.blocked {
                return Err(RunError::RecoveryRequired);
            }
            if inner
                .current
                .as_ref()
                .is_some_and(|run| !is_terminal(run.status()))
            {
                return Err(RunError::RunBusy);
            }
        }
        // 旧线程的令牌已取消或它已进入终态，释放状态锁后回收，避免与回调互等。
        if let Some(previous) = handle.take() {
            previous.join().map_err(|_| RunError::StoreIo)?;
        }
        let mut inner = self.inner.lock().map_err(|_| RunError::StoreIo)?;
        let (context, parent) = match parent_id {
            Some(id) => {
                let (context, parent) =
                    inner
                        .store
                        .continuation_for_child(&request_id, &id, &input)?;
                (context, Some(parent))
            }
            None => (RunContext::single(&input), None),
        };
        let created = match parent {
            Some(parent) => {
                inner
                    .store
                    .create_continuation(&request_id, input.clone(), scenario, parent)
            }
            None => inner.store.create(&request_id, input.clone(), scenario),
        };
        let mut run = match created {
            Ok(run) => run,
            Err(error) => {
                // 写入或同步失败可能留下已存在但未确认的元数据，须重启恢复后再执行。
                inner.blocked = true;
                if let Ok(mut run) = inner.store.load(&request_id) {
                    mark_storage_failure(&mut run, error);
                    inner.current = Some(ActiveRun::Text(Box::new(run)));
                }
                return Err(error);
            }
        };
        if let Err(error) = inner
            .store
            .append(&mut run, RunRecordKind::Started, None, None)
        {
            mark_storage_failure(&mut run, error);
            inner.current = Some(ActiveRun::Text(Box::new(run)));
            inner.blocked = true;
            return Err(error);
        }
        let snapshot = run.snapshot.clone();
        let token = Arc::new(AtomicBool::new(false));
        inner.current = Some(ActiveRun::Text(Box::new(run)));
        inner.token = Some(token.clone());
        drop(inner);
        let weak = Arc::downgrade(&self.inner);
        let worker_id = request_id;
        let spawned = thread::Builder::new()
            .name("rust-run-provider".into())
            .spawn(move || execute(weak, worker_id, context, provider, token));
        match spawned {
            Ok(worker) => {
                *handle = Some(worker);
                Ok(snapshot)
            }
            Err(_) => {
                let mut inner = self.inner.lock().map_err(|_| RunError::StoreIo)?;
                finish(&mut inner, &snapshot.run_id, Err(RunError::StoreIo));
                Err(RunError::StoreIo)
            }
        }
    }
    pub fn cancel(&self, run_id: &str) -> Result<RunSnapshot, RunError> {
        validate_id(run_id)?;
        {
            let inner = self.inner.lock().map_err(|_| RunError::StoreIo)?;
            if inner
                .current
                .as_ref()
                .is_some_and(|r| matches!(r, ActiveRun::Tools(_)) && r.id() == run_id)
            {
                drop(inner);
                self.cancel_tools(run_id)?;
                return Err(RunError::UnsupportedVersion);
            }
        }
        let mut inner = self.inner.lock().map_err(|_| RunError::StoreIo)?;
        if inner.current.as_ref().is_some_and(|run| run.id() == run_id) {
            // 内存终态可能来自未确认的写入失败，不能据此证明安全取消。
            if inner
                .current
                .as_ref()
                .ok_or(RunError::RunNotFound)?
                .text()?
                .snapshot
                .recovery_required
            {
                return Err(RunError::RecoveryRequired);
            }
            if inner
                .current
                .as_ref()
                .is_some_and(|run| is_terminal(run.status()))
            {
                return Ok(inner.current.as_ref().unwrap().text()?.snapshot.clone());
            }
            if let Some(token) = &inner.token {
                token.store(true, Ordering::Release);
            }
            let Inner {
                store,
                current,
                blocked,
                ..
            } = &mut *inner;
            let run = current.as_mut().ok_or(RunError::RunNotFound)?.text_mut()?;
            if let Err(error) = store.append(run, RunRecordKind::Cancelled, None, None) {
                mark_storage_failure(run, error);
                *blocked = true;
                return Err(error);
            }
            return Ok(run.snapshot.clone());
        }
        let run = inner.store.load(run_id)?;
        if is_terminal(run.snapshot.status) {
            Ok(run.snapshot)
        } else {
            Err(RunError::RecoveryRequired)
        }
    }
    pub fn read(
        &self,
        run_id: Option<&str>,
        after_sequence: u64,
        limit: usize,
    ) -> Result<RunEventPage, RunError> {
        if limit == 0 || limit > 256 {
            return Err(RunError::InvalidLimit);
        }
        let inner = self.inner.lock().map_err(|_| RunError::StoreIo)?;
        let id = run_id
            .or_else(|| inner.current.as_ref().map(|run| run.id()))
            .ok_or(RunError::RunNotFound)?;
        validate_id(id)?;
        let run = if inner.current.as_ref().is_some_and(|run| run.id() == id) {
            inner
                .current
                .as_ref()
                .map(|r| r.text().cloned())
                .transpose()?
                .ok_or(RunError::RunNotFound)?
        } else {
            inner.store.load(id)?
        };
        if after_sequence > run.snapshot.sequence {
            return Err(RunError::InvalidCursor);
        }
        let events: Vec<_> = run
            .events
            .into_iter()
            .filter(|event| event.sequence > after_sequence)
            .take(limit)
            .collect();
        let next_after_sequence = events.last().map_or(after_sequence, |event| event.sequence);
        Ok(RunEventPage {
            protocol_version: PROTOCOL_VERSION,
            has_more: next_after_sequence < run.snapshot.sequence,
            snapshot: run.snapshot,
            events,
            next_after_sequence,
        })
    }
}
impl Drop for RunController {
    fn drop(&mut self) {
        if let Ok(inner) = self.inner.lock() {
            if let Some(token) = &inner.token {
                token.store(true, Ordering::Release);
            }
        }
        if let Ok(mut worker) = self.worker.lock() {
            if let Some(worker) = worker.take() {
                let _ = worker.join();
            }
        }
    }
}
fn execute(
    inner: Weak<Mutex<Inner>>,
    id: String,
    context: RunContext,
    provider: Arc<dyn RunProvider>,
    token: Arc<AtomicBool>,
) {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        provider.execute_context(&context, &token, &mut |text| {
            let state = inner.upgrade().ok_or(RunError::RecoveryRequired)?;
            let mut state = state.lock().map_err(|_| RunError::StoreIo)?;
            if token.load(Ordering::Acquire) {
                return Ok(());
            }
            let Inner {
                store,
                current,
                blocked,
                ..
            } = &mut *state;
            let run = current.as_mut().ok_or(RunError::RunNotFound)?.text_mut()?;
            if run.snapshot.run_id != id || is_terminal(run.snapshot.status) {
                return Ok(());
            }
            match store.append(run, RunRecordKind::Delta, Some(text.into()), None) {
                Ok(()) => Ok(()),
                Err(RunError::RunLimitExceeded) => Err(RunError::RunLimitExceeded),
                Err(error) => {
                    mark_storage_failure(run, error);
                    *blocked = true;
                    token.store(true, Ordering::Release);
                    Err(error)
                }
            }
        })
    }))
    .unwrap_or(Err(RunError::ProviderPanicked));
    if token.load(Ordering::Acquire) {
        return;
    }
    if let Some(inner) = inner.upgrade() {
        if let Ok(mut inner) = inner.lock() {
            finish(&mut inner, &id, result);
        }
    }
}
fn finish(inner: &mut Inner, id: &str, result: Result<(), RunError>) {
    let Some(ActiveRun::Text(run)) = inner.current.as_mut() else {
        return;
    };
    if run.snapshot.run_id != id || is_terminal(run.snapshot.status) {
        return;
    }
    let (kind, error_code) = match result {
        Ok(()) => (RunRecordKind::Completed, None),
        Err(error) => (RunRecordKind::Failed, Some(error.code().into())),
    };
    if let Err(error) = inner.store.append(run, kind, None, error_code) {
        mark_storage_failure(run, error);
        inner.blocked = true;
    }
}
fn mark_storage_failure(run: &mut StoredRun, error: RunError) {
    run.snapshot.status = RunStatus::Failed;
    run.snapshot.error_code = Some(error.code().into());
    run.snapshot.recovery_required = true;
}

#[derive(Clone, Debug)]
pub(crate) enum ActiveRun {
    Text(Box<StoredRun>),
    Tools(Box<crate::tool_execution::ToolActive>),
}
impl ActiveRun {
    pub(crate) fn id(&self) -> &str {
        match self {
            Self::Text(r) => &r.snapshot.run_id,
            Self::Tools(r) => &r.run.snapshot.run_id,
        }
    }
    pub(crate) fn status(&self) -> RunStatus {
        match self {
            Self::Text(r) => r.snapshot.status,
            Self::Tools(r) => r.run.snapshot.status,
        }
    }
    fn text(&self) -> Result<&StoredRun, RunError> {
        match self {
            Self::Text(r) => Ok(r),
            _ => Err(RunError::UnsupportedVersion),
        }
    }
    fn text_mut(&mut self) -> Result<&mut StoredRun, RunError> {
        match self {
            Self::Text(r) => Ok(r),
            _ => Err(RunError::UnsupportedVersion),
        }
    }
}
