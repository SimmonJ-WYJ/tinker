//! macOS 在独立、无窗口的同一可执行文件中限时提取 PDF 文字；管道只传字节。
use crate::desktop_runtime::protocol::{DesktopError, Result};

#[cfg(not(target_os = "macos"))]
pub(super) fn extract_pages(_: &[u8]) -> Result<Vec<String>> {
    Err(DesktopError("unsupportedPlatform"))
}

#[cfg(target_os = "macos")]
mod mac;
#[cfg(target_os = "macos")]
pub use mac::dispatch_worker;
#[cfg(target_os = "macos")]
pub(super) use mac::extract_pages;

#[cfg(all(test, target_os = "macos"))]
mod tests;
#[cfg(all(test, target_os = "macos"))]
pub(crate) use tests::fixture;
