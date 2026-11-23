use super::*;
use crate::{
    electron_import::{ImportWarning, SourceMessage, SourceSession},
    formal_host::FormalHost,
    formal_platform::{HostEnvironment, TrustedRoot},
};
use std::{fs, time::Duration};
fn sample(id: &str) -> SourceSession {
    SourceSession {
        source_session_id: id.into(),
        title: "Backup conversation".into(),
        created_at: 123,
        updated_at: 124,
        pinned: false,
        archived: false,
        attachments: vec![],
        messages: vec![SourceMessage {
            id: "m1".into(),
            role: "user".into(),
            text: "A synthetic note".into(),
            created_at: 123,
            attachment_ids: vec![],
        }],
    }
}
#[test]
fn interrupted_commit_reports_confirmed_work_and_stops_without_exposing_source_ids() {
    let batch = ImportBatch {
        projects: vec![],
        session_projects: Default::default(),
        sessions: ["one", "two", "three", "four", "five"].map(sample).into(),
        warnings: vec![ImportWarning {
            code: "missingHistory".into(),
            session_id: Some("private-name".into()),
            count: 2,
        }],
        skipped: 1,
    };
    let mut results = [
        Ok(true),
        Ok(false),
        Err(DesktopError("importConflict")),
        Err(DesktopError("recoveryRequired")),
    ]
    .into_iter();
    let report = serde_json::to_value(persist(batch, |_| results.next().unwrap())).unwrap();
    assert_eq!(
        report,
        json!({"cancelled":false,"projectsImported":0,"projectsUpdated":0,"imported":1,"unchanged":1,"unconfirmed":1,"skipped":3,"warnings":{"missingHistory":2,"importConflict":1,"importUnconfirmed":1,"importStopped":1}})
    );
}
#[test]
fn skipped_project_session_does_not_prevent_later_global_session_import() {
    let batch = ImportBatch {
        projects: vec![],
        session_projects: Default::default(),
        sessions: ["invalid-owner", "global"].map(sample).into(),
        warnings: vec![],
        skipped: 0,
    };
    let result = persist(batch, |session| {
        if session.source_session_id == "invalid-owner" {
            Err(DesktopError("unavailableProject"))
        } else {
            Ok(true)
        }
    });
    assert_eq!(
        (result.imported, result.skipped, result.unconfirmed),
        (1, 1, 0)
    );
    assert_eq!(result.warnings.get("unavailableProject"), Some(&1));
}
#[test]
fn expired_host_grants_cannot_commit_even_if_quit_is_aborted() {
    let dir = std::env::temp_dir().canonicalize().unwrap().join(format!(
        "tinker-tauri-formal-preview-test-session-grant-{}",
        crate::credentialed_channels::catalog::random_reference().unwrap()
    ));
    let root = TrustedRoot::create_temporary(dir.clone()).unwrap();
    let mut host =
        FormalHost::open(&root, HostEnvironment::new("darwin", false, false).unwrap()).unwrap();
    let call = |v| {
        host.command("main", v)
            .unwrap()
            .wait(Duration::from_secs(5))
            .unwrap()
    };
    let boot = || {
        let b = call(json!({"command":"bootstrap"}));
        assert_eq!(b["nativeSessionImport"], true);
        b["generation"].as_str().unwrap().to_owned()
    };
    let step = |g: &str, cmd| host.import_step(g.to_owned(), cmd).unwrap().recv().unwrap();
    let begin = |g: &str| match step(g, ImportStep::Begin).unwrap() {
        ImportReply::Permit { destination, epoch } => {
            assert_eq!(destination, dir);
            epoch
        }
        _ => panic!("无目录导入授权"),
    };
    let g = boot();
    let epoch = begin(&g);
    let close = call(json!({"command":"beginClose","generation":g}));
    call(json!({"command":"abortClose","generation":g,"closeToken":close["closeToken"]}));
    assert_eq!(
        step(&g, ImportStep::Commit(epoch, Box::new(sample("first"))))
            .err()
            .unwrap()
            .0,
        "closing"
    );
    let epoch = begin(&g);
    let g2 = boot();
    assert_eq!(
        step(&g, ImportStep::Commit(epoch, Box::new(sample("second"))))
            .err()
            .unwrap()
            .0,
        "staleGeneration"
    );
    let epoch = begin(&g2);
    let marker = dir.join("preview.json");
    let original = fs::read(&marker).unwrap();
    fs::write(&marker, b"{}").unwrap();
    assert_eq!(
        step(&g2, ImportStep::Commit(epoch, Box::new(sample("third"))))
            .err()
            .unwrap()
            .0,
        "invalidRoot"
    );
    fs::write(marker, original).unwrap();
    assert!(host.mock_records().is_empty());
    host.shutdown().unwrap();
    fs::remove_dir_all(dir).unwrap();
}
#[test]
fn refuses_overlap_between_selected_folder_and_native_destination() {
    let temp = std::env::temp_dir()
        .canonicalize()
        .unwrap()
        .join(crate::credentialed_channels::catalog::random_reference().unwrap());
    fs::create_dir(&temp).unwrap();
    let sibling = temp.join("electron-copy");
    let native = temp.join("native-copy");
    fs::create_dir(&sibling).unwrap();
    fs::create_dir(&native).unwrap();
    for path in [
        &native,
        temp.as_path(),
        &native.join("sub"),
        &sibling.join("../escape"),
    ] {
        assert!(validate_source(path, &native).is_err());
    }
    assert!(validate_source(&sibling, &native).is_ok());
    let alias = temp.join("NATIVE-COPY");
    if alias.exists() {
        assert!(validate_source(&alias, &native).is_err());
    }
    fs::remove_dir_all(temp).unwrap();
}

