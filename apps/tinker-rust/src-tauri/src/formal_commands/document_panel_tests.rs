use super::*;
use serde_json::json;

#[test]
fn only_the_host_can_supply_selected_file_contents_or_paths() {
    let pick = json!({"command":"pickProjectDocument","generation":"document-1","workspaceId":"project-a"});
    assert!(parse(pick.clone()).is_ok());
    for key in ["path", "filename", "bytes", "source", "selection"] {
        let mut bad = pick.clone();
        bad[key] = json!("outside.txt");
        assert!(parse(bad).is_err(), "{key}");
    }
    let read = json!({"command":"readProjectDocument","generation":"document-1","workspaceId":"project-a","selection":{"documentId":"doc-1","startLine":1,"endLine":1}});
    assert!(parse(read.clone()).is_ok());
    let mut injected = read;
    injected["selection"]["text"] = json!("untrusted");
    assert!(parse(injected).is_err());
    for (key, value) in [("workspaceId", "../project"), ("generation", "")] {
        let mut bad = pick.clone();
        bad[key] = json!(value);
        assert!(parse(bad).is_err());
    }
}

#[test]
fn document_read_keeps_the_file_confirmed_by_the_picker_and_refuses_internal_or_linked_files() {
    use std::{fs, os::unix::fs::symlink};
    let parent = std::env::temp_dir().canonicalize().unwrap().join(format!(
        "tinker-qa-doc-picker-{}",
        crate::credentialed_channels::catalog::random_reference().unwrap()
    ));
    let store = parent.join("private-root");
    fs::create_dir_all(&store).unwrap();
    let original = parent.join("source.md");
    fs::write(&original, b"original selection").unwrap();
    let picked = selected(&original, &store).unwrap();
    fs::rename(&original, parent.join("renamed.md")).unwrap();
    fs::write(&original, b"replacement").unwrap();
    assert_eq!(picked.read().unwrap().1, b"original selection");
    let other = store.join("internal.txt");
    fs::write(&other, b"private contents").unwrap();
    assert!(selected(&other, &store).is_err());
    let link = parent.join("alias.txt");
    symlink(&other, &link).unwrap();
    assert!(selected(&link, &store).is_err());
    let linked = parent.join("hardlink.txt");
    fs::hard_link(other, &linked).unwrap();
    assert!(selected(&linked, &store).is_err());
    fs::remove_dir_all(parent).unwrap();
}

#[test]
fn project_and_document_generation_are_checked_at_commit_and_each_read() {
    use crate::{
        formal_host::FormalHost,
        formal_platform::{workspace::DEFAULT_WORKSPACE_ID, HostEnvironment, TrustedRoot},
    };
    use std::{fs, time::Duration};
    let root =
        TrustedRoot::create_temporary(std::env::temp_dir().canonicalize().unwrap().join(format!(
            "tinker-tauri-formal-preview-test-doc-grant-{}",
            crate::credentialed_channels::catalog::random_reference().unwrap()
        )))
        .unwrap();
    let mut host =
        FormalHost::open(&root, HostEnvironment::new("darwin", false, false).unwrap()).unwrap();
    let call = |request| {
        host.command("main", request)
            .unwrap()
            .wait(Duration::from_secs(10))
            .unwrap()
    };
    let generation = call(json!({"command":"bootstrap"}))["generation"]
        .as_str()
        .unwrap()
        .to_owned();
    let step = |g: &str, workspace: &str, step| {
        host.import_step(
            g.into(),
            ImportStep::Document {
                workspace: workspace.into(),
                step,
            },
        )
        .unwrap()
        .recv()
        .unwrap()
    };
    let a = DEFAULT_WORKSPACE_ID;
    let b = call(json!({"command":"invoke","generation":generation,"channel":"agent:create-workspace","args":["Second test project"]}))["value"]["id"].as_str().unwrap().to_owned();
    let epoch = |g: &str, ws: &str| match step(g, ws, DocumentStep::Begin).unwrap() {
        ImportReply::Permit { epoch, .. } => epoch,
        _ => panic!("预期文档面板授权"),
    };
    let commit = |epoch| DocumentStep::Commit {
        epoch,
        filename: "note.txt".into(),
        bytes: b"selected\nunselected".to_vec(),
    };
    assert!(step(&generation, "absent", DocumentStep::List).is_err());
    let e = epoch(&generation, a);
    let summary = match step(&generation, a, commit(e)).unwrap() {
        ImportReply::Document(doc) => doc,
        _ => panic!("预期文档摘要"),
    };
    let read = || {
        DocumentStep::Read(DocumentSelection {
            document_id: summary["documentId"].as_str().unwrap().into(),
            start_line: 1,
            end_line: 1,
        })
    };
    assert_eq!(
        step(&generation, &b, read()).err().unwrap().0,
        "documentNotFound"
    );
    assert!(
        matches!(step(&generation,a,read()).unwrap(),ImportReply::Document(v) if v["text"]=="selected")
    );
    assert!(
        matches!(step(&generation,&b,DocumentStep::List).unwrap(),ImportReply::Document(v) if v.as_array().unwrap().is_empty())
    );
    let close = call(json!({"command":"beginClose","generation":generation}));
    call(json!({"command":"abortClose","generation":generation,"closeToken":close["closeToken"]}));
    assert_eq!(step(&generation, a, commit(e)).err().unwrap().0, "closing");
    let replacement = call(json!({"command":"bootstrap"}));
    assert_ne!(replacement["generation"], generation);
    assert_eq!(
        step(&generation, a, commit(e)).err().unwrap().0,
        "staleGeneration"
    );
    assert!(host.mock_records().is_empty());
    host.shutdown().unwrap();
    fs::remove_dir_all(root.path()).unwrap();
}
