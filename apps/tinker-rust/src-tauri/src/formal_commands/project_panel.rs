//! 重新绑定仅可由系统目录面板完成。网页不能指定路径。

use super::{
    directory_panel::{choose, validate_source, FolderPurpose},
    session_panel::host_step,
    FormalState, WireError,
};
use crate::{
    desktop_runtime::protocol::{id, DesktopError, Result as HostResult},
    formal_agent::session_import::{ImportReply, ImportStep},
};
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::{Runtime, WebviewWindow};

#[derive(Deserialize)]
#[serde(
    tag = "command",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum Request {
    BindProjectDirectory {
        generation: String,
        workspace_id: String,
    },
}

fn parse(request: Value) -> HostResult<(String, String)> {
    let Request::BindProjectDirectory {
        generation,
        workspace_id,
    } = serde_json::from_value(request).map_err(|_| DesktopError("invalidEnvelope"))?;
    if generation.is_empty() || generation.len() > 64 {
        return Err(DesktopError("invalidEnvelope"));
    }
    id(&workspace_id)?;
    Ok((generation, workspace_id))
}

pub(super) async fn run<R: Runtime>(
    window: WebviewWindow<R>,
    state: FormalState,
    request: Value,
) -> Result<Value, WireError> {
    let (generation, workspace_id) = parse(request)?;
    let dialog = state.acquire_file_dialog()?;
    tauri::async_runtime::spawn_blocking(move || -> Result<Value, WireError> {
        let _dialog = dialog;
        let step = |step| host_step(&state, &generation, step);
        let ImportReply::Permit { destination, epoch } =
            step(ImportStep::BeginBinding(workspace_id.clone()))?
        else {
            return Err(DesktopError("invalidReply").into());
        };
        let Some(selected) = choose(&window, FolderPurpose::Project)? else {
            return Ok(json!({"value":false}));
        };
        super::guard(&window)?;
        validate_source(&selected.path, &destination)?;
        if !matches!(
            step(ImportStep::BindDirectory {
                epoch,
                workspace_id,
                path: selected.path,
                identity: selected.identity
            })?,
            ImportReply::Valid
        ) {
            return Err(DesktopError("invalidReply").into());
        }
        Ok(json!({"value":true}))
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
    fn binding_request_allows_only_a_workspace_identity_from_the_current_document() {
        let request =
            json!({"command":"bindProjectDirectory","generation":"doc","workspaceId":"project-a"});
        assert!(parse(request.clone()).is_ok());
        for key in ["path", "source", "directories", "identity", "epoch"] {
            let mut modified = request.clone();
            modified[key] = json!("/somewhere");
            assert!(parse(modified).is_err());
        }
        for (key, value) in [
            ("generation", ""),
            ("workspaceId", "../project"),
            ("command", "importElectronSessions"),
        ] {
            let mut modified = request.clone();
            modified[key] = json!(value);
            assert!(parse(modified).is_err());
        }
    }

    #[test]
    fn a_late_directory_panel_cannot_bind_after_close_or_document_replacement() {
        use crate::{
            formal_host::FormalHost,
            formal_platform::{HostEnvironment, TrustedRoot},
        };
        use std::{fs, time::Duration};
        let path = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "tinker-tauri-formal-preview-test-project-grant-{}",
            crate::credentialed_channels::catalog::random_reference().unwrap()
        ));
        let root = TrustedRoot::create_temporary(path.clone()).unwrap();
        let mut host =
            FormalHost::open(&root, HostEnvironment::new("darwin", false, false).unwrap()).unwrap();
        let call = |v| {
            host.command("main", v)
                .unwrap()
                .wait(Duration::from_secs(5))
                .unwrap()
        };
        let boot = || {
            call(json!({"command":"bootstrap"}))["generation"]
                .as_str()
                .unwrap()
                .to_owned()
        };
        let step = |g: &str, cmd| host.import_step(g.to_owned(), cmd).unwrap().recv().unwrap();
        let g = boot();
        let ImportReply::Permit { epoch, .. } = step(&g, ImportStep::Begin).unwrap() else {
            panic!("缺少授权")
        };
        let delayed = || ImportStep::BindDirectory {
            epoch,
            workspace_id: "project-unknown".into(),
            path: path.clone(),
            identity: (0, 0),
        };
        assert!(step(&g, ImportStep::BeginBinding("project-unknown".into())).is_err());
        let close = call(json!({"command":"beginClose","generation":g}));
        call(json!({"command":"abortClose","generation":g,"closeToken":close["closeToken"]}));
        assert_eq!(step(&g, delayed()).err().unwrap().0, "closing");
        let g2 = boot();
        assert_ne!(g, g2);
        assert_eq!(step(&g, delayed()).err().unwrap().0, "staleGeneration");
        assert!(host.mock_records().is_empty());
        host.shutdown().unwrap();
        fs::remove_dir_all(path).unwrap();
    }
}
