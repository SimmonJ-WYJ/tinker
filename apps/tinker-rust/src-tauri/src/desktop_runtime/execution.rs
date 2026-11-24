//! 请求先绑定后执行；每个会话仅继承最近成功祖先。
use super::document_send::{DocumentRead, DocumentSource, ExcerptProvider};
use super::{
    protocol::*,
    session::{Binding, Entry, Turn},
    Inner,
};
use crate::formal_documents::DocumentSelection;
use crate::{
    run_types::{is_terminal, RunError, MAX_INPUT_BYTES},
    session_lifecycle::RunStatus,
};
use serde_json::{json, Value};
pub(crate) struct ResolvedTextRetry {
    pub send: Send,
    pub is_new: bool,
    pub document: Option<DocumentSelection>,
}
/// 重试只接受持久身份。本次输入、渠道、模型和 effort 均由原始 binding 决定。
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TextRetry {
    pub session_id: String,
    pub request_id: String,
    pub started_at: u64,
    pub retry_of_request_id: String,
}
impl super::DesktopRuntime {
    pub(crate) fn interrupt_text(&self, session: &str, request: &str) -> Result<()> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| DesktopError("runtimeUnavailable"))?;
        inner.binding(session, request)?;
        let controller = inner
            .controllers
            .get(session)
            .ok_or(DesktopError("sessionNotFound"))?;
        match controller.interrupt_text(request) {
            Ok(_) | Err(RunError::RunNotFound) => Ok(()),
            Err(error) => Err(error.into()),
        }
    }
    pub(crate) fn superseded_request(&self, session: &str, request: &str) -> Result<bool> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| DesktopError("runtimeUnavailable"))?;
        Ok(inner.bindings.get(session).is_some_and(|bindings| {
            bindings
                .last()
                .is_some_and(|last| last.request.request_id != request)
                && bindings.iter().any(|b| b.request.request_id == request)
        }))
    }
    /// 复用原请求和文档选区，仅新执行需要再次检查最新任务。
    pub(crate) fn resolve_text_retry(&self, retry: TextRetry) -> Result<ResolvedTextRetry> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| DesktopError("runtimeUnavailable"))?;
        let source = inner.binding(&retry.session_id, &retry.retry_of_request_id)?;
        let bindings = &inner.bindings[&retry.session_id];
        let queued = inner.chains.contains_key(&retry.retry_of_request_id)
            || inner.chains.values().any(|chain| {
                chain
                    .messages
                    .iter()
                    .any(|message| message.input.uuid == retry.retry_of_request_id)
            });
        if (inner.queue_enabled && !inner.managed)
            || queued
            || inner.tools.contains_key(&source.request.profile_id)
            || retry.request_id == retry.retry_of_request_id
            || !matches!(
                inner.turn(source)?.status,
                RunStatus::Failed | RunStatus::Interrupted
            )
        {
            return Err(DesktopError("requestConflict"));
        }
        let document = source.document_source.as_ref().map(|d| d.selection());
        let mut next = source.request.clone();
        next.request_id = retry.request_id;
        next.started_at = retry.started_at;
        validate_send(&next)?;
        // 已接受的相同请求只回读回执，后续会话活动、渠道变更均不得触发重发。
        if let Some(index) = bindings
            .iter()
            .position(|b| b.request.request_id == next.request_id)
        {
            if index > 0
                && bindings[index - 1].request.request_id == source.request.request_id
                && bindings[index].request == next
                && bindings[index].document_source == source.document_source
            {
                return Ok(ResolvedTextRetry {
                    send: next,
                    is_new: false,
                    document,
                });
            }
            return Err(DesktopError("requestConflict"));
        }
        if bindings.last() != Some(source) {
            return Err(DesktopError("requestConflict"));
        }
        if inner
            .profiles
            .get(&next.profile_id)
            .is_none_or(|p| p.config_revision != source.config_revision)
            || inner.availability.as_ref().is_some_and(|available| {
                available
                    .get(&next.profile_id)
                    .is_none_or(|models| !models.contains(&next.model_id))
            })
        {
            return Err(DesktopError(if inner.managed {
                "sourceChannelUnavailable"
            } else {
                "requestConflict"
            }));
        }
        Ok(ResolvedTextRetry {
            send: next,
            is_new: true,
            document,
        })
    }
}
pub(super) fn validate_send(p: &Send) -> Result<()> {
    for value in [&p.request_id, &p.session_id, &p.profile_id] {
        id(value)?;
    }
    model_id(&p.model_id)?;
    if p.user_message.trim().is_empty() {
        return Err(DesktopError("emptyInput"));
    }
    if p.user_message.len() > MAX_INPUT_BYTES {
        return Err(DesktopError("inputTooLarge"));
    }
    if p.started_at > MAX_SAFE_INTEGER {
        return Err(DesktopError("invalidTime"));
    }
    if p.effort
        .as_ref()
        .is_some_and(|e| !matches!(e.as_str(), "low" | "medium" | "high" | "max"))
    {
        return Err(DesktopError("invalidParams"));
    }
    Ok(())
}
impl Inner {
    pub(super) fn turn(&self, b: &Binding) -> Result<Turn> {
        let c = self
            .controllers
            .get(&b.request.session_id)
            .ok_or(DesktopError("sessionNotFound"))?;
        let snapshot = match c.read(Some(&b.request.request_id), 0, 1) {
            Ok(page) => Some(page.snapshot),
            Err(RunError::UnsupportedVersion) => {
                let t = c.read_tools(&b.request.request_id, 0, 1)?.snapshot;
                return Ok(super::tools::project_tool_turn(b, &t));
            }
            Err(RunError::RunNotFound) => None,
            Err(e) => return Err(e.into()),
        };
        Ok(project_turn(b, snapshot))
    }
    pub(super) fn send(&mut self, p: Send) -> Result<Value> {
        self.send_with_reference(p, None)
    }
    pub(super) fn send_with_reference(
        &mut self,
        p: Send,
        reference: Option<DocumentRead<'_>>,
    ) -> Result<Value> {
        if !(self.managed
            && self
                .bindings
                .values()
                .flatten()
                .any(|b| b.request.request_id == p.request_id))
            && self
                .chains
                .values()
                .any(|c| c.session_id == p.session_id && c.closure.is_none())
        {
            return Err(DesktopError("runBusy"));
        }
        self.send_inner(p, false, reference)
    }
    pub(super) fn send_inner(
        &mut self,
        p: Send,
        begin: bool,
        reference: Option<DocumentRead<'_>>,
    ) -> Result<Value> {
        validate_send(&p)?;
        let session = self.session(&p.session_id)?;
        self.require_import_seed(&p.session_id)?;
        if self.imported.contains_key(&p.session_id) && self.tools.contains_key(&p.profile_id) {
            return Err(DesktopError("contextUnsupported"));
        }
        for bindings in self.bindings.values() {
            if let Some(b) = bindings
                .iter()
                .find(|b| b.request.request_id == p.request_id)
            {
                return if b.request == p
                    && b.document_source
                        .as_ref()
                        .map(DocumentSource::selection)
                        .as_ref()
                        == reference.as_ref().map(|r| r.selection)
                    && self.binding_revision_matches(b)
                {
                    self.turn_reply(b)
                } else {
                    Err(DesktopError("requestConflict"))
                };
            }
        }
        let profile = self
            .profiles
            .get(&p.profile_id)
            .ok_or(DesktopError("profileNotFound"))?;
        self.require_available(&p.profile_id, &p.model_id)?;
        let provider = profile.provider(&p.model_id, p.effort.as_deref())?;
        if begin || self.managed {
            provider.validate_tool_metadata(&json!(p))?;
        }
        if self.request_count(&p.session_id) >= MAX_REQUESTS {
            return Err(DesktopError("requestLimit"));
        }
        let mut active = 0;
        let mut parent = None;
        for (sid, list) in &self.bindings {
            for b in list {
                let t = self.turn(b)?;
                if !is_terminal(t.status) {
                    if *sid == p.session_id {
                        return Err(DesktopError("runBusy"));
                    }
                    active += 1;
                }
                if *sid == p.session_id && t.status == RunStatus::Completed {
                    parent = Some(b.request.request_id.clone());
                }
            }
        }
        if active >= MAX_ACTIVE {
            return Err(DesktopError("activeLimit"));
        }
        // 文本路径不能把工具祖先降级；在不可变 Bind 落盘前拒绝。
        if !self.tools.contains_key(&p.profile_id) {
            if let Some(parent) = &parent {
                let c = self
                    .controllers
                    .get(&p.session_id)
                    .ok_or(DesktopError("sessionNotFound"))?;
                if c.read_tools(parent, 0, 1).is_ok() {
                    return Err(DesktopError("contextUnsupported"));
                }
            }
        }
        if let Some(tool) = self.tools.get(&p.profile_id) {
            self.controllers
                .get(&p.session_id)
                .ok_or(DesktopError("sessionNotFound"))?
                .preflight_tools(
                    &p.request_id,
                    parent.as_deref(),
                    &p.user_message,
                    provider.as_ref(),
                    tool.executor.as_ref(),
                    &tool.options,
                )?;
        }
        self.import_preflight(
            &p.session_id,
            &p.request_id,
            parent.as_deref(),
            &p.user_message,
            &p.profile_id,
        )?;
        let controller = self
            .controllers
            .get(&p.session_id)
            .ok_or(DesktopError("sessionNotFound"))?;
        controller.require_confirmed_storage()?;
        // 只有首次绑定读取原文；重放已从上面的相同选区回执返回。
        let excerpt = reference.map(DocumentRead::resolve).transpose()?;
        let document_source = excerpt.as_ref().map(DocumentSource::from_excerpt);
        let provider = if let Some(excerpt) = excerpt {
            let provider = ExcerptProvider::new(provider, excerpt);
            let context = controller.preflight_text_context(
                &p.request_id,
                parent.as_deref(),
                &p.user_message,
            )?;
            self.import_validate_context(&p.session_id, &provider.context(&context)?)?;
            std::sync::Arc::new(provider) as std::sync::Arc<dyn crate::run_provider::RunProvider>
        } else {
            provider
        };
        let binding = Binding {
            request: p.clone(),
            document_source,
            config_revision: profile.config_revision.clone(),
            accepted_at: super::activity_time(session.updated_at)?,
            parent_run_id: parent.clone(),
        };
        if begin || self.managed || self.tools.contains_key(&p.profile_id) {
            provider.validate_tool_metadata(
                &serde_json::to_value(&binding).map_err(|_| DesktopError("invalidParams"))?,
            )?;
        }
        if self.chains.contains_key(&p.request_id)
            || self
                .chains
                .values()
                .any(|c| c.messages.iter().any(|m| m.input.uuid == p.request_id))
        {
            return Err(DesktopError("requestConflict"));
        }
        if begin {
            self.queue_commit(super::queue_types::QueueEntry::Begin {
                binding: binding.clone(),
            })?;
        } else {
            self.journal.append(Entry::Bind {
                binding: binding.clone(),
            })?;
            self.apply_binding(binding.clone())?;
        }
        // 已绑定请求不重放；启动不确定时冻结整个队列实例。
        if let Err(e) = self.start_binding(&binding, provider) {
            if begin {
                self.queue_blocked = true;
            }
            return Err(e);
        }
        self.turn_reply(&binding)
    }
    pub(super) fn history(&self, p: History, v2: bool) -> Result<Value> {
        self.session(&p.session_id)?;
        self.require_import_seed(&p.session_id)?;
        if p.limit == 0 || p.limit > MAX_REQUESTS {
            return Err(DesktopError("invalidLimit"));
        }
        let bindings = self
            .bindings
            .get(&p.session_id)
            .ok_or(DesktopError("sessionNotFound"))?;
        let seed = self.imported.get(&p.session_id);
        let imported_len = seed.map_or(0, super::import::Seed::len);
        let total = imported_len + bindings.len();
        if p.after > total {
            return Err(DesktopError("invalidCursor"));
        }
        let mut turns = Vec::new();
        let mut next = p.after;
        for index in p.after..total.min(p.after + p.limit) {
            let t = if index < imported_len {
                seed.ok_or(DesktopError("corruptImport"))?.turn(index)?
            } else {
                let b = &bindings[index - imported_len];
                let mut turn = self.turn_v2(b)?;
                if !v2 {
                    // 文本 v1 与 v2 的唯一差异为 toolState。保持同一快照，避免再次读取整个流式日志。
                    let tool_state = turn
                        .as_object_mut()
                        .ok_or(DesktopError("invalidReply"))?
                        .remove("toolState");
                    if tool_state.is_some_and(|state| !state.is_null()) {
                        return Err(DesktopError("unsupportedVersion"));
                    }
                }
                turn
            };
            turns.push(t);
            if serde_json::to_vec(&json!({"turns":turns,"nextAfter":next+1,"hasMore":next+1<total}))
                .map_err(|_| DesktopError("storeIo"))?
                .len()
                > MAX_PAGE_BYTES
            {
                turns.pop();
                break;
            }
            next += 1;
        }
        if next == p.after && p.after < total {
            return Err(DesktopError("pageLimit"));
        }
        Ok(json!({"turns":turns,"nextAfter":next,"hasMore":next<total}))
    }
    pub(super) fn binding(&self, session: &str, request: &str) -> Result<&Binding> {
        self.session(session)?;
        id(request)?;
        self.bindings
            .get(session)
            .and_then(|list| list.iter().find(|b| b.request.request_id == request))
            .ok_or(DesktopError("requestNotFound"))
    }
    pub(super) fn cancel(&self, p: Cancel) -> Result<Value> {
        let b = self.binding(&p.session_id, &p.request_id)?;
        let c = self
            .controllers
            .get(&p.session_id)
            .ok_or(DesktopError("sessionNotFound"))?;
        match self.cancel_run(c, &p.request_id) {
            Ok(_) | Err(RunError::RunNotFound) => {}
            Err(e) => return Err(e.into()),
        }
        self.turn_reply(b)
    }
    pub(super) fn events(&self, p: Events) -> Result<Value> {
        let b = self.binding(&p.session_id, &p.request_id)?;
        if p.limit == 0 || p.limit > 256 {
            return Err(DesktopError("invalidLimit"));
        }
        let c = self
            .controllers
            .get(&p.session_id)
            .ok_or(DesktopError("sessionNotFound"))?;
        let (turn, events, next, more) = match c.read(
            Some(&p.request_id),
            p.after_sequence,
            p.limit,
        ) {
            Ok(page) => {
                let mut events = Vec::new();
                let mut next = p.after_sequence;
                let mut bytes = 0;
                for event in page.events {
                    let v = json!({"sessionId":p.session_id,"requestId":p.request_id,"runId":p.request_id,"startedAt":b.request.started_at,"sequence":event.sequence,"kind":event.kind,"text":event.text,"errorCode":event.error_code});
                    let len = serde_json::to_vec(&v)
                        .map_err(|_| DesktopError("storeIo"))?
                        .len();
                    if bytes + len > MAX_PAGE_BYTES / 2 {
                        break;
                    }
                    bytes += len;
                    next = event.sequence;
                    events.push(v);
                }
                let more = next < page.snapshot.sequence;
                (project_turn(b, Some(page.snapshot)), events, next, more)
            }
            Err(RunError::RunNotFound) => {
                if p.after_sequence > 1 {
                    return Err(DesktopError("invalidCursor"));
                }
                let events = if p.after_sequence == 0 {
                    vec![
                        json!({"sessionId":p.session_id,"requestId":p.request_id,"runId":p.request_id,"startedAt":b.request.started_at,"sequence":1,"kind":"interrupted","text":null,"errorCode":"processInterrupted"}),
                    ]
                } else {
                    vec![]
                };
                (project_turn(b, None), events, 1, false)
            }
            Err(e) => return Err(e.into()),
        };
        finish_page(turn, events, next, more, p.after_sequence)
    }
}

