//! 平台wire协议仅暴露偏好事实；宿主环境不接受renderer修改。
use super::{settings::Settings, workspace::Workspace};
use crate::desktop_runtime::protocol::{DesktopError, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const VERSION: u32 = 1;
pub const MAX_REQUEST_BYTES: usize = 128 * 1024;
pub const MAX_SNAPSHOT_BYTES: usize = 1024 * 1024;
pub const MAX_RECEIPTS: usize = 1024;
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Mutation {
    pub mutation_id: String,
    pub expected_revision: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct PlatformRequest {
    pub version: u32,
    pub channel: String,
    pub args: Vec<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mutation: Option<Mutation>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UserProfile {
    pub user_name: String,
    pub avatar: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolvedTheme {
    pub mode: String,
    pub is_dark: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Chrome {
    pub platform: String,
    pub fullscreen: bool,
}
#[derive(Debug, Clone)]
pub struct HostEnvironment {
    pub(crate) system_dark: bool,
    pub(crate) chrome: Chrome,
}
impl HostEnvironment {
    pub fn new(platform: &str, system_dark: bool, fullscreen: bool) -> Result<Self> {
        if !["darwin", "win32", "linux"].contains(&platform) {
            return Err(DesktopError("invalidHost"));
        }
        Ok(Self {
            system_dark,
            chrome: Chrome {
                platform: platform.into(),
                fullscreen,
            },
        })
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlatformSnapshot {
    pub version: u32,
    pub revision: u64,
    pub settings: Settings,
    pub user_profile: UserProfile,
    pub workspaces: Vec<Workspace>,
    pub theme: ResolvedTheme,
    pub chrome: Chrome,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlatformReply {
    pub version: u32,
    pub revision: u64,
    pub value: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<PlatformSnapshot>,
}
pub(crate) fn decode<T: serde::de::DeserializeOwned>(v: Value) -> Result<T> {
    serde_json::from_value(v).map_err(|_| DesktopError("invalidParams"))
}
pub(crate) fn encoded<T: Serialize>(v: &T) -> Result<Value> {
    serde_json::to_value(v).map_err(|_| DesktopError("storeIo"))
}
pub(crate) fn identifier(s: &str) -> Result<()> {
    if s.is_empty()
        || s.len() > 128
        || !s
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err(DesktopError("invalidParams"));
    }
    Ok(())
}
pub(crate) fn patch<T: Serialize + serde::de::DeserializeOwned>(
    current: &T,
    patch: &Value,
) -> Result<T> {
    let patch = patch
        .as_object()
        .filter(|p| !p.is_empty())
        .ok_or(DesktopError("invalidParams"))?;
    if patch.values().any(Value::is_null) {
        return Err(DesktopError("invalidParams"));
    }
    let mut value = encoded(current)?;
    for (key, v) in patch {
        value[key] = v.clone();
    }
    decode(value)
}
pub(crate) fn validate_user(profile: &UserProfile) -> Result<()> {
    if profile.user_name.trim().is_empty()
        || profile.user_name.len() > 256
        || profile.user_name.chars().any(char::is_control)
        || profile.avatar.is_empty()
        || profile.avatar.len() > 64 * 1024
    {
        return Err(DesktopError("invalidParams"));
    }
    let avatar = &profile.avatar;
    if let Some(icon) = avatar.strip_prefix("icon:") {
        return identifier(icon);
    }
    if let Some((mime, bytes)) = avatar.split_once(";base64,") {
        if ![
            "data:image/png",
            "data:image/jpeg",
            "data:image/webp",
            "data:image/gif",
        ]
        .contains(&mime)
            || bytes.is_empty()
            || !bytes
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"+/=".contains(&b))
        {
            return Err(DesktopError("invalidParams"));
        }
    } else if avatar.len() > 64
        || avatar
            .chars()
            .any(|c| c.is_ascii() && !c.is_ascii_whitespace())
        || avatar.chars().any(char::is_control)
    {
        return Err(DesktopError("invalidParams"));
    }
    Ok(())
}
