//! 可移植会话的持久化、原子提交、隔离与接续。
use super::*;
use crate::desktop_runtime::import_tests::{call, profiles, source, Temp};

#[test]
fn restored_sessions_reopen_with_stable_ids_and_do_not_replay() {
    let a = Temp::new();
    let b = Temp::new();
    let open = |p: &Path| DesktopRuntime::open(p, profiles("http://127.0.0.1:9/chat")).unwrap();
    let src = open(&a.0);
    let sid = src
        .import_electron_session_in_workspace(
            &source(),
            "synthetic-local",
            Some("workspace-a"),
            |_| Ok(vec![]),
        )
        .unwrap()
        .session_id;
    let values = src.export_portable_sessions("workspace-a").unwrap();
    assert!(src
        .export_portable_sessions("workspace-b")
        .unwrap()
        .is_empty());
    let contents = serde_json::to_string(&values).unwrap();
    assert!(!contents.contains("synthetic-local") && !contents.contains("synthetic-import-key"));
    let dst = open(&b.0);
    assert!(dst
        .preflight_portable_sessions("workspace-b", &values)
        .is_err());
    dst.restore_portable_sessions("workspace-a", &values, || Ok(()))
        .unwrap();
    drop(dst);
    let dst = open(&b.0);
    dst.restore_portable_sessions("workspace-a", &values, || Ok(()))
        .unwrap();
    let history = call(
        &dst,
        "sessions.historyV2",
        json!({"sessionId":sid,"after":0,"limit":4}),
    );
    assert_eq!(history["turns"].as_array().unwrap().len(), 2);
    assert_eq!(history["turns"][0]["userMessage"], "旧问题中文");
    assert_eq!(
        serde_json::to_string(&dst.export_portable_sessions("workspace-a").unwrap()).unwrap(),
        contents
    );
    let journal = fs::read_to_string(b.0.join("desktop-runtime-v1/journal.jsonl")).unwrap();
    assert_eq!(journal.lines().count(), 1);
}

#[test]
fn conflicts_and_failed_catalog_publish_do_not_expose_partial_sessions() {
    let a = Temp::new();
    let b = Temp::new();
    let open = |p: &Path| DesktopRuntime::open(p, profiles("http://127.0.0.1:9/chat")).unwrap();
    let src = open(&a.0);
    src.import_electron_session_in_workspace(
        &source(),
        "synthetic-local",
        Some("workspace-a"),
        |_| Ok(vec![]),
    )
    .unwrap();
    let values = src.export_portable_sessions("workspace-a").unwrap();
    let dst = open(&b.0);
    assert!(dst
        .restore_portable_sessions("workspace-a", &values, || Err(DesktopError("storeIo")))
        .is_err());
    assert!(dst
        .export_portable_sessions("workspace-a")
        .unwrap()
        .is_empty());
    drop(dst);
    let dst = open(&b.0);
    dst.restore_portable_sessions("workspace-a", &values, || Ok(()))
        .unwrap();
    let mut changed = values;
    changed[0].messages[0].text = "cannot replace".into();
    assert_eq!(
        dst.preflight_portable_sessions("workspace-a", &changed),
        Err(DesktopError("importConflict"))
    );
}
#[test]
fn overlapping_native_ids_keep_isolation_and_continue_then_export_again() {
    use std::time::{Duration, Instant};
    let a = Temp::new();
    let b = Temp::new();
    let mock = crate::formal_mock::OwnedMock::start().unwrap();
    let open = |p: &Path| DesktopRuntime::open(p, mock.profiles().unwrap()).unwrap();
    let create = |rt: &DesktopRuntime, w: &str| {
        call(
            rt,
            "sessions.create",
            json!({"title":w,"workspaceId":w,"profileId":"local-mock","reuseDraft":false}),
        )["sessionId"]
            .as_str()
            .unwrap()
            .to_string()
    };
    let send = |rt: &DesktopRuntime, sid: &str, rid: &str, text: &str| {
        call(
            rt,
            "chat.send",
            json!({"sessionId":sid,"requestId":rid,"profileId":"local-mock","modelId":"local-mock-a","userMessage":text,"startedAt":500,"effort":null}),
        );
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let turn = call(
                rt,
                "chat.events",
                json!({"sessionId":sid,"requestId":rid,"afterSequence":0,"limit":32}),
            );
            if turn["turn"]["status"] == "completed" {
                break;
            }
            assert!(Instant::now() < deadline, "{turn}");
            std::thread::sleep(Duration::from_millis(10));
        }
    };
    let src = open(&a.0);
    let dst = open(&b.0);
    let source_sid = create(&src, "project-a");
    let destination_sid = create(&dst, "project-b");
    assert_eq!(source_sid, destination_sid);
    send(&src, &source_sid, "native-one", "first");
    let mut portable = src.export_portable_sessions("project-a").unwrap();
    let map = dst
        .map_portable_sessions("project-a", &mut portable)
        .unwrap();
    let restored = &map[&source_sid];
    assert_ne!(restored, &destination_sid);
    dst.restore_portable_sessions("project-a", &portable, || Ok(()))
        .unwrap();
    drop(dst);
    let dst = open(&b.0);
    assert_eq!(dst.history_extent(&destination_sid).unwrap(), 0);
    assert_eq!(dst.history_extent(restored).unwrap(), 1);
    assert_eq!(mock.records().len(), 1);
    send(&dst, restored, "native-two", "second");
    let records = mock.records();
    assert_eq!(records.len(), 2);
    assert_eq!(
        (records[1].user_messages, records[1].assistant_messages),
        (2, 1)
    );
    let again = dst.export_portable_sessions("project-a").unwrap();
    assert_eq!(again[0].turns.len(), 2);
    let mut original = src.export_portable_sessions("project-a").unwrap();
    assert_eq!(
        dst.map_portable_sessions("project-a", &mut original)
            .unwrap(),
        map
    );
    dst.restore_portable_sessions("project-a", &original, || Ok(()))
        .unwrap();
    assert_eq!(dst.history_extent(restored).unwrap(), 2);
}

