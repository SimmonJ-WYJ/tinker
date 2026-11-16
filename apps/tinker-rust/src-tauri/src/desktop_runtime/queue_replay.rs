//! 队列 journal 的严格归约；恢复前完成全部意图与身份校验。
use super::{protocol::*, queue_types::*, session::Binding, Inner};
use crate::run_context::ParentRunRef;
impl Inner {
    pub(super) fn apply_queue(&mut self, entry: QueueEntry) -> Result<()> {
        match entry {
            QueueEntry::Begin { binding } => {
                let sid = binding.request.session_id.clone();
                let cid = binding.request.request_id.clone();
                if self.chains.contains_key(&cid)
                    || self.request_count(&sid) >= MAX_REQUESTS
                    || self
                        .chains
                        .values()
                        .any(|c| c.messages.iter().any(|m| m.input.uuid == cid))
                    || self
                        .chains
                        .values()
                        .any(|c| c.session_id == sid && c.closure.is_none())
                {
                    return Err(DesktopError("corruptJournal"));
                }
                self.apply_binding(binding.clone())?;
                self.chains.insert(
                    cid.clone(),
                    Chain {
                        session_id: sid,
                        chain_id: cid.clone(),
                        revision: 1,
                        initial: Some(binding),
                        active: Some(cid),
                        pending: vec![],
                        messages: vec![],
                        closure: None,
                        badge_clear_boundary: 0,
                    },
                );
            }
            QueueEntry::Accept {
                input,
                receipt,
                predecessor,
                redirect_authority,
            } => {
                self.validate_accept(&input)?;
                let c = self
                    .chains
                    .get_mut(&input.chain_id)
                    .ok_or(DesktopError("corruptJournal"))?;
                if let Some(authority) = &redirect_authority {
                    id(&authority.receipt_uuid)?;
                    if !input.interrupt
                        || authority.before_sequence == 0
                        || authority.before_sequence > MAX_SAFE_INTEGER
                        || (authority.receipt_uuid != input.uuid
                            && !c.messages.iter().any(|m| {
                                m.input.uuid == authority.receipt_uuid
                                    && m.input.interrupt
                                    && m.predecessor == predecessor
                                    && m.redirect_authority.as_ref() == Some(authority)
                            }))
                    {
                        return Err(DesktopError("corruptJournal"));
                    }
                }
                if receipt.session_id != input.session_id
                    || receipt.chain_id != input.chain_id
                    || receipt.uuid != input.uuid
                    || receipt.revision != c.revision + 1
                    || receipt.order != c.messages.len() as u64 + 1
                    || receipt.user_message_id != format!("{}-user", input.uuid)
                    || receipt.accepted_at > MAX_SAFE_INTEGER
                    || receipt.accepted_at <= self.sessions[&input.session_id].updated_at
                    || c.active.as_ref() != Some(&predecessor)
                {
                    return Err(DesktopError("corruptJournal"));
                }
                if input.interrupt {
                    c.pending.insert(0, input.uuid.clone());
                } else {
                    c.pending.push(input.uuid.clone());
                }
                c.revision = receipt.revision;
                self.sessions
                    .get_mut(&input.session_id)
                    .ok_or(DesktopError("corruptJournal"))?
                    .updated_at = receipt.accepted_at;
                c.messages.push(Accepted {
                    input,
                    receipt,
                    predecessor,
                    redirect_authority,
                    bound: false,
                });
            }
            QueueEntry::Bind {
                session_id,
                chain_id,
                uuid,
                revision,
                accepted_at,
                parent,
                redirect_sequence,
            } => {
                let c = self
                    .chains
                    .get(&chain_id)
                    .ok_or(DesktopError("corruptJournal"))?;
                if c.session_id != session_id
                    || c.closure.is_some()
                    || c.revision + 1 != revision
                    || c.pending.first() != Some(&uuid)
                    || c.active.as_ref() != Some(&parent)
                {
                    return Err(DesktopError("corruptJournal"));
                }
                let m = c
                    .messages
                    .iter()
                    .find(|m| m.input.uuid == uuid)
                    .ok_or(DesktopError("corruptJournal"))?;
                if m.bound
                    || redirect_sequence.is_some_and(|s| {
                        s == 0
                            || !m.input.interrupt
                            || m.predecessor != parent
                            || m.redirect_authority
                                .as_ref()
                                .is_none_or(|a| a.before_sequence >= s)
                    })
                {
                    return Err(DesktopError("corruptJournal"));
                }
                let initial = c.initial.as_ref().ok_or(DesktopError("corruptJournal"))?;
                let mut request = initial.request.clone();
                request.request_id = uuid.clone();
                request.user_message = m.input.user_message.clone();
                request.started_at = m.receipt.accepted_at;
                let binding = Binding {
                    request,
                    config_revision: initial.config_revision.clone(),
                    accepted_at,
                    parent_run_id: Some(parent.clone()),
                };
                self.apply_binding(binding)?;
                if let Some(sequence) = redirect_sequence {
                    self.redirects
                        .entry(session_id.clone())
                        .or_default()
                        .insert(
                            uuid.clone(),
                            ParentRunRef {
                                run_id: parent,
                                sequence,
                            },
                        );
                }
                let c = self
                    .chains
                    .get_mut(&chain_id)
                    .ok_or(DesktopError("corruptJournal"))?;
                c.pending.remove(0);
                c.active = Some(uuid.clone());
                c.revision = revision;
                if redirect_sequence.is_none() {
                    c.badge_clear_boundary += 1;
                }
                c.messages
                    .iter_mut()
                    .find(|m| m.input.uuid == uuid)
                    .ok_or(DesktopError("corruptJournal"))?
                    .bound = true;
            }
            QueueEntry::Close {
                session_id,
                chain_id,
                revision,
                reason,
            } => {
                self.session(&session_id)?;
                id(&chain_id)?;
                if !self.chains.contains_key(&chain_id) {
                    if revision != 1
                        || !matches!(
                            reason,
                            Closure::Stop | Closure::Failure | Closure::Close | Closure::Delete
                        )
                        || self.request_count(&session_id) >= MAX_REQUESTS
                        || self
                            .bindings
                            .values()
                            .flatten()
                            .any(|b| b.request.request_id == chain_id)
                        || self
                            .chains
                            .values()
                            .any(|c| c.messages.iter().any(|m| m.input.uuid == chain_id))
                    {
                        return Err(DesktopError("corruptJournal"));
                    }
                    self.chains.insert(
                        chain_id.clone(),
                        Chain {
                            session_id: session_id.clone(),
                            chain_id: chain_id.clone(),
                            revision: 0,
                            initial: None,
                            active: None,
                            pending: vec![],
                            messages: vec![],
                            closure: None,
                            badge_clear_boundary: 0,
                        },
                    );
                }
                let c = self
                    .chains
                    .get_mut(&chain_id)
                    .ok_or(DesktopError("corruptJournal"))?;
                if c.session_id != session_id || c.closure.is_some() || revision != c.revision + 1 {
                    return Err(DesktopError("corruptJournal"));
                }
                if reason == Closure::Completed {
                    if !c.pending.is_empty() || c.active.is_none() {
                        return Err(DesktopError("corruptJournal"));
                    }
                    c.badge_clear_boundary += 1;
                }
                c.revision = revision;
                c.closure = Some(reason);
                c.pending.clear();
            }
        }
        Ok(())
    }
    pub(super) fn apply_plain_binding(&mut self, b: Binding) -> Result<()> {
        if self.request_count(&b.request.session_id) >= MAX_REQUESTS
            || self.chains.contains_key(&b.request.request_id)
            || self.chains.values().any(|c| {
                (c.session_id == b.request.session_id && c.closure.is_none())
                    || c.messages
                        .iter()
                        .any(|m| m.input.uuid == b.request.request_id)
            })
        {
            return Err(DesktopError("corruptJournal"));
        }
        self.apply_binding(b)
    }
    pub(super) fn validate_queue_store(
        &self,
        sid: &str,
        store: &crate::run_store::RunStore,
    ) -> Result<()> {
        use crate::{run_types::is_terminal, session_lifecycle::RunStatus};
        let facts = |rid: &str| -> Result<(RunStatus, u64)> {
            let (status, sequence, recovery) = if store.find_location(rid)? == 3 {
                let r = store.load_tool_run(rid)?;
                (
                    r.snapshot.status,
                    r.snapshot.sequence,
                    r.snapshot.recovery_required,
                )
            } else {
                let r = store.load(rid)?;
                (
                    r.snapshot.status,
                    r.snapshot.sequence,
                    r.snapshot.recovery_required,
                )
            };
            if recovery {
                return Err(DesktopError("recoveryRequired"));
            }
            Ok((status, sequence))
        };
        for c in self.chains.values().filter(|c| c.session_id == sid) {
            for m in &c.messages {
                if let Some(a) = &m.redirect_authority {
                    let (status, sequence) = facts(&m.predecessor)?;
                    if a.before_sequence > sequence
                        || (a.before_sequence == sequence && is_terminal(status))
                    {
                        return Err(DesktopError("corruptJournal"));
                    }
                }
            }
            for m in c.messages.iter().filter(|m| m.bound) {
                let b = self
                    .bindings
                    .get(sid)
                    .and_then(|bs| bs.iter().find(|b| b.request.request_id == m.input.uuid))
                    .ok_or(DesktopError("corruptJournal"))?;
                let parent = b
                    .parent_run_id
                    .as_deref()
                    .ok_or(DesktopError("corruptJournal"))?;
                let redirected = self
                    .redirects
                    .get(sid)
                    .is_some_and(|proofs| proofs.contains_key(&m.input.uuid));
                if facts(parent)?.0
                    != if redirected {
                        RunStatus::Cancelled
                    } else {
                        RunStatus::Completed
                    }
                {
                    return Err(DesktopError("corruptJournal"));
                }
            }
            if c.closure == Some(Closure::Completed)
                && facts(c.active.as_deref().ok_or(DesktopError("corruptJournal"))?)?.0
                    != RunStatus::Completed
            {
                return Err(DesktopError("corruptJournal"));
            }
        }
        Ok(())
    }
    pub(super) fn apply_binding(&mut self, binding: Binding) -> Result<()> {
        super::execution::validate_send(&binding.request)?;
        id(&binding.config_revision)?;
        let s = self.session(&binding.request.session_id)?;
        if binding.accepted_at <= s.updated_at
            || binding.accepted_at > MAX_SAFE_INTEGER
            || self
                .bindings
                .values()
                .flatten()
                .any(|b| b.request.request_id == binding.request.request_id)
        {
            return Err(DesktopError("corruptJournal"));
        }
        let list = self
            .bindings
            .get_mut(&binding.request.session_id)
            .ok_or(DesktopError("corruptJournal"))?;
        if list.len() >= MAX_REQUESTS
            || binding
                .parent_run_id
                .as_ref()
                .is_some_and(|p| !list.iter().any(|b| &b.request.request_id == p))
        {
            return Err(DesktopError("corruptJournal"));
        }
        let s = self
            .sessions
            .get_mut(&binding.request.session_id)
            .ok_or(DesktopError("corruptJournal"))?;
        s.updated_at = binding.accepted_at;
        s.profile_id = binding.request.profile_id.clone();
        list.push(binding);
        Ok(())
    }
    pub(super) fn request_count(&self, sid: &str) -> usize {
        self.bindings.get(sid).map_or(0, Vec::len)
            + self
                .chains
                .values()
                .filter(|c| c.session_id == sid)
                .map(|c| {
                    usize::from(c.initial.is_none())
                        + c.messages.iter().filter(|m| !m.bound).count()
                })
                .sum::<usize>()
    }
    pub(super) fn validate_accept(&self, p: &QueueInput) -> Result<()> {
        self.session(&p.session_id)?;
        id(&p.chain_id)?;
        id(&p.uuid)?;
        let c = self
            .chains
            .get(&p.chain_id)
            .filter(|c| c.session_id == p.session_id)
            .ok_or(DesktopError("chainNotFound"))?;
        if c.closure.is_some() {
            return Err(DesktopError("chainClosed"));
        }
        let mut request = c
            .initial
            .as_ref()
            .ok_or(DesktopError("chainClosed"))?
            .request
            .clone();
        request.request_id = p.uuid.clone();
        request.user_message = p.user_message.clone();
        super::execution::validate_send(&request)?;
        if self
            .bindings
            .values()
            .flatten()
            .any(|b| b.request.request_id == p.uuid)
            || self.chains.contains_key(&p.uuid)
            || self
                .chains
                .values()
                .any(|c| c.messages.iter().any(|m| m.input.uuid == p.uuid))
        {
            return Err(DesktopError("requestConflict"));
        }
        if self.request_count(&p.session_id) >= MAX_REQUESTS {
            return Err(DesktopError("requestLimit"));
        }
        if c.pending.len() >= MAX_CHAIN_PENDING
            || self.chains.values().map(|c| c.pending.len()).sum::<usize>() >= MAX_GLOBAL_PENDING
        {
            return Err(DesktopError("queueLimit"));
        }
        let bytes = self
            .chains
            .values()
            .filter(|c| c.session_id == p.session_id)
            .flat_map(|c| {
                c.messages
                    .iter()
                    .filter(|m| c.pending.contains(&m.input.uuid))
            })
            .try_fold(0, |n, m| {
                serde_json::to_vec(&m.input)
                    .map(|v| n + v.len())
                    .map_err(|_| DesktopError("invalidParams"))
            })?;
        if bytes
            + serde_json::to_vec(p)
                .map_err(|_| DesktopError("invalidParams"))?
                .len()
            > MAX_PENDING_BYTES
        {
            return Err(DesktopError("queuePayloadLimit"));
        }
        Ok(())
    }
}
