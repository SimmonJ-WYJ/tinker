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