#[test]
fn unpublished_fork_reuses_its_intent_and_keeps_global_scope_after_restart() {
    let tmp = Temp::new();
    let open = || DesktopRuntime::open(&tmp.0, profiles("http://127.0.0.1:9/chat")).unwrap();
    let rt = open();
    let parent = call(
        &rt,
        "sessions.create",
        json!({"title":"Original","workspaceId":null,
        "profileId":"synthetic-local","reuseDraft":false}),
    );
    let source = parent["sessionId"].as_str().unwrap();
    let turn: Turn = serde_json::from_value(json!({"sessionId":source,"requestId":"first","runId":"first",
        "userMessageId":"first-user","assistantMessageId":"first-assistant","profileId":"synthetic-local",
        "modelId":"synthetic","configRevision":"1","startedAt":1,"userMessage":"Hello","assistantMessage":"Hi",
        "status":"completed","sequence":2,"errorCode":null})).unwrap();
    let root = tmp.0.join("desktop-runtime-v1");
    let sid = format!(
        "portable-{}",
        &digest(&("fork-v1", source, "first-assistant", 0)).unwrap()[..40]
    );
    let intent = root.join(format!(".fork-{sid}.json"));
    let mut held: Session = serde_json::from_value(parent.clone()).unwrap();
    held.session_id = sid.clone();
    held.title = "Original (fork)".into();
    write_json(&intent, &held).unwrap();
    drop(rt);
    let rt = open();
    assert!(rt
        .fork_completed_turns(
            source,
            "first-assistant",
            vec![turn.clone()],
            None,
            |_| Err(DesktopError("storeIo"))
        )
        .is_err());
    assert!(rt.history_extent(&sid).is_err());
    assert!(intent.is_file());
    let restored = rt
        .fork_completed_turns(source, "first-assistant", vec![turn.clone()], None, |_| {
            Ok(None)
        })
        .unwrap();
    assert_eq!(restored["sessionId"], sid);
    assert_eq!(restored["createdAt"], held.created_at);
    assert!(restored["workspaceId"].is_null() && !intent.exists());
    assert_ne!(
        rt.fork_completed_turns(source, "first-assistant", vec![turn], None, |_| Ok(None))
            .unwrap()["sessionId"],
        sid
    );
    drop(rt);
    let rt = open();
    assert_eq!(rt.history_extent(&sid).unwrap(), 1);
    assert_eq!(rt.history_extent(source).unwrap(), 0);
    assert!(rt.preflight_portable_sessions("../outside", &[]).is_err());
}

