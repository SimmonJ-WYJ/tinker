//! 备份的路径只来自原生面板，确认恢复只接受宿主发出的单次令牌。
use super::{
    image_disk,
    image_panel::{native_open_file, native_save_file},
    session_panel::host_step,
    FormalState, WireError,
};
use crate::{
    desktop_runtime::protocol::{id, DesktopError, Result as HostResult},
    formal_agent::{
        project_backup::Step,
        session_import::{ImportReply, ImportStep},
    },
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    fs::File,
    os::unix::fs::MetadataExt,
    path::{Path, PathBuf},
    sync::mpsc,
};
#[cfg(feature = "formal-native-qa")]
use tauri::Manager;
use tauri::{Runtime, WebviewWindow};

const EXTENSION: &str = "tinkerproject";

#[derive(Deserialize)]
#[serde(
    tag = "command",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum Request {
    #[serde(rename = "exportProjectBackup")]
    Export {
        generation: String,
        workspace_id: String,
    },
    #[serde(rename = "pickProjectBackup")]
    Pick { generation: String },
    #[serde(rename = "restoreProjectBackup")]
    Restore { generation: String, token: String },
    #[serde(rename = "discardProjectBackup")]
    Discard { generation: String, token: String },
}
enum Action {
    Export(String),
    Pick,
    Confirm(String),
    Discard(String),
}
fn parse(value: Value) -> HostResult<(String, Action)> {
    let (generation, action) =
        match serde_json::from_value(value).map_err(|_| DesktopError("invalidEnvelope"))? {
            Request::Export {
                generation,
                workspace_id,
            } => {
                id(&workspace_id)?;
                (generation, Action::Export(workspace_id))
            }
            Request::Pick { generation } => (generation, Action::Pick),
            Request::Restore { generation, token } => {
                id(&token)?;
                (generation, Action::Confirm(token))
            }
            Request::Discard { generation, token } => {
                id(&token)?;
                (generation, Action::Discard(token))
            }
        };
    if generation.is_empty() || generation.len() > 64 {
        return Err(DesktopError("invalidEnvelope"));
    }
    Ok((generation, action))
}
enum Selection {
    File(File),
    Destination(image_disk::Destination),
}
fn selected(path: PathBuf, save: bool, excluded: (u64, u64)) -> HostResult<Selection> {
    if !path
        .extension()
        .and_then(|s| s.to_str())
        .is_some_and(|s| s.eq_ignore_ascii_case(EXTENSION))
    {
        return Err(DesktopError("backupFileUnavailable"));
    }
    if save {
        image_disk::destination(&path, Some(excluded))
            .map(Selection::Destination)
            .map_err(|_| DesktopError("backupFileUnavailable"))
    } else {
        let (_, file) = image_disk::open_selected(&path, Some(excluded))
            .map_err(|_| DesktopError("backupFileUnavailable"))?;
        Ok(Selection::File(file))
    }
}
fn choose<R: Runtime>(
    window: &WebviewWindow<R>,
    save: bool,
    excluded: (u64, u64),
) -> HostResult<Option<Selection>> {
    #[cfg(feature = "formal-native-qa")]
    if crate::formal_native_qa::accepts_fixture_panels(&window.app_handle().config().identifier) {
        if let Some(choice) = crate::formal_native_qa::backup_panel_selection() {
            return choice.map(|p| selected(p, save, excluded)).transpose();
        }
    }
    let (tx, rx) = mpsc::sync_channel(1);
    window
        .run_on_main_thread(move || {
            let path = if save {
                native_save_file("Project.tinkerproject", EXTENSION)
            } else {
                native_open_file(&[EXTENSION])
            };
            let _ = tx.send(path.and_then(|p| p.map(|p| selected(p, save, excluded)).transpose()));
        })
        .map_err(|_| DesktopError("windowUnavailable"))?;
    rx.recv().map_err(|_| DesktopError("windowUnavailable"))?
}
fn identity(root: &Path) -> HostResult<(u64, u64)> {
    let meta = root
        .symlink_metadata()
        .map_err(|_| DesktopError("invalidRoot"))?;
    if !meta.is_dir() {
        return Err(DesktopError("invalidRoot"));
    }
    Ok((meta.dev(), meta.ino()))
}
pub(super) async fn run<R: Runtime>(
    window: WebviewWindow<R>,
    state: FormalState,
    request: Value,
) -> Result<Value, WireError> {
    let (generation, action) = parse(request)?;
    let dialog = matches!(action, Action::Export(_) | Action::Pick)
        .then(|| state.acquire_file_dialog())
        .transpose()?;
    tauri::async_runtime::spawn_blocking(move || -> Result<Value, WireError> {
        let _dialog = dialog;
        let call = |step| host_step(&state, &generation, ImportStep::Backup(step));
        let reply = match action {
            Action::Confirm(token) => call(Step::Confirm(token))?,
            Action::Discard(token) => call(Step::Discard(token))?,
            Action::Export(_) | Action::Pick => {
                let save = matches!(&action, Action::Export(_));
                let begin = match &action {
                    Action::Export(workspace) => ImportStep::BeginBinding(workspace.clone()),
                    _ => ImportStep::Backup(Step::BeginPick),
                };
                let ImportReply::Permit { destination, epoch } =
                    host_step(&state, &generation, begin)?
                else {
                    return Err(DesktopError("invalidReply").into());
                };
                let excluded = identity(&destination)?;
                let Some(selection) = choose(&window, save, excluded)? else {
                    return Ok(json!({"value": if save {json!(false)} else {Value::Null}}));
                };
                super::guard(&window)?;
                match (action, selection) {
                    (Action::Export(workspace), Selection::Destination(destination)) => {
                        let ImportReply::BackupBytes(bytes) =
                            call(Step::Export { workspace, epoch })?
                        else {
                            return Err(DesktopError("invalidReply").into());
                        };
                        let staged = destination
                            .stage(&bytes)
                            .map_err(|_| DesktopError("backupFileUnavailable"))?;
                        super::guard(&window)?;
                        call(Step::Save { epoch, staged })?
                    }
                    (Action::Pick, Selection::File(file)) => {
                        let bytes = image_disk::read_bounded(
                            file,
                            crate::portable_project::MAX_ARCHIVE_BYTES,
                            "backupTooLarge",
                        )
                        .map_err(|e| {
                            if e.0 == "imageFileUnavailable" {
                                DesktopError("backupFileUnavailable")
                            } else {
                                e
                            }
                        })?;
                        super::guard(&window)?;
                        call(Step::Inspect { epoch, bytes })?
                    }
                    _ => return Err(DesktopError("invalidReply").into()),
                }
            }
        };
        match reply {
            ImportReply::Document(value) => Ok(json!({"value":value})),
            _ => Err(DesktopError("invalidReply").into()),
        }
    })
    .await
    .map_err(|_| WireError {
        code: "hostUnavailable",
    })?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, os::unix::fs::symlink};

    #[test]
    fn backup_renderer_cannot_supply_paths_bytes_epochs_or_grants() {
        for request in [
            json!({"command":"exportProjectBackup","generation":"doc","workspaceId":"project-a"}),
            json!({"command":"pickProjectBackup","generation":"doc"}),
            json!({"command":"restoreProjectBackup","generation":"doc","token":"grant"}),
            json!({"command":"discardProjectBackup","generation":"doc","token":"grant"}),
        ] {
            assert!(parse(request.clone()).is_ok());
            for field in ["path", "destination", "bytes", "epoch", "source"] {
                let mut forged = request.clone();
                forged[field] = json!("/elsewhere");
                assert!(parse(forged).is_err());
            }
            let mut empty = request;
            empty["generation"] = json!("");
            assert!(parse(empty).is_err());
        }
    }

    #[test]
    fn backup_selection_pins_receipts_and_refuses_managed_or_existing_outputs() {
        let dir = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "tinker-backup-grant-{}",
            crate::credentialed_channels::catalog::random_reference().unwrap()
        ));
        let managed = dir.join("managed");
        let output = dir.join("output");
        fs::create_dir_all(&managed).unwrap();
        fs::create_dir(&output).unwrap();
        let excluded = identity(&managed).unwrap();
        let leaf = "备份 1.tinkerproject";
        let managed_file = managed.join(leaf);
        fs::write(&managed_file, b"protected").unwrap();
        for save in [false, true] {
            assert!(selected(managed_file.clone(), save, excluded).is_err());
        }
        let input = output.join(leaf);
        fs::write(&input, b"selected").unwrap();
        let Selection::File(file) = selected(input.clone(), false, excluded).unwrap() else {
            panic!()
        };
        fs::rename(&input, output.join("moved")).unwrap();
        fs::write(&input, b"replacement").unwrap();
        assert_eq!(
            image_disk::read_bounded(file, 32, "backupTooLarge").unwrap(),
            b"selected"
        );
        let Selection::Destination(receipt) = selected(input.clone(), true, excluded).unwrap()
        else {
            panic!()
        };
        assert!(receipt.stage(b"new").unwrap().commit().is_err());
        assert_eq!(fs::read(&input).unwrap(), b"replacement");
        let Selection::Destination(receipt) =
            selected(output.join("new.tinkerproject"), true, excluded).unwrap()
        else {
            panic!()
        };
        fs::rename(&output, dir.join("moved-output")).unwrap();
        symlink(&managed, &output).unwrap();
        assert!(receipt.stage(b"new").unwrap().commit().is_err());
        assert!(!managed.join("new.tinkerproject").exists());
        assert_eq!(fs::read(managed_file).unwrap(), b"protected");
        fs::remove_dir_all(dir).unwrap();
    }
}
