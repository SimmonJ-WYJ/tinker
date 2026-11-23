//! #33旧seed项目认领不改来源、用户元数据或旧journal的workspace invariant。
use super::{
    import_tests::{call, profiles, source, Temp},
    *,
};
use std::{
    fs,
    io::{Read, Write},
    net::TcpListener,
    time::{Duration, Instant},
};
fn listed(runtime: &DesktopRuntime, sid: &str) -> Value {
    call(runtime, "sessions.list", json!({}))["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["sessionId"] == sid)
        .unwrap()
        .clone()
}
fn send(runtime: &DesktopRuntime, sid: &str, rid: &str, input: &str) {
    call(
        runtime,
        "chat.send",
        json!({"sessionId":sid,"requestId":rid,"profileId":"synthetic-local","modelId":"synthetic-model","userMessage":input,"startedAt":300,"effort":null}),
    );
    let until = Instant::now() + Duration::from_secs(5);
    loop {
        let p = call(
            runtime,
            "chat.events",
            json!({"sessionId":sid,"requestId":rid,"afterSequence":0,"limit":64}),
        );
        if p["turn"]["status"] == "completed" {
            break;
        }
        assert!(Instant::now() < until, "{p}");
        std::thread::sleep(Duration::from_millis(5));
    }
}
#[test]
fn legacy_import_workspace_claim_preserves_seed_renames_native_turns_and_old_journal() {
    let t = Temp::new();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/chat", listener.local_addr().unwrap());
    let server = std::thread::spawn(move || {
        for current in ["native before", "native after"] {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut bytes = Vec::new();
            loop {
                let mut buf = [0; 4096];
                let n = socket.read(&mut buf).unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&buf[..n]);
                assert!(bytes.len() < 65536);
                if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    let header = String::from_utf8_lossy(&bytes[..end]);
                    let len: usize = header
                        .lines()
                        .find_map(|v| {
                            v.to_ascii_lowercase()
                                .strip_prefix("content-length: ")
                                .map(str::to_owned)
                        })
                        .unwrap()
                        .parse()
                        .unwrap();
                    if bytes.len() >= end + 4 + len {
                        let body: Value = serde_json::from_slice(&bytes[end + 4..]).unwrap();
                        let mut expected = vec![
                            json!({"role":"user","content":"旧问题中文"}),
                            json!({"role":"assistant","content":"旧回答✨"}),
                        ];
                        if current == "native after" {
                            expected.extend([
                                json!({"role":"user","content":"native before"}),
                                json!({"role":"assistant","content":"native answer"}),
                            ]);
                        }
                        expected.push(json!({"role":"user","content":current}));
                        assert_eq!(body["messages"], json!(expected));
                        break;
                    }
                }
            }
            let body="data: {\"choices\":[{\"delta\":{\"content\":\"native answer\"}}]}\n\ndata: [DONE]\n\n";
            write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
        }
        listener.set_nonblocking(true).unwrap();
        std::thread::sleep(Duration::from_millis(30));
        assert!(listener.accept().is_err());
    });
    let runtime = DesktopRuntime::open(&t.0, profiles(&endpoint)).unwrap();
    let sid = runtime
        .import_electron_session(&source(), "synthetic-local", |_| Ok(vec![]))
        .unwrap()
        .session_id;
    send(&runtime, &sid, "native-before", "native before");
    call(
        &runtime,
        "sessions.update",
        json!({"sessionId":sid,"title":"User renamed","pinned":false,"archived":true}),
    );
    let seed_path =
        t.0.join("desktop-runtime-v1")
            .join(&sid)
            .join("imported-session-v1.json");
    let seed = fs::read(&seed_path).unwrap();
    let journal_path = t.0.join("desktop-runtime-v1/journal.jsonl");
    let journal = fs::read(&journal_path).unwrap();
    let r = runtime
        .import_electron_session_in_workspace(
            &source(),
            "synthetic-local",
            Some("project-a"),
            |_| panic!("认领不重新stage附件"),
        )
        .unwrap();
    assert!(!r.imported);
    assert_eq!(r.session_id, sid);
    let s = listed(&runtime, &sid);
    assert_eq!(s["workspaceId"], "project-a");
    assert_eq!(s["title"], "User renamed");
    assert_eq!(s["pinned"], false);
    assert_eq!(s["archived"], true);
    assert_eq!(fs::read(&seed_path).unwrap(), seed);
    assert_eq!(fs::read(&journal_path).unwrap(), journal);
    assert!(
        !runtime
            .import_electron_session(&source(), "synthetic-local", |_| panic!("旧API不改归属"))
            .unwrap()
            .imported
    );
    assert!(
        !runtime
            .import_electron_session_in_workspace(
                &source(),
                "synthetic-local",
                Some("project-a"),
                |_| panic!("重复认领")
            )
            .unwrap()
            .imported
    );
    assert_eq!(
        runtime
            .import_electron_session_in_workspace(
                &source(),
                "synthetic-local",
                Some("project-b"),
                |_| Ok(vec![])
            )
            .err(),
        Some(DesktopError("importConflict"))
    );
    let updated = call(
        &runtime,
        "sessions.update",
        json!({"sessionId":sid,"title":"Renamed after claim"}),
    );
    assert_eq!(updated["workspaceId"], "project-a");
    drop(runtime);
    let runtime = DesktopRuntime::open(&t.0, profiles(&endpoint)).unwrap();
    assert_eq!(listed(&runtime, &sid)["workspaceId"], "project-a");
    assert_eq!(listed(&runtime, &sid)["title"], "Renamed after claim");
    send(&runtime, &sid, "native-after", "native after");
    server.join().unwrap();
    let lines = fs::read_to_string(journal_path).unwrap();
    for line in lines.lines() {
        let v: Value = serde_json::from_str(line).unwrap();
        if v["entry"]["kind"] == "session" {
            assert_eq!(v["entry"]["session"]["workspaceId"], Value::Null);
        }
    }
    assert_eq!(fs::read(seed_path).unwrap(), seed);
}
#[test]
fn new_import_workspace_is_immutable_and_legacy_api_does_not_clear_it() {
    let t = Temp::new();
    let runtime = DesktopRuntime::open(&t.0, profiles("http://127.0.0.1:9/chat")).unwrap();
    let sid = runtime
        .import_electron_session_in_workspace(
            &source(),
            "synthetic-local",
            Some("project-a"),
            |_| Ok(vec![]),
        )
        .unwrap()
        .session_id;
    assert_eq!(listed(&runtime, &sid)["workspaceId"], "project-a");
    assert_eq!(
        runtime
            .import_electron_session_in_workspace(
                &source(),
                "synthetic-local",
                Some("project-b"),
                |_| Ok(vec![])
            )
            .err(),
        Some(DesktopError("importConflict"))
    );
    assert!(
        !runtime
            .import_electron_session(&source(), "synthetic-local", |_| panic!())
            .unwrap()
            .imported
    );
    drop(runtime);
    let runtime = DesktopRuntime::open(&t.0, profiles("http://127.0.0.1:9/chat")).unwrap();
    assert_eq!(listed(&runtime, &sid)["workspaceId"], "project-a");
    call(&runtime, "sessions.delete", json!({"sessionId":sid}));
    assert_eq!(
        runtime
            .import_electron_session_in_workspace(
                &source(),
                "synthetic-local",
                Some("project-a"),
                |_| Ok(vec![])
            )
            .err(),
        Some(DesktopError("importConflict"))
    );
}
#[cfg(unix)]
#[test]
fn workspace_claim_permission_failure_and_partial_temporary_retry_are_recoverable() {
    use std::os::unix::fs::PermissionsExt;
    let t = Temp::new();
    let runtime = DesktopRuntime::open(&t.0, profiles("http://127.0.0.1:9/chat")).unwrap();
    let sid = runtime
        .import_electron_session(&source(), "synthetic-local", |_| Ok(vec![]))
        .unwrap()
        .session_id;
    let dir = t.0.join("desktop-runtime-v1").join(&sid);
    let seed = fs::read(dir.join("imported-session-v1.json")).unwrap();
    let journal = fs::read(t.0.join("desktop-runtime-v1/journal.jsonl")).unwrap();
    let permissions = fs::metadata(&dir).unwrap().permissions();
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o500)).unwrap();
    let result = runtime.import_electron_session_in_workspace(
        &source(),
        "synthetic-local",
        Some("project-a"),
        |_| panic!("不重新导入"),
    );
    fs::set_permissions(&dir, permissions).unwrap();
    assert_eq!(result.err(), Some(DesktopError("storeIo")));
    assert_eq!(listed(&runtime, &sid)["workspaceId"], Value::Null);
    drop(runtime);
    let runtime = DesktopRuntime::open(&t.0, profiles("http://127.0.0.1:9/chat")).unwrap();
    assert!(
        !runtime
            .import_electron_session_in_workspace(
                &source(),
                "synthetic-local",
                Some("project-a"),
                |_| panic!()
            )
            .unwrap()
            .imported
    );
    let path = dir.join("import-workspace-v1.json");
    let bytes = fs::read(&path).unwrap();
    drop(runtime);
    fs::remove_file(&path).unwrap();
    fs::write(
        dir.join(".import-workspace-v1.json.tmp"),
        &bytes[..bytes.len() / 2],
    )
    .unwrap();
    let runtime = DesktopRuntime::open(&t.0, profiles("http://127.0.0.1:9/chat")).unwrap();
    assert_eq!(listed(&runtime, &sid)["workspaceId"], Value::Null);
    runtime
        .import_electron_session_in_workspace(
            &source(),
            "synthetic-local",
            Some("project-a"),
            |_| panic!(),
        )
        .unwrap();
    assert_eq!(fs::read(path).unwrap(), bytes);
    assert_eq!(
        fs::read(dir.join("imported-session-v1.json")).unwrap(),
        seed
    );
    assert_eq!(
        fs::read(t.0.join("desktop-runtime-v1/journal.jsonl")).unwrap(),
        journal
    );
}
#[test]
fn workspace_claim_reads_disk_before_retry_and_quarantines_only_its_invalid_association() {
    let t = Temp::new();
    let runtime = DesktopRuntime::open(&t.0, profiles("http://127.0.0.1:9/chat")).unwrap();
    let sid = runtime
        .import_electron_session(&source(), "synthetic-local", |_| Ok(vec![]))
        .unwrap()
        .session_id;
    call(
        &runtime,
        "sessions.create",
        json!({"title":"native stays","profileId":"synthetic-local","workspaceId":null,"reuseDraft":false}),
    );
    let dir = t.0.join("desktop-runtime-v1").join(&sid);
    runtime
        .import_electron_session_in_workspace(
            &source(),
            "synthetic-local",
            Some("project-b"),
            |_| panic!(),
        )
        .unwrap();
    let path = dir.join("import-workspace-v1.json");
    let before = fs::read(&path).unwrap();
    let association: Value = serde_json::from_slice(&before).unwrap();
    drop(runtime);
    fs::remove_file(&path).unwrap();
    let runtime = DesktopRuntime::open(&t.0, profiles("http://127.0.0.1:9/chat")).unwrap();
    fs::write(&path, &before).unwrap();
    assert_eq!(
        runtime
            .import_electron_session_in_workspace(
                &source(),
                "synthetic-local",
                Some("project-a"),
                |_| panic!()
            )
            .err(),
        Some(DesktopError("importConflict"))
    );
    assert_eq!(fs::read(&path).unwrap(), before);
    drop(runtime);
    let runtime = DesktopRuntime::open(&t.0, profiles("http://127.0.0.1:9/chat")).unwrap();
    assert_eq!(listed(&runtime, &sid)["workspaceId"], "project-b");
    drop(runtime);
    let mut corrupt = association;
    corrupt["fingerprint"] = json!("0".repeat(64));
    fs::write(&path, serde_json::to_vec(&corrupt).unwrap()).unwrap();
    let runtime = DesktopRuntime::open(&t.0, profiles("http://127.0.0.1:9/chat")).unwrap();
    assert_eq!(listed(&runtime, &sid)["importError"], "corruptImport");
    assert_eq!(
        call(&runtime, "sessions.list", json!({}))["sessions"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        call(
            &runtime,
            "sessions.historyV2",
            json!({"sessionId":"session-2","after":0,"limit":128})
        )["turns"],
        json!([])
    );
}
#[test]
fn workspace_import_uses_identity_not_same_title_and_rejects_changed_source() {
    let t = Temp::new();
    let runtime = DesktopRuntime::open(&t.0, profiles("http://127.0.0.1:9/chat")).unwrap();
    let mut second = source();
    second.source_session_id = "synthetic-other-source".into();
    let first = runtime
        .import_electron_session_in_workspace(
            &source(),
            "synthetic-local",
            Some("project-a"),
            |_| Ok(vec![]),
        )
        .unwrap();
    let other = runtime
        .import_electron_session_in_workspace(&second, "synthetic-local", Some("project-b"), |_| {
            Ok(vec![])
        })
        .unwrap();
    assert_ne!(first.session_id, other.session_id);
    assert_eq!(
        listed(&runtime, &first.session_id)["title"],
        listed(&runtime, &other.session_id)["title"]
    );
    assert_eq!(
        listed(&runtime, &first.session_id)["workspaceId"],
        "project-a"
    );
    assert_eq!(
        listed(&runtime, &other.session_id)["workspaceId"],
        "project-b"
    );
    let mut changed = source();
    changed.messages[0].text = "changed source".into();
    assert_eq!(
        runtime
            .import_electron_session_in_workspace(
                &changed,
                "synthetic-local",
                Some("project-a"),
                |_| Ok(vec![])
            )
            .err(),
        Some(DesktopError("importConflict"))
    );
    assert_eq!(
        runtime
            .import_electron_session_in_workspace(
                &source(),
                "synthetic-local",
                Some("../project"),
                |_| Ok(vec![])
            )
            .err(),
        Some(DesktopError("invalidId"))
    );
}
#[test]
fn valid_json_workspace_claim_corruption_does_not_silently_reassign_session() {
    let t = Temp::new();
    let runtime = DesktopRuntime::open(&t.0, profiles("http://127.0.0.1:9/chat")).unwrap();
    let sid = runtime
        .import_electron_session(&source(), "synthetic-local", |_| Ok(vec![]))
        .unwrap()
        .session_id;
    runtime
        .import_electron_session_in_workspace(
            &source(),
            "synthetic-local",
            Some("project-a"),
            |_| panic!(),
        )
        .unwrap();
    drop(runtime);
    let path =
        t.0.join("desktop-runtime-v1")
            .join(&sid)
            .join("import-workspace-v1.json");
    let mut record: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    record["workspaceId"] = json!("project-b");
    fs::write(path, serde_json::to_vec(&record).unwrap()).unwrap();
    let runtime = DesktopRuntime::open(&t.0, profiles("http://127.0.0.1:9/chat")).unwrap();
    assert_eq!(listed(&runtime, &sid)["importError"], "corruptImport");
}