pub(super) fn validate_store(
    store: &crate::run_store::RunStore,
    bindings: &[Binding],
    tools: bool,
) -> Result<()> {
    if tools {
        store.validate_all_layouts()?;
    } else {
        store.validate_all()?;
    }
    for id in store.ids()? {
        if store.find_location(&id)? == 3 {
            let run = store.load_tool_run(&id)?;
            if run.snapshot.recovery_required {
                return Err(DesktopError("recoveryRequired"));
            }
            let binding = bindings
                .iter()
                .find(|b| b.request.request_id == id)
                .ok_or(DesktopError("bindingMismatch"))?;
            if run.header.input != binding.request.user_message
                || run.header.parent.as_ref().map(|p| &p.run_id) != binding.parent_run_id.as_ref()
            {
                return Err(DesktopError("bindingMismatch"));
            }
            continue;
        }
        let run = store.load(&id)?;
        if run.snapshot.recovery_required {
            return Err(DesktopError("recoveryRequired"));
        }
        let binding = bindings
            .iter()
            .find(|b| b.request.request_id == id)
            .ok_or(DesktopError("bindingMismatch"))?;
        let parent = match run.lineage {
            crate::run_context::RunLineage::Standalone => None,
            crate::run_context::RunLineage::Continuation { parent, .. } => Some(parent.run_id),
        };
        if run.snapshot.input != binding.request.user_message || parent != binding.parent_run_id {
            return Err(DesktopError("bindingMismatch"));
        }
    }
    Ok(())
}

