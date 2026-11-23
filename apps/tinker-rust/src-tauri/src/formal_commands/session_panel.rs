//! 只允许用户通过系统面板明确选择的 Electron 会话数据目录。
use super::directory_panel::{choose, validate_source, FolderPurpose};
use super::{FormalState, WireError};
use crate::{
    desktop_runtime::protocol::{DesktopError, Result as HostResult},
    electron_import::{read_selected_identity, ImportBatch},
    formal_agent::session_import::{ImportReply, ImportStep},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
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
    #[serde(rename = "projectsImported")]
    projects_imported: usize,
    #[serde(rename = "projectsUpdated")]
    projects_updated: usize,
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
pub(super) fn host_step(
    state: &FormalState,
    generation: &str,
    step: ImportStep,
) -> HostResult<ImportReply> {
    let rx = state
        .host
        .lock()
        .map_err(|_| DesktopError("hostUnavailable"))?
        .as_ref()
        .ok_or(DesktopError("hostClosed"))?
        .import_step(generation.to_owned(), step)?;
    rx.recv().map_err(|_| DesktopError("hostClosed"))?
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
                | "importDeleted" | "unavailableProject"),
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
        let Some(selected) = choose(&window, FolderPurpose::Backup)? else {
            return Ok(json!({"value":Summary{cancelled:true,..Default::default()}}));
        };
        super::guard(&window)?;
        step(ImportStep::Check(epoch))?;
        validate_source(&selected.path, &destination)?;
        let mut batch = read_selected_identity(&selected.path, selected.identity)?;
        super::guard(&window)?;
        step(ImportStep::Check(epoch))?;
        let associations = std::mem::take(&mut batch.session_projects);
        let catalog = match step(ImportStep::Projects {
            epoch,
            projects: std::mem::take(&mut batch.projects),
            refs: associations.values().cloned().collect(),
        })? {
            ImportReply::Projects(catalog) => catalog,
            _ => {
                return Err(WireError {
                    code: "invalidReply",
                })
            }
        };
        let mut summary = persist(batch, |session| {
            super::guard(&window).map_err(|error| DesktopError(error.code))?;
            let request = if let Some(project) = associations.get(&session.source_session_id) {
                let workspace = catalog
                    .ids
                    .get(project)
                    .ok_or(DesktopError("unavailableProject"))?
                    .clone();
                ImportStep::ProjectSession {
                    epoch,
                    source: Box::new(session),
                    workspace,
                }
            } else {
                ImportStep::Commit(epoch, Box::new(session))
            };
            match step(request)? {
                ImportReply::Committed(new) => Ok(new),
                _ => Err(DesktopError("invalidReply")),
            }
        });
        summary.projects_imported = catalog.imported;
        summary.projects_updated = catalog.updated;
        summary.warn("invalidProject", catalog.rejected);
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
