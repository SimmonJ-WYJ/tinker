//! 资料选择只把项目标识交给渲染层；面板确认时即固定外部文件描述符。
use super::{
    file_sheet::{self, Panel},
    image_disk,
    session_panel::host_step,
    FormalState, WireError,
};
use crate::{
    desktop_runtime::protocol::{id, DesktopError, Result as HostResult},
    formal_agent::session_import::{DocumentStep, ImportReply, ImportStep},
    formal_documents::{
        check_name, input_limit, prepare_selected, DocumentSelection, DOCUMENT_EXTENSIONS,
    },
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    fs::File,
    os::unix::fs::MetadataExt,
    path::{Path, PathBuf},
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
    PickProjectDocument {
        generation: String,
        workspace_id: String,
    },
    ListProjectDocuments {
        generation: String,
        workspace_id: String,
    },
    ReadProjectDocument {
        generation: String,
        workspace_id: String,
        selection: DocumentSelection,
    },
}
fn parse(request: Value) -> HostResult<(String, String, DocumentStep)> {
    let (generation, workspace, step) =
        match serde_json::from_value(request).map_err(|_| DesktopError("invalidEnvelope"))? {
            Request::PickProjectDocument {
                generation,
                workspace_id,
            } => (generation, workspace_id, DocumentStep::Begin),
            Request::ListProjectDocuments {
                generation,
                workspace_id,
            } => (generation, workspace_id, DocumentStep::List),
            Request::ReadProjectDocument {
                generation,
                workspace_id,
                selection,
            } => (generation, workspace_id, DocumentStep::Read(selection)),
        };
    if generation.is_empty() || generation.len() > 64 {
        return Err(DesktopError("invalidEnvelope"));
    }
    id(&workspace)?;
    Ok((generation, workspace, step))
}

struct Selected {
    filename: String,
    file: File,
}
impl Selected {
    fn read(self) -> HostResult<(String, Vec<u8>)> {
        let bytes =
            image_disk::read_bounded(self.file, input_limit(&self.filename), "documentTooLarge")
                .map_err(|e| {
                    if e.0 == "imageFileUnavailable" {
                        DesktopError("documentUnavailable")
                    } else {
                        e
                    }
                })?;
        Ok((self.filename, bytes))
    }
}
fn selected(path: &Path, excluded: &Path) -> HostResult<Selected> {
    let meta = excluded
        .symlink_metadata()
        .map_err(|_| DesktopError("invalidRoot"))?;
    if !meta.is_dir() {
        return Err(DesktopError("invalidRoot"));
    }
    let (filename, file) = image_disk::open_selected(path, Some((meta.dev(), meta.ino())))
        .map_err(|_| DesktopError("documentUnavailable"))?;
    check_name(&filename)?;
    Ok(Selected { filename, file })
}

fn choose<R: Runtime>(
    window: &WebviewWindow<R>,
    excluded: PathBuf,
) -> HostResult<Option<Selected>> {
    #[cfg(feature = "formal-native-qa")]
    if crate::formal_native_qa::accepts_fixture_panels(&window.app_handle().config().identifier) {
        if let Some(choice) = crate::formal_native_qa::document_panel_selection() {
            return choice.map(|path| selected(&path, &excluded)).transpose();
        }
    }
    file_sheet::choose(window, Panel::Open(DOCUMENT_EXTENSIONS), move |path| {
        selected(&path, &excluded)
    })
}

pub(super) async fn run<R: Runtime>(
    window: WebviewWindow<R>,
    state: FormalState,
    request: Value,
) -> Result<Value, WireError> {
    let (generation, workspace, step) = parse(request)?;
    let dialog = matches!(step, DocumentStep::Begin)
        .then(|| state.acquire_file_dialog())
        .transpose()?;
    tauri::async_runtime::spawn_blocking(move || -> Result<Value, WireError> {
        let _dialog = dialog;
        let call = |step| {
            host_step(
                &state,
                &generation,
                ImportStep::Document {
                    workspace: workspace.clone(),
                    step,
                },
            )
        };
        let mut reply = call(step)?;
        if let ImportReply::Permit { epoch, destination } = reply {
            let Some(picked) = choose(&window, destination)? else {
                return Ok(json!({"value":null}));
            };
            super::guard(&window)?;
            let (filename, bytes) = picked.read()?;
            let prepared = prepare_selected(&filename, &bytes)?;
            super::guard(&window)?;
            reply = call(DocumentStep::Commit { epoch, prepared })?;
        }
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
#[path = "document_panel_tests.rs"]
mod tests;
