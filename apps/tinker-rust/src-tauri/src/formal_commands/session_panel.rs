//! 只允许用户通过系统面板明确选择的 Electron 会话数据目录。
use super::{FormalState, WireError};
use crate::{
    desktop_runtime::protocol::{DesktopError, Result as HostResult},
    electron_import::{read_selected_identity, ImportBatch},
    formal_agent::session_import::{ImportReply, ImportStep},
};
use objc2::MainThreadMarker;
use objc2_app_kit::{NSModalResponseCancel, NSModalResponseOK, NSOpenPanel};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::mpsc,
};
#[cfg(feature = "formal-native-qa")]
use tauri::Manager;
use tauri::{Runtime, WebviewWindow};

#[derive(Deserialize)]
#[serde(tag = "command", rename_all = "camelCase", deny_unknown_fields)]
enum Request {
    ImportElectronSessions { generation: String },
}
fn parse(request: Value) -> HostResult<String> {
    let Request::ImportElectronSessions { generation } =
        serde_json::from_value(request).map_err(|_| DesktopError("invalidEnvelope"))?;
    if generation.is_empty() || generation.len() > 64 {
        return Err(DesktopError("invalidEnvelope"));
    }
    Ok(generation)
}

#[derive(Default, Serialize)]
struct Summary {
    cancelled: bool,
    imported: usize,
    unchanged: usize,
    skipped: usize,
    unconfirmed: usize,
    warnings: BTreeMap<String, usize>,
}
impl Summary {
    fn warn(&mut self, code: impl Into<String>, count: usize) {
        if count > 0 {
            *self.warnings.entry(code.into()).or_default() += count
        }
    }
}
fn host_step(state: &FormalState, generation: &str, step: ImportStep) -> HostResult<ImportReply> {
    let rx = state
        .host
        .lock()
        .map_err(|_| DesktopError("hostUnavailable"))?
        .as_ref()
        .ok_or(DesktopError("hostClosed"))?
        .import_step(generation.to_owned(), step)?;
    rx.recv().map_err(|_| DesktopError("hostClosed"))?
}
struct SelectedFolder {
    path: PathBuf,
    identity: (u64, u64),
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
fn choose<R: Runtime>(window: &WebviewWindow<R>) -> HostResult<Option<SelectedFolder>> {
    #[cfg(feature = "formal-native-qa")]
    if window.app_handle().config().identifier == "com.tinker.formal-native-qa" {
        if let Some(result) = crate::formal_native_qa::session_folder_selection() {
            return result.map(SelectedFolder::from_panel).transpose();
        }
    }
    let (tx, rx) = mpsc::sync_channel(1);
    window
        .run_on_main_thread(move || {
            let _ = tx.send(system_folder());
        })
        .map_err(|_| DesktopError("windowUnavailable"))?;
    rx.recv().map_err(|_| DesktopError("windowUnavailable"))?
}
fn validate_source(path: &Path, destination: &Path) -> HostResult<()> {
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
fn persist(
    batch: ImportBatch,
    mut commit: impl FnMut(crate::electron_import::SourceSession) -> HostResult<bool>,
) -> Summary {
    let mut summary = Summary {
        skipped: batch.skipped,
        ..Summary::default()
    };
    for warning in batch.warnings {
        summary.warn(warning.code, warning.count)
    }
    let mut sessions = batch.sessions.into_iter();
    while let Some(session) = sessions.next() {
        match commit(session) {
            Ok(true) => summary.imported += 1,
            Ok(false) => summary.unchanged += 1,
            Err(DesktopError("invalidImport" | "invalidImportedFile" | "invalidParams")) => {
                summary.skipped += 1;
                summary.warn("invalidSession", 1);
            }
            Err(DesktopError(
                code @ ("importConflict" | "sessionLimit" | "corruptImport" | "importLimit"
                | "importDeleted"),
            )) => {
                summary.skipped += 1;
                summary.warn(code, 1)
            }
            Err(DesktopError(code)) => {
                // 若宿主在写入前已拒绝，可确认当前条未提交。I/O 终态未知时只提示重开后核验。
                let before_commit = matches!(
                    code,
                    "staleGeneration"
                        | "closing"
                        | "invalidRoot"
                        | "invalidWindow"
                        | "hostBusy"
                        | "unsupported"
                );
                if before_commit {
                    summary.skipped += 1;
                    summary.warn("importStopped", 1)
                } else {
                    summary.unconfirmed += 1;
                    summary.warn("importUnconfirmed", 1)
                }
                let remaining = sessions.len();
                summary.skipped += remaining;
                summary.warn("importStopped", remaining);
                break;
            }
        }
    }
    summary
}
pub(super) async fn run<R: Runtime>(
    window: WebviewWindow<R>,
    state: FormalState,
    request: Value,
) -> Result<Value, WireError> {
    let generation = parse(request)?;
    let dialog = state.acquire_file_dialog()?;
    tauri::async_runtime::spawn_blocking(move || -> Result<Value, WireError> {
        let _dialog = dialog;
        let step = |step| host_step(&state, &generation, step);
        let ImportReply::Permit { destination, epoch } = step(ImportStep::Begin)? else {
            return Err(WireError {
                code: "invalidReply",
            });
        };
        let Some(selected) = choose(&window)? else {
            return Ok(json!({"value":Summary{cancelled:true,..Default::default()}}));
        };
        super::guard(&window)?;
        step(ImportStep::Check(epoch))?;
        validate_source(&selected.path, &destination)?;
        let batch = read_selected_identity(&selected.path, selected.identity)?;
        super::guard(&window)?;
        step(ImportStep::Check(epoch))?;
        let summary = persist(batch, |session| {
            super::guard(&window).map_err(|error| DesktopError(error.code))?;
            match step(ImportStep::Commit(epoch, Box::new(session)))? {
                ImportReply::Committed(new) => Ok(new),
                _ => Err(DesktopError("invalidReply")),
            }
        });
        Ok(json!({"value":summary}))
    })
    .await
    .map_err(|_| WireError {
        code: "hostUnavailable",
    })?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn accepts_an_explicit_generation_but_never_paths_or_session_payloads() {
        let normal = json!({"command":"importElectronSessions","generation":"document-1"});
        assert!(parse(normal.clone()).is_ok());
        for k in ["path", "folder", "session", "sessionId", "profile", "bytes"] {
            let mut req = normal.clone();
            req[k] = json!("opaque");
            assert!(parse(req).is_err());
        }
        let mut wrong = normal.clone();
        wrong["command"] = json!("bootstrap");
        assert!(parse(wrong).is_err());
        let mut empty = normal;
        empty["generation"] = json!("");
        assert!(parse(empty).is_err());
    }
}
#[cfg(test)]
#[path = "session_import_tests.rs"]
mod state_tests;
