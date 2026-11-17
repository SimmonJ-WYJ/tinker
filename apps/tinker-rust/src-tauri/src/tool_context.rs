//! 跨版本的完整 transcript 父链，不将工具结果压成 assistant 文本。
use crate::{
    run_context::*, run_store::RunStore, run_types::*, session_lifecycle::RunStatus, tool_types::*,
};
impl ToolContext {
    pub(crate) fn validate_budget(&self, reserve: usize) -> Result<(), RunError> {
        if serde_json::to_vec(self)
            .map_err(|_| RunError::CorruptLog)?
            .len()
            > MAX_CONTEXT_BYTES.saturating_sub(reserve)
        {
            return Err(RunError::ContextLimitExceeded);
        }
        Ok(())
    }

    pub fn validate(&self) -> Result<(), RunError> {
        self.validate_budget(0)?;
        let mut pending: Option<&str> = None;
        let mut expect_user = true;
        let mut stopped = false;
        let mut next_round = 0;
        let mut ids = std::collections::HashSet::new();
        for message in &self.messages {
            match message {
                TranscriptMessage::User { text } => {
                    if pending.is_some() || text.len() > MAX_INPUT_BYTES {
                        return Err(RunError::CorruptLog);
                    }
                    expect_user = false;
                    stopped = false;
                    next_round = 0;
                    ids.clear();
                }
                TranscriptMessage::Assistant {
                    round,
                    text: _,
                    call,
                } => {
                    if expect_user
                        || pending.is_some()
                        || stopped
                        || *round != next_round
                        || *round > 4
                    {
                        return Err(RunError::CorruptLog);
                    }
                    next_round += 1;
                    if let Some(c) = call {
                        c.validate()?;
                        if c.round != *round || !ids.insert(c.call_id.as_str()) {
                            return Err(RunError::CorruptLog);
                        }
                        pending = Some(&c.call_id);
                    } else {
                        stopped = true;
                    }
                }
                TranscriptMessage::Tool { result } => {
                    result.validate()?;
                    if pending != Some(result.call_id.as_str()) {
                        return Err(RunError::CorruptLog);
                    }
                    pending = None;
                }
            }
        }
        if pending.is_some() {
            return Err(RunError::CorruptLog);
        }
        Ok(())
    }
}
impl RunStore {
    pub(crate) fn tool_context_for(
        &self,
        parent: Option<&ParentRunRef>,
        child_order: u64,
        input: &str,
    ) -> Result<ToolContext, RunError> {
        self.tool_context_policy(parent, child_order, input, None)
    }
    pub(crate) fn tool_context_policy(
        &self,
        parent: Option<&ParentRunRef>,
        child_order: u64,
        input: &str,
        child: Option<(&str, u32)>,
    ) -> Result<ToolContext, RunError> {
        validate_tool_input(input)?;
        let mut redirected = child
            .map(|(id, v)| self.redirect_edge(id, parent, v))
            .transpose()?
            .unwrap_or(false);
        let mut next = parent.cloned();
        let mut order = child_order;
        let mut visited = std::collections::HashSet::new();
        let mut turns = Vec::new();
        while let Some(p) = next {
            if turns.len() >= MAX_CONTEXT_ANCESTORS {
                return Err(RunError::ContextLimitExceeded);
            }
            if !visited.insert(p.run_id.clone()) {
                return Err(RunError::CorruptLog);
            }
            let (status, recovery, sequence, created, messages, lineage, policy) =
                if self.find_location(&p.run_id)? == 3 {
                    let r = self.load_tool_run(&p.run_id)?;
                    let mut messages = r.snapshot.transcript.messages;
                    // 已认证取消的未结束轮次只读补入；完成轮次已消费 partial_text。
                    if redirected
                        && r.snapshot.status == RunStatus::Cancelled
                        && !r.snapshot.partial_text.is_empty()
                    {
                        messages.push(TranscriptMessage::Assistant {
                            round: r.snapshot.current_round.ok_or(RunError::CorruptLog)?,
                            text: r.snapshot.partial_text,
                            call: None,
                        });
                    }
                    (
                        r.snapshot.status,
                        r.snapshot.recovery_required,
                        r.snapshot.sequence,
                        r.header.created_order,
                        messages,
                        r.header.parent,
                        r.header.policy_version,
                    )
                } else {
                    let r = self.load(&p.run_id)?;
                    let (lineage, policy) = match r.lineage {
                        RunLineage::Standalone => (None, 1),
                        RunLineage::Continuation {
                            parent,
                            policy_version,
                        } => (Some(parent), policy_version),
                    };
                    (
                        r.snapshot.status,
                        r.snapshot.recovery_required,
                        r.snapshot.sequence,
                        r.created_order,
                        vec![
                            TranscriptMessage::User {
                                text: r.snapshot.input,
                            },
                            TranscriptMessage::Assistant {
                                round: 0,
                                text: r.snapshot.output,
                                call: None,
                            },
                        ],
                        lineage,
                        policy,
                    )
                };
            if (status != RunStatus::Completed && !(redirected && status == RunStatus::Cancelled))
                || recovery
            {
                return Err(RunError::ContextParentNotCompleted);
            }
            if sequence != p.sequence || created >= order {
                return Err(RunError::CorruptLog);
            }
            turns.push(messages);
            redirected = self.redirect_edge(&p.run_id, lineage.as_ref(), policy)?;
            next = lineage;
            order = created;
        }
        let mut messages = Vec::new();
        for turn in turns.into_iter().rev() {
            messages.extend(turn);
        }
        messages.push(TranscriptMessage::User { text: input.into() });
        let context = ToolContext { messages };
        context.validate()?;
        Ok(context)
    }
}
