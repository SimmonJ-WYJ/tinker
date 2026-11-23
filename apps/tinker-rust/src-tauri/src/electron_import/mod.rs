//! 只从用户选择的 Electron 副本读取会话及其实际引用的附件。
use crate::desktop_runtime::protocol::{DesktopError, Result};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::Path};
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceMessage {
    pub id: String,
    pub role: String,
    pub text: String,
    pub created_at: u64,
    pub attachment_ids: Vec<String>,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceAttachment {
    pub id: String,
    pub filename: String,
    pub media_type: String,
    pub bytes: Vec<u8>,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceSession {
    pub source_session_id: String,
    pub title: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub archived: bool,
    pub pinned: bool,
    pub messages: Vec<SourceMessage>,
    pub attachments: Vec<SourceAttachment>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportWarning {
    pub count: usize,
    pub code: String,
    pub session_id: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceProject {
    pub source_project_id: String,
    pub name: String,
    pub created_at: u64,
    pub updated_at: u64,
    pub has_directory_hint: bool,
}
#[derive(Default)]
pub struct ImportBatch {
    pub projects: Vec<SourceProject>,
    pub session_projects: BTreeMap<String, String>,
    pub sessions: Vec<SourceSession>,
    pub warnings: Vec<ImportWarning>,
    pub skipped: usize,
}
#[cfg(target_os = "macos")]
mod attachments;
#[cfg(target_os = "macos")]
mod fs;
#[cfg(target_os = "macos")]
mod projects;
#[cfg(target_os = "macos")]
mod reader;
#[cfg(target_os = "macos")]
mod records;
#[cfg(target_os = "macos")]
pub fn read_selected(root: &Path) -> Result<ImportBatch> {
    reader::read(root, None)
}
#[cfg(not(target_os = "macos"))]
pub fn read_selected(_: &Path) -> Result<ImportBatch> {
    Err(DesktopError("unsupported"))
}

#[cfg(target_os = "macos")]
pub fn read_selected_identity(root: &Path, expected: (u64, u64)) -> Result<ImportBatch> {
    reader::read(root, Some(expected))
}
#[cfg(not(target_os = "macos"))]
pub fn read_selected_identity(_: &Path, _: (u64, u64)) -> Result<ImportBatch> {
    Err(DesktopError("unsupported"))
}

#[cfg(all(test, target_os = "macos"))]
mod tests;
