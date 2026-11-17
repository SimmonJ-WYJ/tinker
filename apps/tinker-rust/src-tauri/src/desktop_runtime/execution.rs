//! 请求先绑定后执行；每个会话仅继承最近成功祖先。
use super::{
    protocol::*,
    session::{Binding, Entry, Turn},
    Inner,
};
use crate::{
    run_types::{is_terminal, RunError, MAX_INPUT_BYTES},
    session_lifecycle::RunStatus,
};
use serde_json::{json, Value};
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
        if self
            .chains
            .values()
            .any(|c| c.session_id == p.session_id && c.closure.is_none())
        {
            return Err(DesktopError("runBusy"));
        }
        self.send_inner(p, false)
    }
    pub(super) fn send_inner(&mut self, p: Send, begin: bool) -> Result<Value> {
        validate_send(&p)?;
        let session = self.session(&p.session_id)?;
        let profile = self
            .profiles
            .get(&p.profile_id)
            .ok_or(DesktopError("profileNotFound"))?;
        for bindings in self.bindings.values() {
            if let Some(b) = bindings
                .iter()
                .find(|b| b.request.request_id == p.request_id)
            {
                return if b.request == p && b.config_revision == profile.config_revision {
                    self.turn_reply(b)
                } else {
                    Err(DesktopError("requestConflict"))
                };
            }
        }
        let provider = profile.provider(&p.model_id, p.effort.as_deref())?;
        if begin {
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
        let binding = Binding {
            request: p.clone(),
            config_revision: profile.config_revision.clone(),
            accepted_at: super::activity_time(session.updated_at)?,
            parent_run_id: parent.clone(),
        };
        if begin || self.tools.contains_key(&p.profile_id) {
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
        if p.limit == 0 || p.limit > MAX_REQUESTS {
            return Err(DesktopError("invalidLimit"));
        }
        let bindings = self
            .bindings
            .get(&p.session_id)
            .ok_or(DesktopError("sessionNotFound"))?;
        if p.after > bindings.len() {
            return Err(DesktopError("invalidCursor"));
        }
        let mut turns = Vec::new();
        let mut next = p.after;
        for b in bindings.iter().skip(p.after).take(p.limit) {
            let t = self.turn_v2(b)?;
            if !v2 && !t["toolState"].is_null() {
                return Err(DesktopError("unsupportedVersion"));
            }
            turns.push(if v2 { t } else { json!(self.turn(b)?) });
            if serde_json::to_vec(
                &json!({"turns":turns,"nextAfter":next+1,"hasMore":next+1<bindings.len()}),
            )
            .map_err(|_| DesktopError("storeIo"))?
            .len()
                > MAX_PAGE_BYTES
            {
                turns.pop();
                break;
            }
            next += 1;
        }
        if next == p.after && p.after < bindings.len() {
            return Err(DesktopError("pageLimit"));
        }
        Ok(json!({"turns":turns,"nextAfter":next,"hasMore":next<bindings.len()}))
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
        assistant_message: output,
        status,
        sequence,
        error_code,
    }
}
