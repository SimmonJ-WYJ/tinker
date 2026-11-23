//! 外部路径由系统面板选择；前端只能获得本会话内的文件引用。
use super::{image_disk, FormalState, WireError};
use crate::{
    desktop_runtime::protocol::{id, DesktopError, Result as HostResult},
    formal_agent::image_grant::{Outcome, Step},
};
use objc2::MainThreadMarker;
use objc2_app_kit::{NSModalResponseCancel, NSModalResponseOK, NSOpenPanel, NSSavePanel};
use objc2_foundation::{NSArray, NSString};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::mpsc,
};
#[cfg(feature = "formal-native-qa")]
use tauri::Manager;
use tauri::{Runtime, WebviewWindow};

#[derive(Deserialize)]
#[serde(
    tag = "command",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum Request {
    PickImageFile {
        generation: String,
        session_id: String,
    },
    SaveImageFile {
        generation: String,
        session_id: String,
        filename: String,
    },
}
fn host_step(state: &FormalState, g: &str, sid: &str, step: Step) -> HostResult<Outcome> {
    let pending = state
        .host
        .lock()
        .map_err(|_| DesktopError("hostUnavailable"))?
        .as_ref()
        .ok_or(DesktopError("hostClosed"))?
        .image_grant(g.to_owned(), sid.to_owned(), step)?;
    pending.recv().map_err(|_| DesktopError("hostClosed"))?
}
#[allow(deprecated)]
fn native_panel(filename: Option<&str>) -> HostResult<Option<PathBuf>> {
    let mtm = MainThreadMarker::new().ok_or(DesktopError("windowUnavailable"))?;
    let panel = match filename {
        Some(name) => {
            let panel = NSSavePanel::savePanel(mtm);
            panel.setNameFieldStringValue(&NSString::from_str(name));
            panel.setAllowedFileTypes(Some(&NSArray::from_retained_slice(&[NSString::from_str(
                "png",
            )])));
            panel
        }
        None => {
            let panel = NSOpenPanel::openPanel(mtm);
            panel.setCanChooseDirectories(false);
            panel.setCanChooseFiles(true);
            panel.setResolvesAliases(false);
            panel.setAllowsMultipleSelection(false);
            panel.setAllowedFileTypes(Some(&NSArray::from_retained_slice(
                &["png", "jpg", "jpeg"].map(NSString::from_str),
            )));
            panel.into_super()
        }
    };
    panel.setAllowsOtherFileTypes(false);
    match panel.runModal() {
        code if code == NSModalResponseOK => panel
            .URL()
            .and_then(|u| u.to_file_path())
            .map(Some)
            .ok_or(DesktopError("imageFileUnavailable")),
        code if code == NSModalResponseCancel => Ok(None),
        _ => Err(DesktopError("windowUnavailable")),
    }
}
fn choose<R: Runtime>(
    window: &WebviewWindow<R>,
    filename: Option<String>,
) -> HostResult<Option<PathBuf>> {
    #[cfg(feature = "formal-native-qa")]
    if crate::formal_native_qa::accepts_fixture_panels(&window.app_handle().config().identifier) {
        if let Some(selection) = crate::formal_native_qa::image_panel_selection(filename.is_some())
        {
            return Ok(selection);
        }
    }
    let (tx, rx) = mpsc::sync_channel(1);
    window
        .run_on_main_thread(move || {
            let _ = tx.send(native_panel(filename.as_deref()));
        })
        .map_err(|_| DesktopError("windowUnavailable"))?;
    rx.recv().map_err(|_| DesktopError("windowUnavailable"))?
}
pub(super) async fn run<R: Runtime>(
    window: WebviewWindow<R>,
    state: FormalState,
    request: Value,
) -> Result<Value, WireError> {
    let request: Request = serde_json::from_value(request).map_err(|_| WireError {
        code: "invalidEnvelope",
    })?;
    let (generation, session, filename) = match request {
        Request::PickImageFile {
            generation,
            session_id,
        } => (generation, session_id, None),
        Request::SaveImageFile {
            generation,
            session_id,
            filename,
        } => (generation, session_id, Some(filename)),
    };
    id(&session)?;
    if generation.len() > 64
        || filename
            .as_ref()
            .is_some_and(|n| n.len() > 128 || !n.ends_with(".png") || n.contains(['/', '\\']))
    {
        return Err(WireError {
            code: "invalidParams",
        });
    }
    let busy = state.acquire_file_dialog()?;
    tauri::async_runtime::spawn_blocking(move || -> Result<Value, WireError> {
        let _busy = busy;
        let prepared = host_step(
            &state,
            &generation,
            &session,
            match filename.as_ref() {
                Some(n) => Step::ReadExport(n.clone()),
                None => Step::CheckImport,
            },
        )?;
        let Some(path) = choose(&window, filename.clone())? else {
            return Ok(json!({"value":filename.map(|_|false)}));
        };
        super::guard(&window)?;
        let step = match (filename, prepared) {
            (Some(filename), Outcome::Bytes(bytes)) => Step::Export {
                filename,
                staged: image_disk::stage_export(&path, &bytes)?,
            },
            (None, Outcome::Ready) => {
                let (name, bytes) = image_disk::read_selected(&path)?;
                let extension = Path::new(&name)
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("");
                let png = crate::picked_image::normalize_picked(&bytes, extension)?;
                Step::Import { name, png }
            }
            _ => {
                return Err(WireError {
                    code: "invalidReply",
                })
            }
        };
        match host_step(&state, &generation, &session, step)? {
            Outcome::Finished(value) => Ok(value),
            _ => Err(WireError {
                code: "invalidReply",
            }),
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
    #[test]
    fn renderer_may_not_choose_any_external_path_or_bytes() {
        for command in ["pickImageFile", "saveImageFile"] {
            for (key, value) in [
                ("path", "/tmp/a.png"),
                ("destination", "evil"),
                ("bytes", "abcd"),
            ] {
                let mut r = json!({"command":command,"generation":"document-1","sessionId":"s"});
                if command == "saveImageFile" {
                    r["filename"] = json!("img-1.png")
                }
                r[key] = json!(value);
                assert!(serde_json::from_value::<Request>(r).is_err());
            }
        }
    }
}

#[cfg(test)]
#[path = "image_grant_tests.rs"]
mod grant_tests;