#[test]
fn parked_revision_route_survives_restart_without_becoming_portable_history() {
    let tmp = Temp::new();
    let open = || DesktopRuntime::open(&tmp.0, profiles("http://127.0.0.1:9/chat")).unwrap();
    let rt = open();
    let parent = call(
        &rt,
        "sessions.create",
        json!({"title":"Parent","profileId":"synthetic-local","workspaceId":"orchard","reuseDraft":false}),
    );
    let source = parent["sessionId"].as_str().unwrap();
    let route = super::RevisionRoute {
        channel_id: "synthetic-local".into(),
        model_id: "synthetic-model".into(),
        config_revision: "previous-binding".into(),
    };
    let draft = super::RevisionDraft {
        route: route.clone(),
        document: None,
        image: None,
    };
    let child = rt
        .fork_completed_turns(
            source,
            "revision:selected",
            vec![],
            Some((&draft, "Parked question")),
            |_| Ok(None),
        )
        .unwrap();
    let sid = child["sessionId"].as_str().unwrap();
    assert_eq!(child["title"], "Parked question (fork)");
    assert!(child.get("nativeRevisionRoute").is_some());
    let dir = tmp.0.join("desktop-runtime-v1").join(sid);
    let seed: Seed = read_json(&dir.join(SEED)).unwrap();
    // v1 的路由文件及 journal 摘要在两版中相同。
    assert_eq!(
        seed.fingerprint,
        format!("revision-route-v1:{}", digest(&(sid, &route)).unwrap())
    );
    assert_eq!(
        read_json::<super::RevisionRoute>(&dir.join("revision-route-v1.json")).unwrap(),
        route
    );
    let suggestion = json!({"documentId":"doc-00000000000000000000000000000002", "filename":"historical.pdf",
        "page":2,"startLine":1,"endLine":2});
    let cited = super::RevisionDraft {
        route,
        document: Some(serde_json::from_value(suggestion.clone()).unwrap()),
        image: None,
    };
    let cited_child = rt
        .fork_completed_turns(
            source,
            "revision:cited",
            vec![],
            Some((&cited, "Cited question")),
            |_| Ok(None),
        )
        .unwrap();
    let cited_sid = cited_child["sessionId"].as_str().unwrap();
    let cited_dir = tmp.0.join("desktop-runtime-v1").join(cited_sid);
    let cited_seed: Seed = read_json(&cited_dir.join(SEED)).unwrap();
    assert!(cited_seed.fingerprint.starts_with("revision-cited-v2:"));
    assert_eq!(cited_child["nativeRevisionDocument"], suggestion);
    assert!(rt.locally_bound_image_history(cited_sid).unwrap());
    drop(rt);
    let reopened = open();
    let sessions = call(&reopened, "sessions.list", json!({}));
    let list = sessions["sessions"].as_array().unwrap();
    assert_eq!(
        list.iter().find(|s| s["sessionId"] == sid).unwrap()["nativeRevisionRoute"],
        json!({"channelId":"synthetic-local","modelId":"synthetic-model","configRevision":"previous-binding"})
    );
    assert!(list
        .iter()
        .find(|s| s["sessionId"] == source)
        .unwrap()
        .get("nativeRevisionRoute")
        .is_none());
    let rejected = reopened.dispatch(json!({"version":1,"id":"guarded-first-send","method":"chat.send",
        "params":{"sessionId":sid,"requestId":"explicit-edit","profileId":"synthetic-local","modelId":"synthetic-model",
        "userMessage":"Revised","startedAt":300,"effort":null}})).unwrap();
    assert_eq!(rejected.error.unwrap().code, "sourceChannelUnavailable");
    assert_eq!(reopened.history_extent(sid).unwrap(), 0);
    let backup =
        serde_json::to_string(&reopened.export_portable_sessions("orchard").unwrap()).unwrap();
    assert!(!backup.contains("previous-binding"));
    assert!(!backup.contains("revisionRoute"));
    assert!(!backup.contains("historical.pdf"));
    assert!(!backup.contains(suggestion["documentId"].as_str().unwrap()));
    let restored = Temp::new();
    let rt_restored =
        DesktopRuntime::open(&restored.0, profiles("http://127.0.0.1:9/chat")).unwrap();
    let archive: Vec<PortableSession> = serde_json::from_str(&backup).unwrap();
    rt_restored
        .restore_portable_sessions("orchard", &archive, || Ok(()))
        .unwrap();
    let rows = call(&rt_restored, "sessions.list", json!({}));
    assert!(!rt_restored.locally_bound_image_history(cited_sid).unwrap());
    let imported = rows["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["sessionId"] == cited_sid)
        .unwrap();
    assert!(
        imported.get("nativeRevisionDocument").is_none()
            && imported.get("nativeRevisionRoute").is_none()
    );

    let sidecar = cited_dir.join("revision-route-v1.json");
    let mut changed: Value = read_json(&sidecar).unwrap();
    changed["document"]["page"] = json!(1);
    write_json(&sidecar, &changed).unwrap();
    assert!(matches!(
        load(&cited_dir, cited_sid, &cited_seed.integrity),
        Err(DesktopError("corruptImport"))
    ));
}

#[test]
fn image_revision_recovers_its_child_local_reference_until_image_admission() {
    use crate::formal_images::{ImageAction, ImageProtocol, ImageRoute, ImageStore};
    let tmp = Temp::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&tmp.0, fs::Permissions::from_mode(0o700)).unwrap();
    }
    let open = || DesktopRuntime::open(&tmp.0, profiles("http://127.0.0.1:9/chat")).unwrap();
    let images = ImageStore::open(&tmp.0).unwrap();
    let rt = open();
    let parent = call(
        &rt,
        "sessions.create",
        json!({"title":"Parent","profileId":"synthetic-local",
        "workspaceId":"orchard","reuseDraft":false}),
    );
    let draft: super::RevisionDraft = serde_json::from_value(json!({
        "channelId":"synthetic-local","modelId":"image-model","configRevision":"r7"
    }))
    .unwrap();
    let child = rt
        .fork_completed_turns(
            parent["sessionId"].as_str().unwrap(),
            "revision:image",
            vec![],
            Some((&draft, "new image")),
            |sid| {
                Ok(Some(
                    serde_json::from_value(
                        json!({"imageId":"ref-qa", "localPath":format!("{sid}/ref-qa.png"),
                "filename":"ref-qa.png","displayName":"photo.png","mediaType":"image/png"}),
                    )
                    .unwrap(),
                ))
            },
        )
        .unwrap();
    let sid = child["sessionId"].as_str().unwrap();
    let seed: Seed = read_json(&tmp.0.join("desktop-runtime-v1").join(sid).join(SEED)).unwrap();
    assert!(seed.fingerprint.starts_with("revision-image-v3:"));
    drop(rt);

    let first = open();
    first.recover_image_revision_drafts(&images).unwrap();
    assert_eq!(
        json!(first.parked_image_revision(sid).unwrap().unwrap().image),
        child["nativeRevisionImage"]
    );
    // 用户选择不附图。模拟图片收据已确认而运行时尚未清理草稿时完整退出。
    let request = images
        .admit_routed(
            sid,
            "new-generation",
            "without source",
            None,
            123,
            None,
            None,
            &ImageRoute {
                channel_id: "synthetic-local".into(),
                model_id: "image-model".into(),
                revision: "r7".into(),
                protocol: ImageProtocol::OpenaiImages,
                action: ImageAction::Generate,
            },
        )
        .unwrap();
    drop(request);
    drop(first);
    drop(images);
    let file = tmp
        .0
        .join("formal-images-v1")
        .join(format!("{:x}", Sha256::digest(sid.as_bytes())))
        .join("routed-images-v1.json");
    let good = fs::read(&file).unwrap();
    fs::write(&file, b"damaged").unwrap();
    let damaged = open();
    let images = ImageStore::open(&tmp.0).unwrap();
    damaged.recover_image_revision_drafts(&images).unwrap();
    assert_eq!(
        damaged.parked_image_revision(sid).unwrap_err().0,
        "corruptImport"
    );
    assert!(damaged.latest_text_task(sid).is_err());
    let parent = parent["sessionId"].as_str().unwrap();
    assert!(damaged.locally_bound_image_history(parent).unwrap());
    assert!(damaged.latest_text_task(parent).unwrap().is_none());
    let rows = call(&damaged, "sessions.list", json!({}));
    let quarantined = rows["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["sessionId"] == sid)
        .unwrap();
    assert_eq!(quarantined["importError"], "corruptImport");
    assert!(
        quarantined.get("nativeRevisionRoute").is_none()
            && quarantined.get("nativeRevisionImage").is_none()
    );
    drop(damaged);
    drop(images);
    fs::write(&file, good).unwrap();
    let last = open();
    let images = ImageStore::open(&tmp.0).unwrap();
    last.recover_image_revision_drafts(&images).unwrap();
    assert!(last.parked_image_revision(sid).unwrap().is_none());
    assert!(last.latest_text_task(sid).unwrap().is_none());
    let rows = call(&last, "sessions.list", json!({}));
    let consumed = rows["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["sessionId"] == sid)
        .unwrap();
    assert!(consumed.get("nativeRevisionRoute").is_none());
    assert!(consumed.get("nativeRevisionImage").is_none());
    assert_eq!(images.history(sid).unwrap().len(), 1);
}
