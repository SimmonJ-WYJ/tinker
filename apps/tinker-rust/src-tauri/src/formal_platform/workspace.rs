//! 工作区id用于会话归属，slug仅用于已有工作区偏好；从不拼接renderer路径。
use super::protocol::*;
use crate::desktop_runtime::protocol::{DesktopError, Result};
use serde::{Deserialize, Serialize};
pub const DEFAULT_WORKSPACE_ID: &str = "local-mock-workspace-id";
pub const DEFAULT_WORKSPACE_SLUG: &str = "local-mock-workspace";
#[derive(Clone, Copy)]
pub(crate) enum WorkspaceKey<'a> {
    Id(&'a str),
    Slug(&'a str),
    Project(&'a str),
}
impl WorkspaceKey<'_> {
    pub(crate) fn matches(self, workspace: &Workspace) -> bool {
        match self {
            Self::Id(id) => workspace.id == id,
            Self::Slug(slug) => workspace.slug == slug,
            Self::Project(id) => workspace.project_origin.is_some() && workspace.id == id,
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_origin: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub directory_status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub has_directory_hint: Option<bool>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct WorkspaceRecord {
    pub workspace: Workspace,
    pub effort: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) local_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) binding: Option<super::project_catalog::Binding>,
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
                project_origin: None,
                directory_status: None,
                has_directory_hint: None,
            },
            effort: "high".into(),
            source_project_id: None,
            binding: None,
            local_name: None,
        }
    }
    pub(crate) fn validate_managed(&self) -> Result<()> {
        if self.source_project_id.is_some()
            || self.binding.is_some()
            || self.local_name.is_some()
            || self.workspace != Self::initial().workspace
            || !["", "low", "medium", "high", "max"].contains(&self.effort.as_str())
        {
            return Err(DesktopError("corruptSnapshot"));
        }
        identifier(&self.workspace.id)
    }
    pub fn validate(&self) -> Result<()> {
        if self.source_project_id.is_some()
            || self.binding.is_some()
            || self.local_name.is_some()
            || self.workspace != Self::initial().workspace
            || !["low", "medium", "high", "max"].contains(&self.effort.as_str())
        {
            return Err(DesktopError("corruptSnapshot"));
        }
        identifier(&self.workspace.id)
    }
}