pub(super) fn finish_page(
    turn: Turn,
    events: Vec<Value>,
    next: u64,
    more: bool,
    after_sequence: u64,
) -> Result<Value> {
    // 正文预算包含转义后的完整turn；最后一次读取可能看到更新的终态。
    let base = json!({"turn":turn,"events":[],"nextAfterSequence":next,"hasMore":false});
    let mut bytes = serde_json::to_vec(&base)
        .map_err(|_| DesktopError("storeIo"))?
        .len();
    let mut bounded = Vec::new();
    let mut cursor = after_sequence;
    let had_events = !events.is_empty();
    for event in events {
        let size = serde_json::to_vec(&event)
            .map_err(|_| DesktopError("storeIo"))?
            .len()
            + usize::from(!bounded.is_empty());
        if bytes + size > MAX_PAGE_BYTES {
            break;
        }
        bytes += size;
        cursor = event["sequence"]
            .as_u64()
            .ok_or(DesktopError("corruptLog"))?;
        bounded.push(event);
    }
    if had_events && bounded.is_empty() && cursor < turn.sequence {
        return Err(DesktopError("pageLimit"));
    }
    Ok(
        json!({"turn":turn,"events":bounded,"nextAfterSequence":cursor,"hasMore":more||cursor<turn.sequence}),
    )
}

// 一个事件页的turn与events来自同一次read，不混入随后到达的终态。
pub(super) fn project_turn(b: &Binding, snapshot: Option<crate::run_types::RunSnapshot>) -> Turn {
    let (output, status, sequence, error_code) = match snapshot {
        Some(snapshot) => (
            snapshot.output,
            snapshot.status,
            snapshot.sequence,
            snapshot.error_code,
        ),
        None => (
            String::new(),
            RunStatus::Interrupted,
            1,
            Some("processInterrupted".into()),
        ),
    };
    Turn {
        session_id: b.request.session_id.clone(),
        request_id: b.request.request_id.clone(),
        run_id: b.request.request_id.clone(),
        user_message_id: format!("{}-user", b.request.request_id),
        assistant_message_id: format!("{}-assistant", b.request.request_id),
        profile_id: b.request.profile_id.clone(),
        model_id: b.request.model_id.clone(),
        config_revision: b.config_revision.clone(),
        effort: b.request.effort.clone(),
        started_at: b.request.started_at,
        user_message: b.request.user_message.clone(),
        document_source: b.document_source.clone(),
        assistant_message: output,
        status,
        sequence,
        error_code,
    }
}
