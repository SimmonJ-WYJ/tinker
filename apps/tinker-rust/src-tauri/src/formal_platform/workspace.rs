//! 工作区id用于会话归属，slug仅用于已有工作区偏好；从不拼接renderer路径。
use super::protocol::*;
use crate::desktop_runtime::protocol::{DesktopError, Result};
use serde::{Deserialize, Serialize};
pub const DEFAULT_WORKSPACE_ID: &str = "local-mock-workspace-id";
pub const DEFAULT_WORKSPACE_SLUG: &str = "local-mock-workspace";
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub created_at: u64,
    pub updated_at: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct WorkspaceRecord {
    pub workspace: Workspace,
    pub effort: String,
}
impl WorkspaceRecord {
    pub fn initial() -> Self {
        Self {
            workspace: Workspace {
                id: DEFAULT_WORKSPACE_ID.into(),
                name: "Local Mock".into(),
                slug: DEFAULT_WORKSPACE_SLUG.into(),
                created_at: 0,
                updated_at: 0,
            },
            effort: "high".into(),
        }
    }
    pub(crate) fn validate_managed(&self) -> Result<()> {
        if self.workspace != Self::initial().workspace
            || !["", "low", "medium", "high", "max"].contains(&self.effort.as_str())
        {
            return Err(DesktopError("corruptSnapshot"));
        }
        identifier(&self.workspace.id)
    }
    pub fn validate(&self) -> Result<()> {
        if self.workspace != Self::initial().workspace
            || !["low", "medium", "high", "max"].contains(&self.effort.as_str())
        {
            return Err(DesktopError("corruptSnapshot"));
        }
        identifier(&self.workspace.id)
    }
}
