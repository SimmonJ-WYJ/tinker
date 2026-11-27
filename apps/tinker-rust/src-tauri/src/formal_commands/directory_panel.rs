//! 系统面板是目录路径的唯一来源；确认时记录身份，提交时再核对。
use crate::desktop_runtime::protocol::{DesktopError, Result as HostResult};
use std::path::{Path, PathBuf};
#[cfg(feature = "formal-native-qa")]
use tauri::Manager;
use tauri::{Runtime, WebviewWindow};
pub(super) enum FolderPurpose {
    Backup,
    Project,
}
pub(super) struct SelectedFolder {
    pub(super) path: PathBuf,
    pub(super) identity: (u64, u64),
}
fn directory_identity(path: &Path) -> HostResult<(u64, u64)> {
    use std::os::unix::fs::MetadataExt;
    let meta = path
        .symlink_metadata()
        .map_err(|_| DesktopError("invalidImportFolder"))?;
    if !meta.is_dir() {
        return Err(DesktopError("unsafeImportPath"));
    }
    Ok((meta.dev(), meta.ino()))
}
impl SelectedFolder {
    fn from_panel(path: PathBuf) -> HostResult<Self> {
        // 用户确认时记录目录身份，读取器随后用实际打开的描述符复核。
        let identity = directory_identity(&path)?;
        Ok(Self { path, identity })
    }
}
pub(super) fn choose<R: Runtime>(
    window: &WebviewWindow<R>,
    purpose: FolderPurpose,
) -> HostResult<Option<SelectedFolder>> {
    #[cfg(feature = "formal-native-qa")]
    if crate::formal_native_qa::accepts_fixture_panels(&window.app_handle().config().identifier) {
        let selection = match purpose {
            FolderPurpose::Backup => crate::formal_native_qa::session_folder_selection(),
            FolderPurpose::Project => crate::formal_native_qa::project_folder_selection(),
        };
        if let Some(result) = selection {
            return result.map(SelectedFolder::from_panel).transpose();
        }
    }
    let _ = purpose;
    super::file_sheet::choose(
        window,
        super::file_sheet::Panel::Folder,
        SelectedFolder::from_panel,
    )
}
pub(super) fn validate_source(path: &Path, destination: &Path) -> HostResult<()> {
    if !path.is_absolute()
        || path
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
        || path.starts_with(destination)
        || destination.starts_with(path)
    {
        return Err(DesktopError("unsafeImportPath"));
    }
    // macOS 常用文件系统大小写不敏感；按目录身份比较，不能只比较字符串前缀。
    let source = directory_identity(path)?;
    let target = directory_identity(destination)?;
    for (candidate, forbidden) in [(path, target), (destination, source)] {
        for ancestor in candidate.ancestors() {
            if directory_identity(ancestor)? == forbidden {
                return Err(DesktopError("unsafeImportPath"));
            }
        }
    }
    Ok(())
}
