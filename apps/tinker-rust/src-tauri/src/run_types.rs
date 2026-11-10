//! 离线执行协议、边界及稳定错误码。
use crate::session_lifecycle::RunStatus;
use serde::{Deserialize, Serialize};
pub const PROTOCOL_VERSION: u32 = 1;
pub const MAX_INPUT_BYTES: usize = 65_536;
pub const MAX_OUTPUT_BYTES: usize = 256 * 1024;
pub const MAX_EVENT_BYTES: usize = 16 * 1024;
pub const MAX_EVENTS: usize = 4096;
pub const MAX_LOG_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_HEADER_BYTES: usize = 512 * 1024;
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OfflineScenario {
    Success,
    Failure,
    Slow,
}
impl std::str::FromStr for OfflineScenario {
    type Err = RunError;
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "success" => Ok(Self::Success),
            "failure" => Ok(Self::Failure),
            "slow" => Ok(Self::Slow),
            _ => Err(RunError::InvalidScenario),
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProviderKind {
    OfflineFixture,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunSnapshot {
    pub protocol_version: u32,
    pub run_id: String,
    pub request_id: String,
    pub provider_kind: ProviderKind,
    pub scenario: OfflineScenario,
    pub input: String,
    pub output: String,
    pub status: RunStatus,
    pub sequence: u64,
    #[serde(deserialize_with = "required_nullable")]
    pub error_code: Option<String>,
    pub recovery_required: bool,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RunRecordKind {
    Started,
    Delta,
    Completed,
    Failed,
    Cancelled,
    Interrupted,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunRecord {
    pub protocol_version: u32,
    pub run_id: String,
    pub sequence: u64,
    pub kind: RunRecordKind,
    #[serde(deserialize_with = "required_nullable")]
    pub text: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    pub error_code: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RunEventPage {
    pub protocol_version: u32,
    pub snapshot: RunSnapshot,
    pub events: Vec<RunRecord>,
    pub next_after_sequence: u64,
    pub has_more: bool,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunError {
    InvalidRunId,
    InvalidScenario,
    InputTooLarge,
    RunBusy,
    RunNotFound,
    RequestConflict,
    InvalidCursor,
    InvalidLimit,
    StoreIo,
    StoreLocked,
    UnsafePath,
    CorruptLog,
    UnsupportedVersion,
    RunLimitExceeded,
    RecoveryRequired,
    OfflineFixtureFailed,
    ProviderPanicked,
    EmptyInput,
    HttpConfig,
    HttpTransport,
    HttpStatus,
    HttpProtocol,
    HttpTimeout,
    HttpUnsupported,
    ContextParentNotCompleted,
    ContextLimitExceeded,
    ContextUnsupported,
}
impl RunError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidRunId => "invalidRunId",
            Self::InvalidScenario => "invalidScenario",
            Self::InputTooLarge => "inputTooLarge",
            Self::RunBusy => "runBusy",
            Self::RunNotFound => "runNotFound",
            Self::RequestConflict => "requestConflict",
            Self::InvalidCursor => "invalidCursor",
            Self::InvalidLimit => "invalidLimit",
            Self::StoreIo => "storeIo",
            Self::StoreLocked => "storeLocked",
            Self::UnsafePath => "unsafePath",
            Self::CorruptLog => "corruptLog",
            Self::UnsupportedVersion => "unsupportedVersion",
            Self::RunLimitExceeded => "runLimitExceeded",
            Self::RecoveryRequired => "recoveryRequired",
            Self::ProviderPanicked => "providerPanicked",
            Self::OfflineFixtureFailed => "offlineFixtureFailed",
            Self::EmptyInput => "emptyInput",
            Self::HttpConfig => "httpConfig",
            Self::HttpTransport => "httpTransport",
            Self::HttpStatus => "httpStatus",
            Self::HttpProtocol => "httpProtocol",
            Self::HttpTimeout => "httpTimeout",
            Self::HttpUnsupported => "httpUnsupported",
            Self::ContextParentNotCompleted => "contextParentNotCompleted",
            Self::ContextLimitExceeded => "contextLimitExceeded",
            Self::ContextUnsupported => "contextUnsupported",
        }
    }
}
impl std::fmt::Display for RunError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.code())
    }
}
impl std::error::Error for RunError {}
impl From<std::io::Error> for RunError {
    fn from(_: std::io::Error) -> Self {
        Self::StoreIo
    }
}
pub fn validate_id(id: &str) -> Result<(), RunError> {
    if id.is_empty()
        || id.len() > 64
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        Err(RunError::InvalidRunId)
    } else {
        Ok(())
    }
}
pub fn is_terminal(status: RunStatus) -> bool {
    matches!(
        status,
        RunStatus::Completed | RunStatus::Failed | RunStatus::Cancelled | RunStatus::Interrupted
    )
}

// 自定义反序列化让 nullable 字段仍须显式出现，缺字段不冒充 null。
fn required_nullable<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(deserializer)
}
