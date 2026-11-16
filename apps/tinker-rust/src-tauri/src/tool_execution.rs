//! 工具运行与文本运行共用唯一生命周期锁、存储和 worker。
use crate::{
    run_context::ParentRunRef,
    run_controller::{ActiveRun, Inner, RunController},
    run_provider::RunProvider,
    run_store::RunStore,
    run_types::*,
    session_lifecycle::RunStatus,
    tool_journal::*,
    tool_types::*,
};
use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Instant,
};
#[derive(Clone, Debug)]
pub(crate) struct ToolActive {
    pub(crate) run: StoredToolRun,
    pub(crate) deadline: Instant,
    pub(crate) permission_deadline: Option<Instant>,
}
impl RunController {
    pub fn open_with_tools(root: impl AsRef<Path>) -> Result<Self, RunError> {
        Self::from_store_with_tools(RunStore::open(root)?)
    }
    pub(crate) fn from_store_with_tools(store: RunStore) -> Result<Self, RunError> {
        store.validate_all_layouts()?;
        // 所有日志先只读检查，确认无恢复阻塞后才允许追加任何闭合记录。
        for id in store.ids()? {
            let blocked = if store.find_location(&id)? == 3 {
                store.load_tool_run(&id)?.snapshot.recovery_required
            } else {
                store.load(&id)?.snapshot.recovery_required
            };
            if blocked {
                return Err(RunError::RecoveryRequired);
            }
        }
        let mut current = None;
        for id in store.ids()? {
            if store.find_location(&id)? == 3 {
                let mut run = store.load_tool_run(&id)?;
                if !is_terminal(run.snapshot.status) {
                    let event =
                        termination(&run, RunStatus::Interrupted, Some("interrupted".into()));
                    store.append_tool_record(&mut run, event)?;
                }
                current = Some(ActiveRun::Tools(Box::new(ToolActive {
                    run,
                    deadline: Instant::now(),
                    permission_deadline: None,
                })));
            } else {
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
        }
        Ok(Self {
            inner: Arc::new(Mutex::new(Inner {
                store,
                current,
                token: None,
                blocked: false,
                tools_enabled: true,
            })),
            worker: Mutex::new(None),
        })
    }
    /// 绑定日志写入前的只读预检；start_tools 仍在自己的锁内再次校验。
    pub(crate) fn preflight_tools(
        &self,
        parent: Option<&str>,
        input: &str,
        provider: &dyn RunProvider,
        executor: &dyn ToolExecutor,
        options: &ToolRunOptions,
    ) -> Result<(), RunError> {
        if input.trim().is_empty() {
            return Err(RunError::EmptyInput);
        }
        if input.len() > MAX_INPUT_BYTES {
            return Err(RunError::InputTooLarge);
        }
        ToolRunOptions::new(
            options.workspace_revision.clone(),
            options.permission_timeout,
            options.run_timeout,
        )?;
        if options.workspace_revision != executor.workspace_revision() {
            return Err(RunError::ToolArguments);
        }
        let inner = self.inner.lock().map_err(|_| RunError::StoreIo)?;
        if !inner.tools_enabled {
            return Err(RunError::ToolUnsupported);
        }
        if inner.blocked {
            return Err(RunError::RecoveryRequired);
        }
        let (_, _, context) = prepare_context(&inner, parent, input)?;
        provider.validate_tool_context(&context, &executor.catalog())
    }
    pub fn start_tools(
        &self,
        request_id: String,
        parent_run_id: Option<String>,
        input: String,
        provider: Arc<dyn RunProvider>,
        executor: Arc<dyn ToolExecutor>,
        options: ToolRunOptions,
    ) -> Result<ToolRunSnapshot, RunError> {
        let start = Instant::now();
        validate_id(&request_id)?;
        if input.trim().is_empty() {
            return Err(RunError::EmptyInput);
        }
        if input.len() > MAX_INPUT_BYTES {
            return Err(RunError::InputTooLarge);
        }
        ToolRunOptions::new(
            options.workspace_revision.clone(),
            options.permission_timeout,
            options.run_timeout,
        )?;
        if options.workspace_revision != executor.workspace_revision() {
            return Err(RunError::ToolArguments);
        }
        let mut handle = self.worker.lock().map_err(|_| RunError::StoreIo)?;
        let mut inner = self.inner.lock().map_err(|_| RunError::StoreIo)?;
        if !inner.tools_enabled {
            return Err(RunError::ToolUnsupported);
        }
        match inner.store.find_location(&request_id) {
            Ok(3) => {
                let run = match &inner.current {
                    Some(ActiveRun::Tools(active)) if active.run.snapshot.run_id == request_id => {
                        active.run.clone()
                    }
                    _ => inner.store.load_tool_run(&request_id)?,
                };
                if run.header.input != input
                    || run.header.workspace_revision != options.workspace_revision
                    || run.header.parent.as_ref().map(|p| &p.run_id) != parent_run_id.as_ref()
                {
                    return Err(RunError::RequestConflict);
                }
                return Ok(run.snapshot);
            }
            Ok(_) => return Err(RunError::RequestConflict),
            Err(RunError::RunNotFound) => {}
            Err(e) => return Err(e),
        }
        if inner.blocked {
            return Err(RunError::RecoveryRequired);
        }
        if inner
            .current
            .as_ref()
            .is_some_and(|r| !is_terminal(r.status()))
        {
            return Err(RunError::RunBusy);
        }
        drop(inner);
        if let Some(worker) = handle.take() {
            worker.join().map_err(|_| RunError::StoreIo)?;
        }
        inner = self.inner.lock().map_err(|_| RunError::StoreIo)?;
        let (order, parent, context) = prepare_context(&inner, parent_run_id.as_deref(), &input)?;
        let tools = executor.catalog();
        provider.validate_tool_context(&context, &tools)?;
        let header = ToolRunHeader {
            storage_version: 3,
            policy_version: 1,
            run_id: request_id.clone(),
            input,
            created_order: order,
            parent,
            workspace_revision: options.workspace_revision,
        };
        let run = match inner.store.create_tool_run(header) {
            Ok(r) => r,
            Err(e) => {
                inner.blocked = true;
                return Err(e);
            }
        };
        inner.current = Some(ActiveRun::Tools(Box::new(ToolActive {
            run,
            deadline: start + options.run_timeout,
            permission_deadline: None,
        })));
        let token = Arc::new(AtomicBool::new(false));
        inner.token = Some(token.clone());
        append(&mut inner, ToolRecordKind::Started)?;
        let snapshot = active(&inner)?.run.snapshot.clone();
        drop(inner);
        let state = Arc::downgrade(&self.inner);
        let id = request_id;
        let spawned = std::thread::Builder::new()
            .name("rust-tool-provider".into())
            .spawn(move || {
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    super::tool_worker::run(
                        &state,
                        &id,
                        context,
                        &*provider,
                        &*executor,
                        &tools,
                        &token,
                        options.permission_timeout,
                    )
                }))
                .unwrap_or(Err(RunError::ProviderPanicked));
                if let Some(state) = state.upgrade() {
                    if let Ok(mut inner) = state.lock() {
                        if !token.load(Ordering::Acquire) {
                            let _ = finish(&mut inner, result);
                        }
                    }
                }
            });
        match spawned {
            Ok(worker) => {
                *handle = Some(worker);
                Ok(snapshot)
            }
            Err(_) => {
                let mut inner = self.inner.lock().map_err(|_| RunError::StoreIo)?;
                finish(&mut inner, Err(RunError::StoreIo))?;
                Err(RunError::StoreIo)
            }
        }
    }
    pub fn read_tools(
        &self,
        run_id: &str,
        after_sequence: u64,
        limit: usize,
    ) -> Result<ToolEventPage, RunError> {
        validate_id(run_id)?;
        if limit == 0 || limit > 256 {
            return Err(RunError::InvalidLimit);
        }
        let inner = self.inner.lock().map_err(|_| RunError::StoreIo)?;
        let run = match &inner.current {
            Some(ActiveRun::Tools(active)) if active.run.snapshot.run_id == run_id => {
                active.run.clone()
            }
            _ => inner.store.load_tool_run(run_id)?,
        };
        if after_sequence > run.snapshot.sequence {
            return Err(RunError::InvalidCursor);
        }
        let events: Vec<_> = run
            .events
            .into_iter()
            .filter(|e| e.sequence > after_sequence)
            .take(limit)
            .collect();
        let next_after_sequence = events.last().map_or(after_sequence, |e| e.sequence);
        Ok(ToolEventPage {
            has_more: next_after_sequence < run.snapshot.sequence,
            snapshot: run.snapshot,
            events,
            next_after_sequence,
        })
    }
    pub fn respond_permission(
        &self,
        run_id: &str,
        reply: PermissionReply,
    ) -> Result<PermissionReceipt, RunError> {
        validate_id(run_id)?;
        if !matches!(
            reply.decision,
            PermissionDecision::Granted | PermissionDecision::Denied
        ) {
            return Err(RunError::PermissionConflict);
        }
        let mut inner = self.inner.lock().map_err(|_| RunError::StoreIo)?;
        let historical;
        let run = match &inner.current {
            Some(ActiveRun::Tools(a)) if a.run.snapshot.run_id == run_id => &a.run,
            _ => {
                historical = inner.store.load_tool_run(run_id)?;
                &historical
            }
        };
        for event in &run.events {
            if let ToolRecordKind::PermissionResolved { receipt } = &event.event {
                if receipt.permission_id == reply.permission_id {
                    return if receipt.decision == reply.decision {
                        Ok(receipt.clone())
                    } else {
                        Err(RunError::PermissionConflict)
                    };
                }
            }
        }
        if is_terminal(run.snapshot.status) {
            return Err(RunError::PermissionExpired);
        }
        let a = active(&inner)?;
        if a.run.snapshot.run_id != run_id {
            return Err(RunError::PermissionNotFound);
        }
        if a.run.snapshot.pending.as_ref().map(|p| &p.permission_id) != Some(&reply.permission_id) {
            return Err(RunError::PermissionNotFound);
        }
        if Instant::now() >= a.deadline {
            finish(&mut inner, Err(RunError::RunTimeout))?;
            return Err(RunError::PermissionExpired);
        }
        if a.permission_deadline.is_none_or(|d| Instant::now() >= d) {
            resolve(&mut inner, PermissionDecision::Expired)?;
            return Err(RunError::PermissionExpired);
        }
        resolve(&mut inner, reply.decision)
    }
    pub fn cancel_tools(&self, run_id: &str) -> Result<ToolRunSnapshot, RunError> {
        validate_id(run_id)?;
        let mut inner = self.inner.lock().map_err(|_| RunError::StoreIo)?;
        if inner.current.as_ref().is_none_or(|r| r.id() != run_id) {
            let run = inner.store.load_tool_run(run_id)?;
            return if is_terminal(run.snapshot.status) {
                Ok(run.snapshot)
            } else {
                Err(RunError::RecoveryRequired)
            };
        }
        if !is_terminal(active(&inner)?.run.snapshot.status) {
            if let Some(token) = &inner.token {
                token.store(true, Ordering::Release);
            }
            let event = termination(&active(&inner)?.run, RunStatus::Cancelled, None);
            append(&mut inner, event)?;
        }
        Ok(active(&inner)?.run.snapshot.clone())
    }
}
pub(crate) fn active(inner: &Inner) -> Result<&ToolActive, RunError> {
    match &inner.current {
        Some(ActiveRun::Tools(a)) => Ok(a),
        _ => Err(RunError::RunNotFound),
    }
}
pub(crate) fn active_mut(inner: &mut Inner) -> Result<&mut ToolActive, RunError> {
    match &mut inner.current {
        Some(ActiveRun::Tools(a)) => Ok(a),
        _ => Err(RunError::RunNotFound),
    }
}
pub(crate) fn append(inner: &mut Inner, event: ToolRecordKind) -> Result<(), RunError> {
    let Some(ActiveRun::Tools(a)) = &mut inner.current else {
        return Err(RunError::RunNotFound);
    };
    if inner.blocked {
        return Err(RunError::RecoveryRequired);
    }
    if let Err(error) = inner.store.append_tool_record(&mut a.run, event) {
        if a.run.snapshot.recovery_required
            || matches!(
                error,
                RunError::StoreIo | RunError::UnsafePath | RunError::RecoveryRequired
            )
        {
            inner.blocked = true;
            a.run.snapshot.recovery_required = true;
            if let Some(token) = &inner.token {
                token.store(true, Ordering::Release);
            }
        }
        return Err(error);
    }
    Ok(())
}
pub(crate) fn resolve(
    inner: &mut Inner,
    decision: PermissionDecision,
) -> Result<PermissionReceipt, RunError> {
    let a = active(inner)?;
    let receipt = PermissionReceipt {
        permission_id: a
            .run
            .snapshot
            .pending
            .as_ref()
            .ok_or(RunError::PermissionNotFound)?
            .permission_id
            .clone(),
        decision,
        sequence: a.run.snapshot.sequence + 1,
    };
    append(
        inner,
        ToolRecordKind::PermissionResolved {
            receipt: receipt.clone(),
        },
    )?;
    Ok(receipt)
}
pub(crate) fn finish(inner: &mut Inner, result: Result<(), RunError>) -> Result<(), RunError> {
    let a = active(inner)?;
    if is_terminal(a.run.snapshot.status) {
        return Ok(());
    }
    let result = if result.is_ok() && Instant::now() >= a.deadline {
        Err(RunError::RunTimeout)
    } else {
        result
    };
    let (status, error) = match result {
        Ok(()) => (RunStatus::Completed, None),
        Err(e) => (RunStatus::Failed, Some(e.code().into())),
    };
    let event = termination(&a.run, status, error);
    append(inner, event)
}
fn termination(
    run: &StoredToolRun,
    status: RunStatus,
    error_code: Option<String>,
) -> ToolRecordKind {
    let closed_call = match run.snapshot.transcript.messages.last() {
        Some(TranscriptMessage::Assistant {
            call: Some(call), ..
        }) => Some(ToolResult {
            call_id: call.call_id.clone(),
            outcome: match status {
                RunStatus::Cancelled => ToolOutcome::Cancelled,
                RunStatus::Interrupted => ToolOutcome::Interrupted,
                _ => ToolOutcome::Failed,
            },
            content: "Tool execution closed.".into(),
        }),
        _ => None,
    };
    ToolRecordKind::Terminated {
        status,
        error_code,
        closed_call,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sync_failure_before_worker_creation_permits_zero_provider_calls() {
        struct Provider(Arc<std::sync::atomic::AtomicUsize>);
        impl RunProvider for Provider {
            fn execute(
                &self,
                _: &str,
                _: &AtomicBool,
                _: &mut dyn FnMut(&str) -> Result<(), RunError>,
            ) -> Result<(), RunError> {
                unreachable!()
            }
            fn execute_tool_round(
                &self,
                _: &ToolContext,
                _: &[ToolSpec],
                _: &AtomicBool,
                _: std::time::Duration,
                _: &mut dyn FnMut(&str) -> Result<(), RunError>,
            ) -> Result<ToolRoundOutput, RunError> {
                self.0.fetch_add(1, Ordering::SeqCst);
                Ok(ToolRoundOutput::Stop)
            }
        }
        let root_path = std::fs::canonicalize(std::env::temp_dir())
            .unwrap()
            .join(format!(
                "tinker-tauri-formal-preview-tool-sync-{}",
                std::process::id()
            ));
        let root = crate::formal_platform::TrustedRoot::create_temporary(root_path).unwrap();
        let executor =
            Arc::new(crate::synthetic_workspace::SyntheticWorkspace::create(&root).unwrap());
        let store = RunStore::open(root.path()).unwrap();
        store.fail_tool_sync.store(true, Ordering::Relaxed);
        let c = RunController::from_store_with_tools(store).unwrap();
        let count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let options = ToolRunOptions::new(
            executor.workspace_revision().into(),
            std::time::Duration::from_secs(1),
            std::time::Duration::from_secs(2),
        )
        .unwrap();
        assert!(c
            .start_tools(
                "sync1".into(),
                None,
                "read".into(),
                Arc::new(Provider(count.clone())),
                executor,
                options
            )
            .is_err());
        assert_eq!(count.load(Ordering::SeqCst), 0);
        assert!(
            c.read_tools("sync1", 0, 256)
                .unwrap()
                .snapshot
                .recovery_required
        );
    }
}

#[cfg(test)]
#[path = "tool_execution_regression_tests.rs"]
mod regression_tests;

/// 同一只读父链构造用于 Bind 前与真正创建 run 前，两次均按将分配的顺序校验。
fn prepare_context(
    inner: &Inner,
    parent: Option<&str>,
    input: &str,
) -> Result<(u64, Option<ParentRunRef>, ToolContext), RunError> {
    let order = inner.store.next_created_order()?;
    let parent = parent
        .map(|id| -> Result<_, RunError> {
            validate_id(id)?;
            let sequence = if inner.store.find_location(id)? == 3 {
                inner.store.load_tool_run(id)?.snapshot.sequence
            } else {
                inner.store.load(id)?.snapshot.sequence
            };
            Ok(ParentRunRef {
                run_id: id.into(),
                sequence,
            })
        })
        .transpose()?;
    let context = inner
        .store
        .tool_context_for(parent.as_ref(), order, input)?;
    Ok((order, parent, context))
}
