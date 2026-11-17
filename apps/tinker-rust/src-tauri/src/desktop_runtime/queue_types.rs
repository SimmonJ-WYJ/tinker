//! 队列只保存已接受意图与不可变执行绑定，正文输出仍来自 run 日志。
use super::session::Binding;
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct QueueInput {
    pub session_id: String,
    pub chain_id: String,
    pub uuid: String,
    pub user_message: String,
    pub interrupt: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct QueueQuery {
    pub session_id: String,
    pub chain_id: String,
    #[serde(default, deserialize_with = "non_null")]
    pub uuid: Option<String>,
}
fn non_null<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> std::result::Result<Option<String>, D::Error> {
    String::deserialize(d).map(Some)
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct AdvanceQueue {
    pub session_id: String,
    pub chain_id: String,
    pub expected_active_request_id: String,
    pub expected_queue_revision: u64,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum Closure {
    Stop,
    Failure,
    Close,
    Delete,
    Recovered,
    Completed,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct StopChain {
    pub session_id: String,
    pub chain_id: String,
    pub reason: StopReason,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum StopReason {
    Stop,
    Failure,
    Close,
    Delete,
}
impl From<StopReason> for Closure {
    fn from(r: StopReason) -> Self {
        match r {
            StopReason::Stop => Self::Stop,
            StopReason::Failure => Self::Failure,
            StopReason::Close => Self::Close,
            StopReason::Delete => Self::Delete,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct QueueReceipt {
    pub session_id: String,
    pub chain_id: String,
    pub uuid: String,
    pub revision: u64,
    pub order: u64,
    pub user_message_id: String,
    pub accepted_at: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(
    tag = "operation",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(super) enum QueueEntry {
    Begin {
        binding: Binding,
    },
    Accept {
        input: QueueInput,
        receipt: QueueReceipt,
        predecessor: String,
        #[serde(deserialize_with = "required_authority")]
        redirect_authority: Option<RedirectAuthority>,
    },
    Bind {
        session_id: String,
        chain_id: String,
        uuid: String,
        revision: u64,
        accepted_at: u64,
        parent: String,
        redirect_sequence: Option<u64>,
    },
    Close {
        session_id: String,
        chain_id: String,
        revision: u64,
        reason: Closure,
    },
}
#[derive(Clone)]
pub(super) struct Accepted {
    pub input: QueueInput,
    pub receipt: QueueReceipt,
    pub predecessor: String,
    pub redirect_authority: Option<RedirectAuthority>,
    pub bound: bool,
}
#[derive(Clone)]
pub(super) struct Chain {
    pub session_id: String,
    pub chain_id: String,
    pub revision: u64,
    pub initial: Option<Binding>,
    pub active: Option<String>,
    pub pending: Vec<String>,
    pub messages: Vec<Accepted>,
    pub closure: Option<Closure>,
    pub badge_clear_boundary: u64,
}
pub(super) const MAX_CHAIN_PENDING: usize = 16;
pub(super) const MAX_GLOBAL_PENDING: usize = 128;
pub(super) const MAX_PENDING_BYTES: usize = 512 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct QueueMessage {
    pub uuid: String,
    pub user_message: Option<String>,
    pub interrupt: bool,
    pub order: u64,
    pub user_message_id: String,
    pub request_id: Option<String>,
    pub disposition: Disposition,
    pub receipt: QueueReceipt,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum Disposition {
    Pending,
    Bound,
    Abandoned,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ChainSnapshot {
    pub session_id: String,
    pub chain_id: String,
    pub revision: u64,
    pub active_execution: Option<ExecutionRef>,
    pub pending: Vec<String>,
    pub messages: Vec<QueueMessage>,
    pub closure_reason: Option<Closure>,
    pub badge_clear_boundary: u64,
    pub receipt: Option<QueueReceipt>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ChainSummary {
    pub chain_id: String,
    pub revision: u64,
    pub closed_reason: Option<Closure>,
    pub active_request_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ExecutionRef {
    pub session_id: String,
    pub request_id: String,
    pub run_id: String,
    pub status: crate::session_lifecycle::RunStatus,
    pub sequence: u64,
    pub started_at: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct RedirectAuthority {
    pub receipt_uuid: String,
    pub before_sequence: u64,
}
fn required_authority<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> std::result::Result<Option<RedirectAuthority>, D::Error> {
    Option::<RedirectAuthority>::deserialize(d)
}
