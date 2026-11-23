//! 系统面板是目录路径的唯一来源；确认时记录身份，提交时再核对。
use crate::desktop_runtime::protocol::{DesktopError, Result as HostResult};
use objc2::MainThreadMarker;
use objc2_app_kit::{NSModalResponseCancel, NSModalResponseOK, NSOpenPanel};
use std::{
    path::{Path, PathBuf},
    sync::mpsc,
};
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
fn system_folder() -> HostResult<Option<SelectedFolder>> {
    let mtm = MainThreadMarker::new().ok_or(DesktopError("windowUnavailable"))?;
    let panel = NSOpenPanel::openPanel(mtm);
    panel.setCanChooseDirectories(true);
    panel.setCanChooseFiles(false);
    panel.setAllowsMultipleSelection(false);
    panel.setResolvesAliases(false);
    panel.setCanCreateDirectories(false);
    // Electron 备份根常以点开头，应能直接在系统面板中选择。
    panel.setShowsHiddenFiles(true);
    match panel.runModal() {
        r if r == NSModalResponseOK => panel
            .URL()
            .and_then(|url| url.to_file_path())
            .ok_or(DesktopError("invalidImportFolder"))
            .and_then(SelectedFolder::from_panel)
            .map(Some),
        r if r == NSModalResponseCancel => Ok(None),
        _ => Err(DesktopError("windowUnavailable")),
    }
}
pub(super) fn choose<R: Runtime>(
    window: &WebviewWindow<R>,
    purpose: FolderPurpose,
) -> HostResult<Option<SelectedFolder>> {
    #[cfg(feature = "formal-native-qa")]
    if window.app_handle().config().identifier == "com.tinker.formal-native-qa" {
        let selection = match purpose {
            FolderPurpose::Backup => crate::formal_native_qa::session_folder_selection(),
            FolderPurpose::Project => crate::formal_native_qa::project_folder_selection(),
        };
        if let Some(result) = selection {
            return result.map(SelectedFolder::from_panel).transpose();
        }
    }
    let _ = purpose;
    let (tx, rx) = mpsc::sync_channel(1);
    window
        .run_on_main_thread(move || {
            let _ = tx.send(system_folder());
        })
        .map_err(|_| DesktopError("windowUnavailable"))?;
    rx.recv().map_err(|_| DesktopError("windowUnavailable"))?
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