#[test]
fn session_import_can_restore_and_export_its_own_png() {
    use crate::formal_agent::image_grant::{Outcome, Step};
    use crate::{electron_import::SourceAttachment, picked_image::encode_png};
    let dir = std::env::temp_dir().canonicalize().unwrap().join(format!(
        "tinker-tauri-formal-preview-test-session-asset-{}",
        crate::credentialed_channels::catalog::random_reference().unwrap()
    ));
    let root = TrustedRoot::create_temporary(dir.clone()).unwrap();
    let mut host =
        FormalHost::open(&root, HostEnvironment::new("darwin", false, false).unwrap()).unwrap();
    let call = |v| {
        host.command("main", v)
            .unwrap()
            .wait(Duration::from_secs(5))
            .unwrap()
    };
    let g = call(json!({"command":"bootstrap"}))["generation"]
        .as_str()
        .unwrap()
        .to_owned();
    call(json!({"command":"attach","generation":g,"observed":{}}));
    let epoch = match host
        .import_step(g.clone(), ImportStep::Begin)
        .unwrap()
        .recv()
        .unwrap()
        .unwrap()
    {
        ImportReply::Permit { epoch, .. } => epoch,
        _ => panic!("缺少导入授权"),
    };
    let bytes = encode_png(1, 1, png::ColorType::Rgb, &[120, 140, 160]).unwrap();
    let mut s = sample("asset-copy");
    s.attachments.push(SourceAttachment {
        id: "a1".into(),
        filename: "fixture.png".into(),
        media_type: "image/png".into(),
        bytes: bytes.clone(),
    });
    s.messages[0].attachment_ids.push("a1".into());
    for expected in [true, false] {
        assert!(
            matches!(host.import_step(g.clone(),ImportStep::Commit(epoch,Box::new(s.clone()))).unwrap().recv().unwrap().unwrap(),ImportReply::Committed(new) if new==expected)
        );
    }
    let sessions =
        call(json!({"command":"invoke","generation":g,"channel":"agent:list-sessions","args":[]}));
    let sid = sessions["value"][0]["id"].as_str().unwrap();
    let history = call(
        json!({"command":"restore","generation":g,"sessionId":sid,"observedDeliverySequence":0}),
    );
    let msg = &history["sdkMessages"][0];
    assert_eq!(msg["_electronSourceMessageId"], "m1");
    assert_eq!(msg["uuid"], format!("electron-import:{sid}:m1"));
    let rel = msg["_importedFiles"][0]["path"].as_str().unwrap();
    let filename = rel.strip_prefix(&format!("{sid}/")).unwrap();
    assert!(filename.starts_with("legacy-"));
    let image = |sid: &str, step| {
        host.image_grant(g.clone(), sid.into(), step)
            .unwrap()
            .recv()
            .unwrap()
    };
    let Outcome::Bytes(payload) = image(sid, Step::ReadExport(filename.into())).unwrap() else {
        panic!("缺少 PNG 字节")
    };
    assert_eq!(payload, bytes);
    let target = dir.join("exported.png");
    let stage = super::super::image_disk::stage_export(&target, &payload).unwrap();
    assert!(
        matches!(image(sid,Step::Export{filename:filename.into(),staged:stage}).unwrap(),Outcome::Finished(v) if v["value"]==true)
    );
    assert_eq!(fs::read(target).unwrap(), bytes);
    assert!(host.mock_records().is_empty());
    host.shutdown().unwrap();
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn configured_host_imports_projects_without_a_channel_and_reopens_selected_workspace() {
    let dir = std::env::temp_dir().canonicalize().unwrap().join(format!(
        "tinker-tauri-channels-preview-managed-projects-{}",
        crate::credentialed_channels::catalog::random_reference().unwrap()
    ));
    let root = TrustedRoot::create_channels_temporary(&dir).unwrap();
    let open = || {
        FormalHost::open_channels(&root, HostEnvironment::new("darwin", false, false).unwrap())
            .unwrap()
    };
    let mut host = open();
    let command = |h: &FormalHost, v| {
        h.command("main", v)
            .unwrap()
            .wait(Duration::from_secs(2))
            .unwrap()
    };
    let boot = command(&host, json!({"command":"bootstrap"}));
    assert_eq!(boot["nativeSessionImport"], true);
    assert_eq!(boot["nativeProjectBinding"], true);
    assert_eq!(boot["nativeProjectTaskStatuses"], true);
    let doc = boot["generation"].as_str().unwrap();
    let step = |s| {
        host.import_step(doc.into(), s)
            .unwrap()
            .recv()
            .unwrap()
            .unwrap()
    };
    let ImportReply::Permit { epoch, .. } = step(ImportStep::Begin) else {
        panic!("missing import grant")
    };
    let project = crate::electron_import::SourceProject {
        source_project_id: "p-a".into(),
        name: "Synthetic project".into(),
        created_at: 3,
        updated_at: 5,
        has_directory_hint: true,
    };
    let ImportReply::Projects(projects) = step(ImportStep::Projects {
        epoch,
        projects: vec![project],
        refs: Default::default(),
    }) else {
        panic!("missing projects")
    };
    let id = projects.ids["p-a"].clone();
    for expected in [true, false] {
        assert!(
            matches!(step(ImportStep::ProjectSession{epoch,workspace:id.clone(),source:Box::new(sample("old"))}),ImportReply::Committed(fresh) if fresh == expected)
        );
    }
    command(
        &host,
        json!({"command":"invoke","generation":doc,"channel":"settings:update","args":[{"agentWorkspaceId":id}],"mutation":{"expectedRevision":0,"mutationId":"select-project"}}),
    );
    host.shutdown().unwrap();
    drop(host);
    let mut host = open();
    let boot = command(&host, json!({"command":"bootstrap"}));
    assert_eq!(boot["platformSnapshot"]["settings"]["agentWorkspaceId"], id);
    assert!(boot["platformSnapshot"]["workspaces"]
        .as_array()
        .unwrap()
        .iter()
        .any(|p| p["id"] == id && p["directoryStatus"] == "unbound"));
    let sessions = command(
        &host,
        json!({"command":"invoke","generation":boot["generation"],"channel":"agent:list-sessions","args":[]}),
    );
    let rows = sessions["value"].as_array().unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["workspaceId"], id);
    host.shutdown().unwrap();
    fs::remove_dir_all(dir).unwrap();
}
