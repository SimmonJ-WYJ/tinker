//! 串行队列控制；每个启动前先同步不可变绑定，重启只恢复历史。
use super::{
    protocol::*,
    queue_types::*,
    session::{Binding, Entry},
    Inner,
};
use crate::{
    run_types::{is_terminal, RunError},
    session_lifecycle::RunStatus,
};
use serde_json::{json, Value};
impl Inner {
    pub(super) fn queue_commit(&mut self, e: QueueEntry) -> Result<()> {
        // 先归约到隔离的锁内状态；任何校验或持久化失败均还原，未同步状态绝不发布。
        let prior = (
            self.sessions.clone(),
            self.bindings.clone(),
            self.chains.clone(),
            self.redirects.clone(),
        );
        let result = self
            .apply_queue(e.clone())
            .and_then(|()| self.journal.append(Entry::Queue { transition: e }));
        if result.is_err() {
            (self.sessions, self.bindings, self.chains, self.redirects) = prior;
        }
        result
    }
    pub(super) fn begin_chain(&mut self, p: Send) -> Result<Value> {
        super::execution::validate_send(&p)?;
        if let Some(c) = self.chains.get(&p.request_id) {
            if c.session_id != p.session_id {
                return Err(DesktopError("requestConflict"));
            }
            let Some(b) = &c.initial else {
                return Err(DesktopError("chainClosed"));
            };
            if b.request != p
                || self
                    .profiles
                    .get(&p.profile_id)
                    .is_none_or(|v| v.config_revision != b.config_revision)
            {
                return Err(DesktopError("requestConflict"));
            }
            return self.queue_snapshot(&p.session_id, &p.request_id, None);
        }
        self.queue_writable()?;
        if self
            .bindings
            .values()
            .flatten()
            .any(|b| b.request.request_id == p.request_id)
        {
            return Err(DesktopError("requestConflict"));
        }
        if self
            .chains
            .values()
            .any(|c| c.session_id == p.session_id && c.closure.is_none())
        {
            return Err(DesktopError("runBusy"));
        }
        self.send_inner(p.clone(), true)?;
        self.queue_snapshot(&p.session_id, &p.request_id, None)
    }
    pub(super) fn queue_input(&mut self, p: QueueInput) -> Result<Value> {
        id(&p.session_id)?;
        id(&p.chain_id)?;
        id(&p.uuid)?;
        for c in self.chains.values() {
            if let Some(m) = c.messages.iter().find(|m| m.input.uuid == p.uuid) {
                if m.input != p
                    || c.initial.as_ref().is_none_or(|b| {
                        self.profiles
                            .get(&b.request.profile_id)
                            .is_none_or(|v| v.config_revision != b.config_revision)
                    })
                {
                    return Err(DesktopError("requestConflict"));
                }
                return Ok(json!(m.receipt));
            }
        }
        self.session(&p.session_id)?;
        self.queue_writable()?;
        self.validate_accept(&p)?;
        let initial = self.chains[&p.chain_id]
            .initial
            .as_ref()
            .ok_or(DesktopError("chainClosed"))?;
        let profile = self
            .profiles
            .get(&initial.request.profile_id)
            .ok_or(DesktopError("profileNotFound"))?;
        if profile.config_revision != initial.config_revision {
            return Err(DesktopError("requestConflict"));
        }
        let provider =
            profile.provider(&initial.request.model_id, initial.request.effort.as_deref())?;
        provider.validate_tool_metadata(&json!(p))?;
        if let Some(tool) = self.tools.get(&initial.request.profile_id) {
            provider.validate_tool_context(
                &crate::tool_types::ToolContext {
                    messages: vec![crate::tool_types::TranscriptMessage::User {
                        text: p.user_message.clone(),
                    }],
                },
                &tool.executor.catalog(),
            )?;
        }
        let c = &self.chains[&p.chain_id];
        let predecessor = c.active.clone().ok_or(DesktopError("chainClosed"))?;
        let active = self.turn(self.binding(&p.session_id, &predecessor)?)?;
        let redirect_authority = if !p.interrupt {
            None
        } else if !is_terminal(active.status) {
            Some(RedirectAuthority {
                receipt_uuid: p.uuid.clone(),
                before_sequence: active.sequence,
            })
        } else if active.status == RunStatus::Cancelled {
            c.messages
                .iter()
                .filter(|m| m.predecessor == predecessor)
                .find_map(|m| m.redirect_authority.clone())
        } else {
            None
        };
        let receipt = QueueReceipt {
            session_id: p.session_id.clone(),
            chain_id: p.chain_id.clone(),
            uuid: p.uuid.clone(),
            revision: c.revision + 1,
            order: c.messages.len() as u64 + 1,
            user_message_id: format!("{}-user", p.uuid),
            accepted_at: super::activity_time(self.sessions[&p.session_id].updated_at)?,
        };
        self.queue_commit(QueueEntry::Accept {
            input: p.clone(),
            receipt: receipt.clone(),
            predecessor: predecessor.clone(),
            redirect_authority,
        })?;
        if p.interrupt {
            if let Err(e) = self.queue_cancel(&p.session_id, &predecessor) {
                self.queue_blocked = true;
                return Err(e);
            }
        }
        Ok(json!(receipt))
    }
    pub(super) fn list_chains(&self, p: SessionId) -> Result<Value> {
        self.session(&p.session_id)?;
        let chains: Vec<_> = self
            .chains
            .values()
            .filter(|c| c.session_id == p.session_id)
            .map(|c| ChainSummary {
                chain_id: c.chain_id.clone(),
                revision: c.revision,
                closed_reason: c.closure.clone(),
                active_request_id: c.active.clone(),
            })
            .collect();
        let value = json!({"chains":chains});
        if chains.len() > MAX_REQUESTS
            || serde_json::to_vec(&value)
                .map_err(|_| DesktopError("storeIo"))?
                .len()
                > MAX_PAGE_BYTES
        {
            return Err(DesktopError("pageLimit"));
        }
        Ok(value)
    }
    pub(super) fn queue_state(&self, p: QueueQuery) -> Result<Value> {
        self.queue_snapshot(&p.session_id, &p.chain_id, p.uuid.as_deref())
    }
    pub(super) fn queue_snapshot(&self, sid: &str, cid: &str, uuid: Option<&str>) -> Result<Value> {
        self.session(sid)?;
        id(cid)?;
        if let Some(u) = uuid {
            id(u)?;
        }
        let c = self
            .chains
            .get(cid)
            .filter(|c| c.session_id == sid)
            .ok_or(DesktopError("chainNotFound"))?;
        let active = c
            .active
            .as_ref()
            .map(|rid| self.binding(sid, rid).and_then(|b| self.turn(b)))
            .transpose()?
            .map(|t| ExecutionRef {
                session_id: t.session_id,
                request_id: t.request_id,
                run_id: t.run_id,
                status: t.status,
                sequence: t.sequence,
                started_at: t.started_at,
            });
        let messages = c
            .messages
            .iter()
            .map(|m| QueueMessage {
                uuid: m.input.uuid.clone(),
                user_message: (!m.bound).then(|| m.input.user_message.clone()),
                interrupt: m.input.interrupt,
                order: m.receipt.order,
                user_message_id: m.receipt.user_message_id.clone(),
                request_id: m.bound.then(|| m.input.uuid.clone()),
                disposition: if m.bound {
                    Disposition::Bound
                } else if c.closure.is_some() {
                    Disposition::Abandoned
                } else {
                    Disposition::Pending
                },
                receipt: m.receipt.clone(),
            })
            .collect();
        let receipt = uuid
            .map(|u| {
                c.messages
                    .iter()
                    .find(|m| m.input.uuid == u)
                    .map(|m| m.receipt.clone())
                    .ok_or(DesktopError("requestNotFound"))
            })
            .transpose()?;
        let value = json!(ChainSnapshot {
            session_id: sid.into(),
            chain_id: cid.into(),
            revision: c.revision,
            active_execution: active,
            pending: c.pending.clone(),
            messages,
            closure_reason: c.closure.clone(),
            badge_clear_boundary: c.badge_clear_boundary,
            receipt
        });
        if serde_json::to_vec(&value)
            .map_err(|_| DesktopError("storeIo"))?
            .len()
            > MAX_PAGE_BYTES
        {
            return Err(DesktopError("pageLimit"));
        }
        Ok(value)
    }
    pub(super) fn advance_queue(&mut self, p: AdvanceQueue) -> Result<Value> {
        self.queue_writable()?;
        self.session(&p.session_id)?;
        id(&p.chain_id)?;
        id(&p.expected_active_request_id)?;
        let c = self
            .chains
            .get(&p.chain_id)
            .filter(|c| c.session_id == p.session_id)
            .ok_or(DesktopError("chainNotFound"))?
            .clone();
        if c.active.as_ref() != Some(&p.expected_active_request_id)
            || c.revision != p.expected_queue_revision
        {
            return Err(DesktopError("staleQueue"));
        }
        if c.closure.is_some() {
            return Err(DesktopError("chainClosed"));
        }
        let t = self.turn(self.binding(&p.session_id, &p.expected_active_request_id)?)?;
        if !is_terminal(t.status) {
            return Err(DesktopError("runBusy"));
        }
        let next = c
            .pending
            .first()
            .and_then(|u| c.messages.iter().find(|m| &m.input.uuid == u));
        let redirected = next.is_some_and(|m| {
            m.input.interrupt
                && m.predecessor == p.expected_active_request_id
                && m.redirect_authority
                    .as_ref()
                    .is_some_and(|a| a.before_sequence < t.sequence)
        }) && t.status == RunStatus::Cancelled;
        if t.status != RunStatus::Completed && !redirected {
            self.queue_commit(QueueEntry::Close {
                session_id: p.session_id.clone(),
                chain_id: p.chain_id.clone(),
                revision: c.revision + 1,
                reason: Closure::Failure,
            })?;
        } else if let Some(m) = next {
            let mut active = 0;
            for b in self.bindings.values().flatten() {
                if !is_terminal(self.turn(b)?.status) {
                    active += 1;
                }
            }
            if active >= MAX_ACTIVE {
                return Err(DesktopError("activeLimit"));
            }
            let initial = c.initial.as_ref().ok_or(DesktopError("corruptJournal"))?;
            let profile = self
                .profiles
                .get(&initial.request.profile_id)
                .ok_or(DesktopError("profileNotFound"))?;
            if profile.config_revision != initial.config_revision {
                return Err(DesktopError("requestConflict"));
            }
            let provider =
                profile.provider(&initial.request.model_id, initial.request.effort.as_deref())?;
            let entry = QueueEntry::Bind {
                session_id: p.session_id.clone(),
                chain_id: p.chain_id.clone(),
                uuid: m.input.uuid.clone(),
                revision: c.revision + 1,
                accepted_at: super::activity_time(self.sessions[&p.session_id].updated_at)?,
                parent: p.expected_active_request_id.clone(),
                redirect_sequence: redirected.then_some(t.sequence),
            };
            self.queue_commit(entry)?;
            let b = self.binding(&p.session_id, &m.input.uuid)?.clone();
            if redirected {
                let proof = self.redirects[&p.session_id][&m.input.uuid].clone();
                self.controllers[&p.session_id].authorize_redirect(m.input.uuid.clone(), proof)?;
            }
            if let Err(e) = self.start_binding(&b, provider) {
                self.queue_blocked = true;
                return Err(e);
            }
        } else {
            self.queue_commit(QueueEntry::Close {
                session_id: p.session_id.clone(),
                chain_id: p.chain_id.clone(),
                revision: c.revision + 1,
                reason: Closure::Completed,
            })?;
        }
        self.queue_snapshot(&p.session_id, &p.chain_id, None)
    }
    pub(super) fn stop_chain(&mut self, p: StopChain) -> Result<Value> {
        self.queue_writable()?;
        self.session(&p.session_id)?;
        id(&p.chain_id)?;
        let c = self.chains.get(&p.chain_id).cloned();
        if c.is_none()
            && (self
                .bindings
                .values()
                .flatten()
                .any(|b| b.request.request_id == p.chain_id)
                || self
                    .chains
                    .values()
                    .any(|c| c.messages.iter().any(|m| m.input.uuid == p.chain_id)))
        {
            return Err(DesktopError("requestConflict"));
        }
        if c.as_ref().is_some_and(|c| c.session_id != p.session_id) {
            return Err(DesktopError("requestConflict"));
        }
        if c.as_ref().is_none_or(|c| c.closure.is_none()) {
            if c.is_none() && self.request_count(&p.session_id) >= MAX_REQUESTS {
                return Err(DesktopError("requestLimit"));
            }
            self.queue_commit(QueueEntry::Close {
                session_id: p.session_id.clone(),
                chain_id: p.chain_id.clone(),
                revision: c.as_ref().map_or(1, |c| c.revision + 1),
                reason: p.reason.into(),
            })?;
        }
        if let Some(rid) = c.and_then(|c| c.active) {
            if let Err(e) = self.queue_cancel(&p.session_id, &rid) {
                self.queue_blocked = true;
                return Err(e);
            }
        }
        self.queue_snapshot(&p.session_id, &p.chain_id, None)
    }
    fn queue_cancel(&self, sid: &str, rid: &str) -> Result<()> {
        let c = self
            .controllers
            .get(sid)
            .ok_or(DesktopError("sessionNotFound"))?;
        match self.cancel_run(c, rid) {
            Ok(_) | Err(RunError::RunNotFound) => Ok(()),
            Err(e) => Err(e.into()),
        }
    }
    fn queue_writable(&self) -> Result<()> {
        if self.queue_blocked {
            Err(DesktopError("recoveryRequired"))
        } else {
            self.journal.ensure_writable()
        }
    }
    pub(super) fn recover_queues(&mut self) -> Result<()> {
        let open: Vec<_> = self
            .chains
            .values()
            .filter(|c| c.closure.is_none())
            .cloned()
            .collect();
        for c in open {
            self.queue_commit(QueueEntry::Close {
                session_id: c.session_id,
                chain_id: c.chain_id,
                revision: c.revision + 1,
                reason: Closure::Recovered,
            })?;
        }
        Ok(())
    }
    pub(super) fn start_binding(
        &self,
        b: &Binding,
        provider: std::sync::Arc<dyn crate::run_provider::RunProvider>,
    ) -> Result<()> {
        let p = &b.request;
        let c = self
            .controllers
            .get(&p.session_id)
            .ok_or(DesktopError("sessionNotFound"))?;
        if let Some(tool) = self.tools.get(&p.profile_id) {
            c.start_tools(
                p.request_id.clone(),
                b.parent_run_id.clone(),
                p.user_message.clone(),
                provider,
                tool.executor.clone(),
                tool.options.clone(),
            )?;
        } else if let Some(parent) = &b.parent_run_id {
            c.continue_with_provider(
                p.request_id.clone(),
                parent.clone(),
                p.user_message.clone(),
                crate::run_types::OfflineScenario::Success,
                provider,
            )?;
        } else {
            c.start_with_provider(
                p.request_id.clone(),
                p.user_message.clone(),
                crate::run_types::OfflineScenario::Success,
                provider,
            )?;
        }
        Ok(())
    }
}
