//! 使用真实投影、项目文档快照和本机模拟渠道验证被引用提问的分支。
use crate::{
    desktop_runtime::protocol::Result,
    formal_documents,
    formal_host::FormalHost,
    formal_platform::{HostEnvironment, TrustedRoot},
};
use serde_json::{json, Value};
use std::time::Duration;

fn invoke(host: &FormalHost, generation: &Value, channel: &str, args: Value) -> Result<Value> {
    Ok(host
        .command(
            "main",
            json!({"command":"invoke","generation":generation,
          "channel":channel,"args":args}),
        )?
        .wait(Duration::from_secs(10))?["value"]
        .clone())
}

#[test]
fn cited_revision_parks_only_a_local_locator_and_clears_it_on_explicit_binding() {
    let root =
        TrustedRoot::create_temporary(std::env::temp_dir().canonicalize().unwrap().join(format!(
            "tinker-tauri-formal-preview-revision-{}",
            crate::credentialed_channels::catalog::random_reference().unwrap()
        )))
        .unwrap();
    let open = || {
        let host =
            FormalHost::open(&root, HostEnvironment::new("darwin", false, false).unwrap()).unwrap();
        let generation = host
            .command("main", json!({"command":"bootstrap"}))
            .unwrap()
            .wait(Duration::from_secs(5))
            .unwrap()["generation"]
            .clone();
        (host, generation)
    };
    let project = "local-mock-workspace-id";
    let doc = formal_documents::import_selected(
        &root,
        project,
        "Draft.md",
        b"private first\nauthorised passage\nprivate last",
    )
    .unwrap();
    let selection = json!({"documentId":doc.document_id,"startLine":2,"endLine":2});
    let source =
        json!({"filename":"Draft.md","documentId":doc.document_id,"startLine":2,"endLine":2});
    let (mut host, generation) = open();
    let call = |channel, args| invoke(&host, &generation, channel, args).unwrap();
    let parent = call(
        "agent:create-session",
        json!(["Revision", "local-mock", project]),
    )["id"]
        .clone();
    let question = "Explain the selection";
    call(
        "agent:send-message",
        json!([{"sessionId":parent,"requestId":"initial","userMessage":question,
        "channelId":"local-mock","modelId":"local-mock-a","workspaceId":project,"nativeDocumentReference":selection}]),
    );
    let prepare = json!([{"sessionId":parent,"upToMessageUuid":"initial-assistant"}]);
    let parked = call("agent:prepare-revision", prepare.clone());
    assert_eq!(parked["prompt"], question);
    assert_eq!(parked["session"]["nativeRevisionDocument"], source);
    let sid = parked["session"]["id"].clone();
    let route = parked["session"]["nativeRevisionRoute"].clone();
    assert_eq!(route.as_object().unwrap().len(), 3);
    assert!(call("agent:get-messages", json!([sid]))
        .as_array()
        .unwrap()
        .is_empty());
    assert_eq!(host.mock_records().len(), 1);
    host.shutdown().unwrap();
    drop(host);

    let (mut host, generation) = open();
    let list = || invoke(&host, &generation, "agent:list-sessions", json!([])).unwrap();
    let child = |rows: Value| {
        rows.as_array()
            .unwrap()
            .iter()
            .find(|row| row["id"] == sid)
            .unwrap()
            .clone()
    };
    let restored = child(list());
    assert_eq!(restored["nativeRevisionDocument"], source);
    assert_eq!(restored["nativeRevisionRoute"], route);
    assert!(!restored.to_string().contains("authorised passage"));
    assert!(host.mock_records().is_empty());
    let foreign = formal_documents::import_selected(
        &root,
        "another-project",
        "Draft.md",
        b"unselected first\nforeign passage",
    )
    .unwrap();
    let send = |document, request| {
        invoke(
            &host,
            &generation,
            "agent:send-message",
            json!([{
                "sessionId":sid, "requestId":request, "channelId":route["channelId"],
                "modelId":route["modelId"], "expectedConfigRevision":route["configRevision"],
                "userMessage":"A fresh question","workspaceId":project,"nativeDocumentReference":document
            }]),
        )
    };
    let mut wrong_project = selection.clone();
    wrong_project["documentId"] = json!(foreign.document_id);
    assert_eq!(
        send(wrong_project, "foreign").unwrap_err().0,
        "documentNotFound"
    );
    assert_eq!(child(list()), restored);
    assert!(host.mock_records().is_empty());
    send(selection, "edited").unwrap();
    assert!(child(list()).get("nativeRevisionDocument").is_none());
    assert!(child(list()).get("nativeRevisionRoute").is_none());
    assert_eq!(host.mock_records().len(), 1);
    let history = invoke(&host, &generation, "agent:get-messages", json!([parent])).unwrap();
    assert_eq!(history[0]["content"], question);
    assert_eq!(history[0]["_desktopDocumentSource"], source);
    // 将整个合成资料目录移走。已有历史仍能显示，但不能从失效的定位创建分支。
    use sha2::{Digest, Sha256};
    let dir = root.path().join(format!(
        "project-documents-v1-{:x}",
        Sha256::digest(project)
    ));
    std::fs::rename(dir, root.path().join("held-document-fixture")).unwrap();
    let before = list();
    assert!(invoke(&host, &generation, "agent:prepare-revision", prepare).is_err());
    assert_eq!(list(), before);
    assert_eq!(host.mock_records().len(), 1);
    host.shutdown().unwrap();
    drop(host);
    std::fs::remove_dir_all(root.path()).unwrap();
}
