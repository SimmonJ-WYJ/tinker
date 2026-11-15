//! 工具与权限的唯一核心类型；公开字段在信任边界再次校验。
use crate::run_types::{validate_id, RunError};
use serde::{Deserialize, Serialize};
use std::{sync::atomic::AtomicBool, time::Duration};
pub const MAX_TOOL_ARGUMENT_BYTES: usize = 2048;
pub const MAX_TOOL_RESULT_BYTES: usize = 4096;
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolName {
    WorkspaceList,
    WorkspaceRead,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolArguments {
    pub path: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    content = "call",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub enum ToolRoundOutput {
    Stop,
    ToolCall(ProviderToolCall),
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolCall {
    pub round: u8,
    pub call_id: String,
    pub name: ToolName,
    pub arguments: ToolArguments,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ToolOutcome {
    Succeeded,
    Denied,
    Expired,
    Cancelled,
    Failed,
    Interrupted,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolResult {
    pub call_id: String,
    pub outcome: ToolOutcome,
    pub content: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum TranscriptMessage {
    User {
        text: String,
    },
    Assistant {
        round: u8,
        text: String,
        #[serde(deserialize_with = "required_option")]
        call: Option<ToolCall>,
    },
    Tool {
        result: ToolResult,
    },
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolContext {
    pub messages: Vec<TranscriptMessage>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolSpec {
    pub name: ToolName,
    pub description: String,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PermissionDecision {
    Granted,
    Denied,
    Expired,
    Cancelled,
    Interrupted,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PermissionTicket {
    pub permission_id: String,
    pub run_id: String,
    pub call: ToolCall,
    pub workspace_revision: String,
    pub expires_at_ms: u64,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PermissionReply {
    pub permission_id: String,
    pub decision: PermissionDecision,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PermissionReceipt {
    pub permission_id: String,
    pub decision: PermissionDecision,
    pub sequence: u64,
}
#[derive(Clone, Debug)]
pub struct ToolRunOptions {
    pub workspace_revision: String,
    pub permission_timeout: Duration,
    pub run_timeout: Duration,
}
impl ToolRunOptions {
    pub fn new(
        workspace_revision: String,
        permission_timeout: Duration,
        run_timeout: Duration,
    ) -> Result<Self, RunError> {
        validate_revision(&workspace_revision)?;
        if permission_timeout.is_zero()
            || permission_timeout > Duration::from_secs(60)
            || run_timeout.is_zero()
            || run_timeout > Duration::from_secs(120)
        {
            return Err(RunError::ToolArguments);
        }
        Ok(Self {
            workspace_revision,
            permission_timeout,
            run_timeout,
        })
    }
}
/// 仅受信任的有界合成文件执行器；调用和结果提交共用生命周期锁。
/// 必须迅速返回，不能在此接口接入网络、shell 或无界文件操作。
pub trait ToolExecutor: Send + Sync {
    fn workspace_revision(&self) -> &str;
    fn catalog(&self) -> Vec<ToolSpec>;
    fn execute(&self, call: &ToolCall, cancelled: &AtomicBool) -> Result<ToolResult, RunError>;
}
pub(crate) fn validate_revision(s: &str) -> Result<(), RunError> {
    validate_id(s).map_err(|_| RunError::ToolArguments)
}
impl ToolCall {
    pub fn validate(&self) -> Result<(), RunError> {
        validate_id(&self.call_id).map_err(|_| RunError::ToolArguments)?;
        if self.round >= 4
            || self.arguments.path.len() > 128
            || serde_json::to_vec(&self.arguments)
                .map_err(|_| RunError::ToolArguments)?
                .len()
                > MAX_TOOL_ARGUMENT_BYTES
        {
            return Err(RunError::ToolArguments);
        }
        Ok(())
    }
    pub fn from_provider(round: u8, raw: ProviderToolCall) -> Result<Self, RunError> {
        if raw.arguments.len() > MAX_TOOL_ARGUMENT_BYTES {
            return Err(RunError::ToolArguments);
        }
        let name = match raw.name.as_str() {
            "workspace_list" => ToolName::WorkspaceList,
            "workspace_read" => ToolName::WorkspaceRead,
            _ => return Err(RunError::ToolUnsupported),
        };
        let call = Self {
            round,
            call_id: raw.id,
            name,
            arguments: serde_json::from_str(&raw.arguments).map_err(|_| RunError::ToolArguments)?,
        };
        call.validate()?;
        Ok(call)
    }
}
impl ToolResult {
    pub fn validate(&self) -> Result<(), RunError> {
        validate_id(&self.call_id).map_err(|_| RunError::ToolArguments)?;
        if self.content.len() > MAX_TOOL_RESULT_BYTES
            || serde_json::to_vec(self)
                .map_err(|_| RunError::ToolLimit)?
                .len()
                > MAX_TOOL_RESULT_BYTES
        {
            return Err(RunError::ToolLimit);
        }
        Ok(())
    }
}

pub(crate) fn required_option<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    Option::<T>::deserialize(d)
}
