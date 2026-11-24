//! 用户显式选择的项目资料。不可变文本只从宿主接收，按项目和行号解析引用。
use crate::{
    desktop_runtime::protocol::{DesktopError, Result},
    formal_platform::TrustedRoot,
};
use serde::{Deserialize, Serialize};
use std::path::Path;

pub(crate) const DOCUMENT_EXTENSIONS: &[&str] = &["txt", "md", "markdown", "pdf"];
pub const MAX_DOCUMENT_BYTES: usize = 256 * 1024;
const MAX_PDF_BYTES: usize = 8 * 1024 * 1024;
const MAX_PDF_PAGES: usize = 100;
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_line_counts: Option<Vec<usize>>,
    pub line_count: usize,
    pub byte_length: usize,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocumentSelection {
    pub document_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<usize>,
    pub start_line: usize,
    pub end_line: usize,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DocumentExcerpt {
    pub document: DocumentSummary,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<usize>,
    pub start_line: usize,
    pub end_line: usize,
    pub text: String,
}

#[cfg(unix)]
mod pdf;
#[cfg(target_os = "macos")]
pub use pdf::dispatch_worker;
#[cfg(all(test, target_os = "macos"))]
pub(crate) use pdf::fixture as pdf_fixture;
#[cfg(unix)]
mod disk;
#[cfg(unix)]
mod storage;
#[cfg(unix)]
pub use storage::{list, read};
#[cfg(unix)]
pub(crate) use storage::{prepare_selected, publish_selected};

/// 只在宿主内存中传递的规范化资料，不作为渲染层的可反序列化输入。
pub(crate) struct PreparedDocument {
    filename: String,
    text: String,
    pages: Option<Vec<usize>>,
    lines: usize,
}

#[cfg(test)]
pub(crate) fn import_selected(
    root: &TrustedRoot,
    workspace: &str,
    filename: &str,
    bytes: &[u8],
) -> Result<DocumentSummary> {
    publish_selected(root, workspace, prepare_selected(filename, bytes)?, |_| {
        Ok(())
    })
}

#[cfg(not(unix))]
pub(crate) fn prepare_selected(_: &str, _: &[u8]) -> Result<PreparedDocument> {
    Err(DesktopError("unsupportedPlatform"))
}
#[cfg(not(unix))]
pub(crate) fn publish_selected(
    _: &TrustedRoot,
    _: &str,
    _: PreparedDocument,
    _: impl Fn(&str) -> Result<()>,
) -> Result<DocumentSummary> {
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

pub(crate) fn is_pdf(name: &str) -> bool {
    Path::new(name)
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf"))
}

pub(crate) fn input_limit(name: &str) -> usize {
    if is_pdf(name) {
        MAX_PDF_BYTES
    } else {
        MAX_DOCUMENT_BYTES
    }
}

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
