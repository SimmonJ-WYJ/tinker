//! 跨版本的完整 transcript 父链，不将工具结果压成 assistant 文本。
use crate::{
    run_context::*, run_store::RunStore, run_types::*, session_lifecycle::RunStatus, tool_types::*,
};
impl ToolContext {
    pub fn validate(&self) -> Result<(), RunError> {
        if serde_json::to_vec(self)
            .map_err(|_| RunError::CorruptLog)?
            .len()
            > MAX_CONTEXT_BYTES
        {
            return Err(RunError::ContextLimitExceeded);
        }
        let mut pending: Option<&str> = None;
        let mut expect_user = true;
        let mut stopped = false;
        let mut next_round = 0;
        let mut ids = std::collections::HashSet::new();
        for message in &self.messages {
            match message {
                TranscriptMessage::User { text } => {
                    if pending.is_some()
                        || (!expect_user && !stopped)
                        || text.len() > MAX_INPUT_BYTES
                    {
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
        if input.len() > MAX_INPUT_BYTES {
            return Err(RunError::InputTooLarge);
        }
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
            let (status, recovery, sequence, created, messages, lineage) =
                if self.find_location(&p.run_id)? == 3 {
                    let r = self.load_tool_run(&p.run_id)?;
                    (
                        r.snapshot.status,
                        r.snapshot.recovery_required,
                        r.snapshot.sequence,
                        r.header.created_order,
                        r.snapshot.transcript.messages,
                        r.header.parent,
                    )
                } else {
                    let r = self.load(&p.run_id)?;
                    let lineage = match r.lineage {
                        RunLineage::Standalone => None,
                        RunLineage::Continuation { parent, .. } => Some(parent),
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
                    )
                };
            if status != RunStatus::Completed || recovery {
                return Err(RunError::ContextParentNotCompleted);
            }
            if sequence != p.sequence || created >= order {
                return Err(RunError::CorruptLog);
            }
            turns.push(messages);
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
