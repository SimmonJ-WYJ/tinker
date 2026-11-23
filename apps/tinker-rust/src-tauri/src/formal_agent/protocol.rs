//! native命令窄边界；所有字段严格解码，原通道参数仍为数组。
use crate::formal_platform::protocol::Mutation;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
#[derive(Deserialize)]
#[serde(tag = "command", rename_all = "camelCase", deny_unknown_fields)]
pub enum Command {
    Bootstrap {},
    Attach {
        generation: String,
        observed: BTreeMap<String, u64>,
    },
    Detach {
        generation: String,
    },
    Invoke {
        generation: String,
        channel: String,
        args: Vec<Value>,
        #[serde(default)]
        mutation: Option<Mutation>,
        #[serde(default, rename = "expectedChainId")]
        expected_chain_id: Option<String>,
    },
    ProjectTaskStatuses {
        generation: String,
        #[serde(rename = "workspaceId")]
        workspace_id: String,
    },
    Restore {
        generation: String,
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "observedDeliverySequence")]
        observed_delivery_sequence: u64,
    },
    Resume {
        generation: String,
        #[serde(rename = "restoreToken")]
        restore_token: String,
    },
    BeginClose {
        generation: String,
    },
    AbortClose {
        generation: String,
        #[serde(rename = "closeToken")]
        close_token: String,
    },
    CloseReady {
        generation: String,
        #[serde(rename = "closeToken")]
        close_token: String,
        #[serde(rename = "committedRevision")]
        committed_revision: u64,
    },
}
impl Command {
    pub fn generation(&self) -> Option<&str> {
        match self {
            Self::Bootstrap {} => None,
            Self::Attach { generation, .. }
            | Self::Detach { generation }
            | Self::Invoke { generation, .. }
            | Self::ProjectTaskStatuses { generation, .. }
            | Self::Restore { generation, .. }
            | Self::Resume { generation, .. }
            | Self::BeginClose { generation }
            | Self::AbortClose { generation, .. }
            | Self::CloseReady { generation, .. } => Some(generation),
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EventEnvelope {
    pub version: u32,
    pub generation: String,
    pub delivery_sequence: u64,
    pub channel: String,
    pub payload: Value,
}
