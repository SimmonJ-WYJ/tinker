//! 用户显式选择的项目资料。不可变文本只从宿主接收，按项目和行号解析引用。
use crate::{
    desktop_runtime::protocol::{DesktopError, Result},
    formal_platform::TrustedRoot,
};
use serde::{Deserialize, Serialize};
use std::path::Path;

pub(crate) const DOCUMENT_EXTENSIONS: &[&str] = &["txt", "md", "markdown"];
pub const MAX_DOCUMENT_BYTES: usize = 256 * 1024;
const MAX_DOCUMENT_LINES: usize = 8192;
const MAX_LINE_BYTES: usize = 8192;
const MAX_EXCERPT_LINES: usize = 80;
const MAX_EXCERPT_BYTES: usize = 8192;
const MAX_PROJECT_DOCUMENTS: usize = 64;
const MAX_PROJECT_BYTES: usize = 4 * 1024 * 1024;
// 正文仅允许换行和制表符等基本文本，JSON 转义至多增加一倍。
const MAX_RECORD_BYTES: usize = 2 * MAX_DOCUMENT_BYTES + 4096;
const PENDING: &str = "import.pending";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocumentSummary {
    pub document_id: String,
    pub filename: String,
    pub line_count: usize,
    pub byte_length: usize,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocumentSelection {
    pub document_id: String,
    pub start_line: usize,
    pub end_line: usize,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocumentExcerpt {
    pub document: DocumentSummary,
    pub start_line: usize,
    pub end_line: usize,
    pub text: String,
}

#[cfg(unix)]
mod disk;
#[cfg(unix)]
mod storage;
#[cfg(unix)]
pub use storage::{import_selected, list, read};

#[cfg(not(unix))]
pub fn import_selected(_: &TrustedRoot, _: &str, _: &str, _: &[u8]) -> Result<DocumentSummary> {
    Err(DesktopError("unsupportedPlatform"))
}
#[cfg(not(unix))]
pub fn list(_: &TrustedRoot, _: &str) -> Result<Vec<DocumentSummary>> {
    Err(DesktopError("unsupportedPlatform"))
}
#[cfg(not(unix))]
pub fn read(_: &TrustedRoot, _: &str, _: &DocumentSelection) -> Result<DocumentExcerpt> {
    Err(DesktopError("unsupportedPlatform"))
}

#[cfg(all(test, unix))]
mod tests;

pub(crate) fn check_name(name: &str) -> Result<()> {
    if name.is_empty()
        || name.len() > 255
        || name.contains(['/', '\\'])
        || name.chars().any(char::is_control)
    {
        return Err(DesktopError("invalidDocument"));
    }
    let extension = Path::new(name)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    if !DOCUMENT_EXTENSIONS
        .iter()
        .any(|ext| extension.eq_ignore_ascii_case(ext))
    {
        return Err(DesktopError("unsupportedDocumentFormat"));
    }
    Ok(())
}

#[cfg(unix)]
fn line_count(text: &str) -> Result<usize> {
    if text.trim().is_empty()
        || text.starts_with("%PDF-")
        || text
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\t' | '\n'))
    {
        return Err(DesktopError("invalidDocument"));
    }
    let mut count = 0;
    for line in text.lines() {
        count += 1;
        if line.len() > MAX_LINE_BYTES || count > MAX_DOCUMENT_LINES {
            return Err(DesktopError("documentTooLarge"));
        }
    }
    Ok(count)
}
