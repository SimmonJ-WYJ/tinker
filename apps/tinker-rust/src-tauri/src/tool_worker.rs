//! 单轮网络在锁外；权限与有界文件执行在线性化锁内提交。
use crate::{
    run_controller::Inner, run_provider::RunProvider, run_types::*, tool_execution::*,
    tool_journal::ToolRecordKind, tool_types::*,
};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, Weak,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
#[allow(clippy::too_many_arguments)]
pub(crate) fn run(
    state: &Weak<Mutex<Inner>>,
    id: &str,
    mut context: ToolContext,
    provider: &dyn RunProvider,
    executor: &dyn ToolExecutor,
    tools: &[ToolSpec],
    token: &AtomicBool,
    permission_timeout: Duration,
) -> Result<(), RunError> {
    let state = state.upgrade().ok_or(RunError::RecoveryRequired)?;
    for round in 0..=4 {
        let remaining = {
            let mut inner = state.lock().map_err(|_| RunError::StoreIo)?;
            check(&inner, id, token)?;
            append(&mut inner, ToolRecordKind::RoundStarted { round })?;
            check(&inner, id, token)?;
            active(&inner)?
                .deadline
                .saturating_duration_since(Instant::now())
        };
        let output = provider.execute_tool_round(&context, tools, token, remaining, &mut |text| {
            let mut inner = state.lock().map_err(|_| RunError::StoreIo)?;
            check(&inner, id, token)?;
            let mut candidate = active(&inner)?.run.snapshot.output.clone();
            candidate.push_str(text);
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                provider.validate_tool_output(&candidate)
            }))
            .unwrap_or(Err(RunError::ProviderPanicked))?;
            let mut candidate_context = context.clone();
            let mut partial = active(&inner)?.run.snapshot.partial_text.clone();
            partial.push_str(text);
            candidate_context
                .messages
                .push(TranscriptMessage::Assistant {
                    round,
                    text: partial,
                    call: None,
                });
            candidate_context.validate_budget(2 * MAX_EVENT_BYTES)?;
            check(&inner, id, token)?;
            append(
                &mut inner,
                ToolRecordKind::TextDelta {
                    round,
                    text: text.into(),
                },
            )
        });
        let mut inner = state.lock().map_err(|_| RunError::StoreIo)?;
        check(&inner, id, token)?;
        let call = match output? {
            ToolRoundOutput::Stop => None,
            ToolRoundOutput::ToolCall(raw) => {
                if round == 4 {
                    return Err(RunError::ToolLimit);
                }
                Some(ToolCall::from_provider(round, raw)?)
            }
        };
        let mut finished_context = context.clone();
        finished_context
            .messages
            .push(TranscriptMessage::Assistant {
                round,
                text: active(&inner)?.run.snapshot.partial_text.clone(),
                call: call.clone(),
            });
        finished_context.validate_budget(2 * MAX_EVENT_BYTES)?;
        if call.is_none() {
            finished_context.validate()?;
        }
        append(
            &mut inner,
            ToolRecordKind::RoundFinished {
                round,
                call: call.clone(),
            },
        )?;
        check(&inner, id, token)?;
        let Some(call) = call else {
            return Ok(());
        };
        if !tools.iter().any(|t| t.name == call.name) {
            return Err(RunError::ToolUnsupported);
        }
        let deadline = (Instant::now() + permission_timeout).min(active(&inner)?.deadline);
        active_mut(&mut inner)?.permission_deadline = Some(deadline);
        let ticket = PermissionTicket {
            permission_id: format!("p-{id}-{round}"),
            run_id: id.into(),
            call: call.clone(),
            workspace_revision: executor.workspace_revision().into(),
            expires_at_ms: (SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|_| RunError::ToolFailed)?
                + deadline.saturating_duration_since(Instant::now()))
            .as_millis()
            .try_into()
            .map_err(|_| RunError::ToolFailed)?,
        };
        append(&mut inner, ToolRecordKind::PermissionRequested { ticket })?;
        loop {
            check(&inner, id, token)?;
            if active(&inner)?.run.snapshot.pending.is_none() {
                break;
            }
            if Instant::now() >= deadline {
                resolve(&mut inner, PermissionDecision::Expired)?;
                break;
            }
            drop(inner);
            std::thread::sleep(Duration::from_millis(5));
            inner = state.lock().map_err(|_| RunError::StoreIo)?;
        }
        #[cfg(test)]
        if let Some(gate) = inner.store.granted_gate.clone() {
            drop(inner);
            gate.0.wait();
            gate.1.wait();
            inner = state.lock().map_err(|_| RunError::StoreIo)?;
        }
        check(&inner, id, token)?;
        let decision = active(&inner)?
            .run
            .events
            .iter()
            .rev()
            .find_map(|e| match &e.event {
                ToolRecordKind::PermissionResolved { receipt } => Some(receipt.decision),
                _ => None,
            })
            .ok_or(RunError::PermissionNotFound)?;
        let result = if decision == PermissionDecision::Granted {
            append(
                &mut inner,
                ToolRecordKind::ToolStarted {
                    call_id: call.call_id.clone(),
                },
            )?;
            check(&inner, id, token)?;
            // 捕获受信任执行器 panic 于锁内，避免锁中毒后的盲执行。
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                executor.execute(&call, token)
            }))
            .unwrap_or(Err(RunError::ToolFailed))?
        } else {
            ToolResult {
                call_id: call.call_id.clone(),
                outcome: if decision == PermissionDecision::Denied {
                    ToolOutcome::Denied
                } else {
                    ToolOutcome::Expired
                },
                content: if decision == PermissionDecision::Denied {
                    "Permission denied."
                } else {
                    "Permission expired."
                }
                .into(),
            }
        };
        check(&inner, id, token)?;
        result.validate()?;
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            provider.validate_tool_result(&result)
        }))
        .unwrap_or(Err(RunError::ToolFailed))?;
        check(&inner, id, token)?;
        let mut next_transcript = active(&inner)?.run.snapshot.transcript.clone();
        next_transcript.messages.push(TranscriptMessage::Tool {
            result: result.clone(),
        });
        let mut next_context = context.clone();
        let start = next_context
            .messages
            .iter()
            .rposition(|m| matches!(m, TranscriptMessage::User { .. }))
            .ok_or(RunError::CorruptLog)?;
        next_context.messages.truncate(start);
        next_context.messages.extend(next_transcript.messages);
        next_context.validate_budget(2 * MAX_EVENT_BYTES)?;
        next_context.validate()?;
        append(&mut inner, ToolRecordKind::ToolFinished { result })?;
        check(&inner, id, token)?;
        // 已闭合 transcript 才能进入标准 context validator。
        let transcript = &active(&inner)?.run.snapshot.transcript;
        let start = context
            .messages
            .iter()
            .rposition(|m| matches!(m, TranscriptMessage::User { .. }))
            .ok_or(RunError::CorruptLog)?;
        context.messages.truncate(start);
        context.messages.extend(transcript.messages.clone());
        context.validate()?;
    }
    Err(RunError::ToolLimit)
}
fn check(inner: &Inner, id: &str, token: &AtomicBool) -> Result<(), RunError> {
    let a = active(inner)?;
    if token.load(Ordering::Acquire)
        || inner.blocked
        || a.run.snapshot.run_id != id
        || is_terminal(a.run.snapshot.status)
    {
        return Err(RunError::RecoveryRequired);
    }
    if Instant::now() >= a.deadline {
        return Err(RunError::RunTimeout);
    }
    Ok(())
}
