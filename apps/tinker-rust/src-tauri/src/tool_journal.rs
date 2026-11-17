//! v3 工具日志契约与纯状态投影；I/O 复用 RunStore 单写者锁。
use crate::{run_context::ParentRunRef, run_types::*, session_lifecycle::RunStatus, tool_types::*};
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ToolRunHeader {
    pub storage_version: u32,
    pub policy_version: u32,
    pub run_id: String,
    pub input: String,
    pub created_order: u64,
    #[serde(deserialize_with = "required_option")]
    pub parent: Option<ParentRunRef>,
    pub workspace_revision: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ToolRecordKind {
    Started,
    RoundStarted {
        round: u8,
    },
    TextDelta {
        round: u8,
        text: String,
    },
    RoundFinished {
        round: u8,
        #[serde(deserialize_with = "required_option")]
        call: Option<ToolCall>,
    },
    PermissionRequested {
        ticket: PermissionTicket,
    },
    PermissionResolved {
        receipt: PermissionReceipt,
    },
    ToolStarted {
        call_id: String,
    },
    ToolFinished {
        result: ToolResult,
    },
    Terminated {
        status: RunStatus,
        #[serde(deserialize_with = "required_option")]
        error_code: Option<String>,
        #[serde(deserialize_with = "required_option")]
        closed_call: Option<ToolResult>,
    },
}
#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum ToolRecordWire {
    Started {},
    RoundStarted {
        round: u8,
    },
    TextDelta {
        round: u8,
        text: String,
    },
    RoundFinished {
        round: u8,
        #[serde(deserialize_with = "required_option")]
        call: Option<ToolCall>,
    },
    PermissionRequested {
        ticket: PermissionTicket,
    },
    PermissionResolved {
        receipt: PermissionReceipt,
    },
    ToolStarted {
        call_id: String,
    },
    ToolFinished {
        result: ToolResult,
    },
    Terminated {
        status: RunStatus,
        #[serde(deserialize_with = "required_option")]
        error_code: Option<String>,
        #[serde(deserialize_with = "required_option")]
        closed_call: Option<ToolResult>,
    },
}
impl<'de> Deserialize<'de> for ToolRecordKind {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        // 直接解码保留重复键；空结构体 variant 同样拒绝 Started 的额外字段。
        Ok(match ToolRecordWire::deserialize(deserializer)? {
            ToolRecordWire::Started {} => Self::Started,
            ToolRecordWire::RoundStarted { round } => Self::RoundStarted { round },
            ToolRecordWire::TextDelta { round, text } => Self::TextDelta { round, text },
            ToolRecordWire::RoundFinished { round, call } => Self::RoundFinished { round, call },
            ToolRecordWire::PermissionRequested { ticket } => Self::PermissionRequested { ticket },
            ToolRecordWire::PermissionResolved { receipt } => Self::PermissionResolved { receipt },
            ToolRecordWire::ToolStarted { call_id } => Self::ToolStarted { call_id },
            ToolRecordWire::ToolFinished { result } => Self::ToolFinished { result },
            ToolRecordWire::Terminated {
                status,
                error_code,
                closed_call,
            } => Self::Terminated {
                status,
                error_code,
                closed_call,
            },
        })
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolRecord {
    pub version: u32,
    pub run_id: String,
    pub sequence: u64,
    pub event: ToolRecordKind,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolRunSnapshot {
    pub run_id: String,
    pub input: String,
    pub output: String,
    pub status: RunStatus,
    pub sequence: u64,
    #[serde(deserialize_with = "required_option")]
    pub error_code: Option<String>,
    pub recovery_required: bool,
    pub workspace_revision: String,
    pub transcript: ToolContext,
    #[serde(deserialize_with = "required_option")]
    pub pending: Option<PermissionTicket>,
    #[serde(deserialize_with = "required_option")]
    pub current_round: Option<u8>,
    pub partial_text: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolEventPage {
    pub snapshot: ToolRunSnapshot,
    pub events: Vec<ToolRecord>,
    pub next_after_sequence: u64,
    pub has_more: bool,
}
#[derive(Clone, Debug)]
pub(crate) struct StoredToolRun {
    pub header: ToolRunHeader,
    pub snapshot: ToolRunSnapshot,
    pub events: Vec<ToolRecord>,
    pub log_bytes: usize,
    state: State,
}
#[derive(Clone, Debug, PartialEq, Eq)]
enum Phase {
    Queued,
    Ready,
    Round,
    Permission,
    Waiting,
    Resolved(PermissionDecision),
    Executing,
    Stop,
    Terminal,
}
#[derive(Clone, Debug)]
struct State {
    phase: Phase,
    next_round: u8,
    call: Option<ToolCall>,
    ids: std::collections::HashSet<String>,
}
impl ToolRunHeader {
    pub(crate) fn validate(&self) -> Result<(), RunError> {
        if self.storage_version != 3 || !matches!(self.policy_version, 1 | 2) {
            return Err(RunError::UnsupportedVersion);
        }
        validate_id(&self.run_id)?;
        validate_revision(&self.workspace_revision)?;
        if self.created_order == 0 || validate_tool_input(&self.input).is_err() {
            return Err(RunError::CorruptLog);
        }
        if let Some(p) = &self.parent {
            crate::run_context::validate_parent(p, &self.run_id)?;
        }
        Ok(())
    }
}
impl StoredToolRun {
    pub(crate) fn new(header: ToolRunHeader) -> Result<Self, RunError> {
        header.validate()?;
        let snapshot = ToolRunSnapshot {
            run_id: header.run_id.clone(),
            input: header.input.clone(),
            output: String::new(),
            status: RunStatus::Queued,
            sequence: 0,
            error_code: None,
            recovery_required: false,
            workspace_revision: header.workspace_revision.clone(),
            transcript: ToolContext {
                messages: vec![TranscriptMessage::User {
                    text: header.input.clone(),
                }],
            },
            pending: None,
            current_round: None,
            partial_text: String::new(),
        };
        Ok(Self {
            header,
            snapshot,
            events: vec![],
            log_bytes: 0,
            state: State {
                phase: Phase::Queued,
                next_round: 0,
                call: None,
                ids: Default::default(),
            },
        })
    }
    pub(crate) fn apply(&mut self, record: ToolRecord) -> Result<(), RunError> {
        if record.version != 1 {
            return Err(RunError::UnsupportedVersion);
        }
        if record.run_id != self.header.run_id
            || record.sequence != self.snapshot.sequence + 1
            || self.state.phase == Phase::Terminal
            || self.events.len() >= MAX_EVENTS
        {
            return Err(RunError::CorruptLog);
        }
        let s = &mut self.snapshot;
        let state = &mut self.state;
        match &record.event {
            ToolRecordKind::Started if state.phase == Phase::Queued => {
                s.status = RunStatus::Running;
                state.phase = Phase::Ready;
            }
            ToolRecordKind::RoundStarted { round }
                if state.phase == Phase::Ready && *round == state.next_round && *round <= 4 =>
            {
                s.current_round = Some(*round);
                state.phase = Phase::Round;
            }
            ToolRecordKind::TextDelta { round, text }
                if state.phase == Phase::Round && s.current_round == Some(*round) =>
            {
                if s.output.len() + text.len() > MAX_OUTPUT_BYTES {
                    return Err(RunError::RunLimitExceeded);
                }
                s.output.push_str(text);
                s.partial_text.push_str(text);
            }
            ToolRecordKind::RoundFinished { round, call }
                if state.phase == Phase::Round && s.current_round == Some(*round) =>
            {
                if let Some(c) = call {
                    c.validate()?;
                    if c.round != *round || !state.ids.insert(c.call_id.clone()) {
                        return Err(RunError::CorruptLog);
                    }
                }
                s.transcript.messages.push(TranscriptMessage::Assistant {
                    round: *round,
                    text: std::mem::take(&mut s.partial_text),
                    call: call.clone(),
                });
                state.call = call.clone();
                state.phase = if call.is_some() {
                    Phase::Permission
                } else {
                    Phase::Stop
                };
                state.next_round = round + 1;
            }
            ToolRecordKind::PermissionRequested { ticket } if state.phase == Phase::Permission => {
                if Some(&ticket.call) != state.call.as_ref()
                    || ticket.run_id != s.run_id
                    || ticket.workspace_revision != s.workspace_revision
                    || ticket.permission_id != format!("p-{}-{}", s.run_id, ticket.call.round)
                    || ticket.permission_id.len() > 80
                    || ticket.expires_at_ms == 0
                {
                    return Err(RunError::CorruptLog);
                }
                s.pending = Some(ticket.clone());
                s.status = RunStatus::WaitingInput;
                state.phase = Phase::Waiting;
            }
            ToolRecordKind::PermissionResolved { receipt } if state.phase == Phase::Waiting => {
                if receipt.sequence != record.sequence
                    || s.pending.as_ref().map(|t| &t.permission_id) != Some(&receipt.permission_id)
                    || matches!(
                        receipt.decision,
                        PermissionDecision::Cancelled | PermissionDecision::Interrupted
                    )
                {
                    return Err(RunError::PermissionConflict);
                }
                s.pending = None;
                s.status = RunStatus::Running;
                state.phase = Phase::Resolved(receipt.decision);
            }
            ToolRecordKind::ToolStarted { call_id }
                if state.phase == Phase::Resolved(PermissionDecision::Granted)
                    && state.call.as_ref().map(|c| &c.call_id) == Some(call_id) =>
            {
                state.phase = Phase::Executing;
            }
            ToolRecordKind::ToolFinished { result } => {
                let expected = match state.phase {
                    Phase::Executing => None,
                    Phase::Resolved(PermissionDecision::Denied) => Some(ToolOutcome::Denied),
                    Phase::Resolved(PermissionDecision::Expired) => Some(ToolOutcome::Expired),
                    _ => return Err(RunError::CorruptLog),
                };
                result.validate()?;
                if state.call.as_ref().map(|c| &c.call_id) != Some(&result.call_id)
                    || expected.as_ref().is_some_and(|v| v != &result.outcome)
                    || (expected.is_none()
                        && !matches!(result.outcome, ToolOutcome::Succeeded | ToolOutcome::Failed))
                {
                    return Err(RunError::CorruptLog);
                }
                s.transcript.messages.push(TranscriptMessage::Tool {
                    result: result.clone(),
                });
                state.call = None;
                state.phase = Phase::Ready;
                s.current_round = None;
            }
            ToolRecordKind::Terminated {
                status,
                error_code,
                closed_call,
            } => {
                if !is_terminal(*status)
                    || (*status == RunStatus::Completed
                        && (state.phase != Phase::Stop
                            || closed_call.is_some()
                            || error_code.is_some()))
                {
                    return Err(RunError::CorruptLog);
                }
                if error_code.as_ref().is_some_and(|s| !valid_error(s)) {
                    return Err(RunError::CorruptLog);
                }
                match (&state.call, closed_call) {
                    (Some(c), Some(r)) => {
                        r.validate()?;
                        let expected = match status {
                            RunStatus::Cancelled => ToolOutcome::Cancelled,
                            RunStatus::Failed => ToolOutcome::Failed,
                            RunStatus::Interrupted => ToolOutcome::Interrupted,
                            _ => return Err(RunError::CorruptLog),
                        };
                        if r.call_id != c.call_id || r.outcome != expected {
                            return Err(RunError::CorruptLog);
                        }
                        s.transcript
                            .messages
                            .push(TranscriptMessage::Tool { result: r.clone() });
                    }
                    (None, None) => {}
                    _ => return Err(RunError::CorruptLog),
                }
                s.status = *status;
                s.error_code = error_code.clone();
                s.pending = None;
                state.call = None;
                state.phase = Phase::Terminal;
            }
            _ => return Err(RunError::CorruptLog),
        }
        // 完整编码预算在候选reducer提交前检查；为失败/取消闭合保留空间。
        let reserve = if state.phase == Phase::Terminal {
            0
        } else {
            2 * MAX_EVENT_BYTES
        };
        if serde_json::to_vec(&s.output)
            .map_err(|_| RunError::CorruptLog)?
            .len()
            > MAX_OUTPUT_BYTES
            || serde_json::to_vec(&s)
                .map_err(|_| RunError::CorruptLog)?
                .len()
                > MAX_TOOL_SNAPSHOT_BYTES - reserve
        {
            return Err(RunError::RunLimitExceeded);
        }
        let mut context = s.transcript.clone();
        if !s.partial_text.is_empty() {
            context.messages.push(TranscriptMessage::Assistant {
                round: s.current_round.ok_or(RunError::CorruptLog)?,
                text: s.partial_text.clone(),
                call: None,
            });
        }
        context.validate_budget(reserve)?;
        s.sequence = record.sequence;
        self.events.push(record);
        Ok(())
    }
}
fn valid_error(s: &str) -> bool {
    matches!(
        s,
        "invalidRunId"
            | "invalidScenario"
            | "inputTooLarge"
            | "runBusy"
            | "runNotFound"
            | "requestConflict"
            | "invalidCursor"
            | "invalidLimit"
            | "storeIo"
            | "storeLocked"
            | "unsafePath"
            | "corruptLog"
            | "unsupportedVersion"
            | "runLimitExceeded"
            | "recoveryRequired"
            | "providerPanicked"
            | "offlineFixtureFailed"
            | "emptyInput"
            | "httpConfig"
            | "httpTransport"
            | "httpStatus"
            | "httpProtocol"
            | "httpTimeout"
            | "httpUnsupported"
            | "contextParentNotCompleted"
            | "contextLimitExceeded"
            | "contextUnsupported"
            | "toolUnsupported"
            | "toolArguments"
            | "toolLimit"
            | "permissionNotFound"
            | "permissionConflict"
            | "permissionExpired"
            | "runTimeout"
            | "toolFailed"
            | "interrupted"
            | "truncatedLog"
    )
}
