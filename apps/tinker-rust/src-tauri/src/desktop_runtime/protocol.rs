//! 正式桌面边界：严格参数、固定错误码与有界分页。
use serde::{Deserialize, Serialize};
use serde_json::Value;
pub const VERSION: u32 = 1;
pub const MAX_FRAME_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_PAGE_BYTES: usize = 2 * 1024 * 1024;
pub const MAX_PENDING: usize = 32;
pub const MAX_SESSIONS: usize = 128;
pub const MAX_REQUESTS: usize = 128;
pub const MAX_ACTIVE: usize = 16;
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DesktopError(pub &'static str);
impl std::fmt::Display for DesktopError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.0)
    }
}
impl std::error::Error for DesktopError {}
impl From<std::io::Error> for DesktopError {
    fn from(_: std::io::Error) -> Self {
        Self("storeIo")
    }
}
impl From<crate::run_types::RunError> for DesktopError {
    fn from(e: crate::run_types::RunError) -> Self {
        Self(e.code())
    }
}
pub type Result<T> = std::result::Result<T, DesktopError>;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DesktopRequest {
    pub version: u32,
    pub id: String,
    pub method: String,
    pub params: Value,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WireError {
    pub code: String,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DesktopReply {
    pub version: u32,
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<WireError>,
}
impl DesktopReply {
    pub(crate) fn new(id: String, result: Result<Value>) -> Self {
        match result {
            Ok(result) => Self {
                version: VERSION,
                id,
                result: Some(result),
                error: None,
            },
            Err(e) => Self {
                version: VERSION,
                id,
                result: None,
                error: Some(WireError { code: e.0.into() }),
            },
        }
    }
}
pub fn decode<T: serde::de::DeserializeOwned>(value: Value) -> Result<T> {
    serde_json::from_value(value).map_err(|_| DesktopError("invalidParams"))
}
pub fn id(value: &str) -> Result<()> {
    crate::run_types::validate_id(value).map_err(|_| DesktopError("invalidId"))
}
pub fn title(value: &str) -> Result<()> {
    if value.len() > 1024 {
        Err(DesktopError("invalidParams"))
    } else {
        Ok(())
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Empty {}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Create {
    pub title: String,
    pub profile_id: String,
    #[serde(deserialize_with = "required_nullable")]
    pub workspace_id: Option<String>,
    pub reuse_draft: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Update {
    pub session_id: String,
    #[serde(default, deserialize_with = "optional_non_null")]
    pub title: Option<String>,
    #[serde(default, deserialize_with = "optional_non_null")]
    pub pinned: Option<bool>,
    #[serde(default, deserialize_with = "optional_non_null")]
    pub archived: Option<bool>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionId {
    pub session_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct History {
    pub session_id: String,
    pub after: usize,
    pub limit: usize,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Send {
    pub request_id: String,
    pub session_id: String,
    pub profile_id: String,
    pub model_id: String,
    pub user_message: String,
    pub started_at: u64,
    #[serde(deserialize_with = "required_nullable")]
    pub effort: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Cancel {
    pub session_id: String,
    pub request_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Events {
    pub session_id: String,
    pub request_id: String,
    pub after_sequence: u64,
    pub limit: usize,
}

pub fn model_id(value: &str) -> Result<()> {
    if value.trim().is_empty() || value.len() > 256 || value.chars().any(char::is_control) {
        Err(DesktopError("invalidParams"))
    } else {
        Ok(())
    }
}
fn required_nullable<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Option<String>, D::Error> {
    Option::<String>::deserialize(deserializer)
}

fn optional_non_null<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    deserializer: D,
) -> std::result::Result<Option<T>, D::Error> {
    T::deserialize(deserializer).map(Some)
}
