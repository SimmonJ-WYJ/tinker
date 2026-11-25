//! journal独占会话元数据与不可变请求身份；输出与终态仅派生自run日志。
use super::protocol::*;
use serde::{Deserialize, Serialize};
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Session {
    pub session_id: String,
    pub title: String,
    pub profile_id: String,
    pub workspace_id: Option<String>,
    pub pinned: bool,
    pub archived: bool,
    pub created_at: u64,
    pub updated_at: u64,
    pub deleted: bool,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Binding {
    pub request: Send,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub document_source: Option<super::document_send::DocumentSource>,
    pub config_revision: String,
    pub accepted_at: u64,
    pub parent_run_id: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Entry {
    Session {
        session: Session,
    },
    PortableSessions {
        sessions: Vec<super::PortableEntry>,
    },
    Bind {
        binding: Binding,
    },
    Queue {
        transition: super::queue_types::QueueEntry,
    },
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Record {
    pub version: u32,
    pub sequence: u64,
    pub entry: Entry,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Turn {
    pub session_id: String,
    pub request_id: String,
    pub run_id: String,
    pub user_message_id: String,
    pub assistant_message_id: String,
    pub profile_id: String,
    pub model_id: String,
    pub config_revision: String,
    pub effort: Option<String>,
    pub started_at: u64,
    pub user_message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_source: Option<super::document_send::DocumentSource>,
    pub assistant_message: String,
    pub status: crate::session_lifecycle::RunStatus,
    pub sequence: u64,
    pub error_code: Option<String>,
}
