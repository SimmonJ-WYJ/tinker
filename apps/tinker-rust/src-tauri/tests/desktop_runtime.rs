use serde_json::{json, Value};
use std::fs;
use tinker_rust_foundation::desktop_runtime::DesktopRuntime;
#[path = "support/desktop.rs"]
mod support;
use support::*;
#[path = "support/http.rs"]
mod http_support;
#[test]
fn session_crud_draft_reuse_restart_and_tombstone() {
    let f = Fixture::new();
    let r = DesktopRuntime::open(&f.0, profiles()).unwrap();
    let first = create(&r, false)["result"].clone();
    let id = first["sessionId"].as_str().unwrap();
    assert_eq!(create(&r, true)["result"], first);
    assert_ne!(create(&r, false)["result"]["sessionId"], id);
    assert_eq!(
        call(
            &r,
            "sessions.update",
            json!({"sessionId":id,"title":"更新","pinned":true})
        )["result"]["title"],
        "更新"
    );
    assert_eq!(
        call(
            &r,
            "sessions.history",
            json!({"sessionId":id,"after":0,"limit":128})
        )["result"]["turns"],
        json!([])
    );
    drop(r);
    let r = DesktopRuntime::open(&f.0, profiles()).unwrap();
    assert_eq!(
        call(&r, "sessions.list", json!({}))["result"]["sessions"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        call(&r, "sessions.delete", json!({"sessionId":id}))["result"],
        json!({"deleted":true})
    );
    assert_eq!(
        call(
            &r,
            "sessions.history",
            json!({"sessionId":id,"after":0,"limit":128})
        )["error"]["code"],
        "sessionNotFound"
    );
}
#[test]
fn boundary_lock_and_corruption_fail_closed() {
    let f = Fixture::new();
    let r = DesktopRuntime::open(&f.0, profiles()).unwrap();
    assert!(DesktopRuntime::open(&f.0, profiles()).is_err());
    assert_eq!(
        call(
            &r,
            "sessions.create",
            json!({"title":"x","profileId":"local","workspaceId":null,"reuseDraft":false,"root":"/tmp"})
        )["error"]["code"],
        "invalidParams"
    );
    assert_eq!(
        call(&r, "unknown", json!({}))["error"]["code"],
        "unknownMethod"
    );
    assert_eq!(
        r.dispatch(json!({"version":2,"id":"valid","method":"runtime.describe","params":{}}))
            .unwrap()
            .error
            .unwrap()
            .code,
        "unsupportedVersion"
    );
    assert!(r
        .dispatch(json!({"version":1,"id":"../bad","method":"runtime.describe","params":{}}))
        .is_err());
    assert!(!call(&r, "profiles.list", json!({}))
        .to_string()
        .contains("fake-secret"));
    drop(r);
    fs::write(
        f.0.join("desktop-runtime-v1/journal.jsonl"),
        b"{\"version\":1",
    )
    .unwrap();
    assert!(DesktopRuntime::open(&f.0, profiles()).is_err());
}
#[test]
fn strict_nullable_fields_and_unknown_profile_configuration() {
    let f = Fixture::new();
    let r = DesktopRuntime::open(&f.0, profiles()).unwrap();
    assert_eq!(
        call(
            &r,
            "sessions.create",
            json!({"title":"x","profileId":"local","reuseDraft":false})
        )["error"]["code"],
        "invalidParams"
    );
    let id = create(&r, false)["result"]["sessionId"]
        .as_str()
        .unwrap()
        .to_string();
    let mut p = send_params(&id);
    p.as_object_mut().unwrap().remove("effort");
    assert_eq!(call(&r, "chat.send", p)["error"]["code"], "invalidParams");
    for endpoint in [
        "https://example.com/chat",
        "https://192.0.2.1/chat",
        "http://localhost/chat",
    ] {
        let mut p = profiles();
        p[0].endpoint = endpoint.into();
        assert!(DesktopRuntime::open(Fixture::new().0.clone(), p).is_err());
    }
}
#[test]
fn immutable_request_identity_and_failure_never_replay() {
    let f = Fixture::new();
    let r = DesktopRuntime::open(&f.0, profiles()).unwrap();
    let id = create(&r, false)["result"]["sessionId"]
        .as_str()
        .unwrap()
        .to_string();
    let p = send_params(&id);
    assert!(call(&r, "chat.send", p.clone()).get("result").is_some());
    for (field, value) in [
        ("userMessage", json!("changed")),
        ("modelId", json!("other")),
        ("startedAt", json!(124)),
        ("effort", json!("high")),
    ] {
        let mut changed = p.clone();
        changed[field] = value;
        assert_eq!(
            call(&r, "chat.send", changed)["error"]["code"],
            "requestConflict"
        );
    }
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let result = call(
            &r,
            "chat.events",
            json!({"sessionId":id,"requestId":"request","afterSequence":0,"limit":256}),
        );
        if result["result"]["turn"]["status"] == "failed" {
            break;
        }
        assert!(std::time::Instant::now() < deadline);
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    let other = create(&r, false)["result"]["sessionId"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(
        call(
            &r,
            "sessions.history",
            json!({"sessionId":other,"after":0,"limit":1})
        )["result"]["turns"],
        json!([])
    );
    drop(r);
    let mut profiles = profiles();
    profiles[0].config_revision = "r2".into();
    let r = DesktopRuntime::open(&f.0, profiles).unwrap();
    assert_eq!(call(&r, "chat.send", p)["error"]["code"], "requestConflict");
}
#[test]
fn blank_journal_record_is_corruption() {
    let f = Fixture::new();
    let r = DesktopRuntime::open(&f.0, profiles()).unwrap();
    create(&r, false);
    drop(r);
    let path = f.0.join("desktop-runtime-v1/journal.jsonl");
    use std::io::Write;
    fs::OpenOptions::new()
        .append(true)
        .open(path)
        .unwrap()
        .write_all(b"\n")
        .unwrap();
    assert!(DesktopRuntime::open(&f.0, profiles()).is_err());
}
#[test]
fn model_ids_are_values_and_session_activity_time_is_persisted() {
    let f = Fixture::new();
    let mut p = profiles();
    p[0].models[0].model_id = "vendor/model.v1:tag".into();
    let r = DesktopRuntime::open(&f.0, p).unwrap();
    let first = create(&r, false)["result"].clone();
    let id = first["sessionId"].as_str().unwrap();
    let updated =
        call(&r, "sessions.update", json!({"sessionId":id,"pinned":true}))["result"].clone();
    assert!(updated["updatedAt"].as_u64().unwrap() > first["updatedAt"].as_u64().unwrap());
    drop(r);
    let r = DesktopRuntime::open(&f.0, profiles()).unwrap();
    assert_eq!(
        call(&r, "sessions.list", json!({}))["result"]["sessions"][0]["updatedAt"],
        updated["updatedAt"]
    );
}
#[test]
fn missing_journal_prevents_start_and_blocks_mutations() {
    let f = Fixture::new();
    let r = DesktopRuntime::open(&f.0, profiles()).unwrap();
    let sid = create(&r, false)["result"]["sessionId"]
        .as_str()
        .unwrap()
        .to_string();
    fs::remove_file(f.0.join("desktop-runtime-v1/journal.jsonl")).unwrap();
    assert_eq!(
        call(&r, "chat.send", send_params(&sid))["error"]["code"],
        "storeIo"
    );
    assert_eq!(
        call(
            &r,
            "sessions.history",
            json!({"sessionId":sid,"after":0,"limit":128})
        )["result"]["turns"],
        json!([])
    );
}
#[test]
fn host_time_survives_clock_rollback_and_duplicate_send() {
    let f = Fixture::new();
    let r = DesktopRuntime::open(&f.0, profiles()).unwrap();
    let sid = create(&r, false)["result"]["sessionId"]
        .as_str()
        .unwrap()
        .to_string();
    drop(r);
    let path = f.0.join("desktop-runtime-v1/journal.jsonl");
    let mut entry: Value = serde_json::from_str(fs::read_to_string(&path).unwrap().trim()).unwrap();
    let future = 8_000_000_000_000_000u64;
    entry["entry"]["session"]["updatedAt"] = json!(future);
    fs::write(&path, format!("{entry}\n")).unwrap();
    let r = DesktopRuntime::open(&f.0, profiles()).unwrap();
    let p = send_params(&sid);
    assert!(call(&r, "chat.send", p.clone()).get("result").is_some());
    let time = call(&r, "sessions.list", json!({}))["result"]["sessions"][0]["updatedAt"].clone();
    assert_eq!(time, json!(future + 1));
    call(&r, "chat.send", p);
    assert_eq!(
        call(&r, "sessions.list", json!({}))["result"]["sessions"][0]["updatedAt"],
        time
    );
    drop(r);
    let r = DesktopRuntime::open(&f.0, profiles()).unwrap();
    assert_eq!(
        call(&r, "sessions.list", json!({}))["result"]["sessions"][0]["updatedAt"],
        time
    );
}
#[test]
fn session_limit_title_id_time_and_unsupported_inputs() {
    let f = Fixture::new();
    let r = DesktopRuntime::open(&f.0, profiles()).unwrap();
    for n in 0..128 {
        assert!(create(&r, false).get("result").is_some(), "{n}");
    }
    assert_eq!(create(&r, false)["error"]["code"], "sessionLimit");
    assert_eq!(
        call(
            &r,
            "sessions.update",
            json!({"sessionId":"session-1","title":"中".repeat(342)})
        )["error"]["code"],
        "invalidParams"
    );
    for (field, value, code) in [
        ("sessionId", json!("../escape"), "invalidId"),
        ("startedAt", json!(9007199254740992u64), "invalidTime"),
        ("effort", json!("high"), "unsupportedEffort"),
        ("tools", json!([]), "invalidParams"),
        ("attachments", json!([]), "invalidParams"),
    ] {
        let mut p = send_params("session-1");
        p[field] = value;
        assert_eq!(call(&r, "chat.send", p)["error"]["code"], code);
    }
}
#[test]
fn prepared_bindings_restore_interrupted_and_request_limit_without_execution() {
    let f = Fixture::new();
    let r = DesktopRuntime::open(&f.0, profiles()).unwrap();
    let session = create(&r, false)["result"].clone();
    drop(r);
    let path = f.0.join("desktop-runtime-v1/journal.jsonl");
    let mut journal = fs::read_to_string(&path).unwrap();
    let start = session["updatedAt"].as_u64().unwrap();
    for n in 0..128 {
        let mut request = send_params("session-1");
        request["requestId"] = json!(format!("prepared-{n}"));
        let record = json!({"version":1,"sequence":n+2,"entry":{"kind":"bind","binding":{"request":request,"configRevision":"r1","acceptedAt":start+n+1,"parentRunId":null}}});
        journal.push_str(&format!("{record}\n"));
    }
    fs::write(&path, journal).unwrap();
    let r = DesktopRuntime::open(&f.0, profiles()).unwrap();
    let history = call(
        &r,
        "sessions.history",
        json!({"sessionId":"session-1","after":0,"limit":128}),
    );
    assert_eq!(history["result"]["turns"].as_array().unwrap().len(), 128);
    assert_eq!(history["result"]["turns"][0]["status"], "interrupted");
    let mut p = send_params("session-1");
    assert_eq!(
        call(&r, "chat.send", p.clone())["error"]["code"],
        "requestLimit"
    );
    p["requestId"] = json!("prepared-0");
    assert_eq!(call(&r, "chat.send", p)["result"]["status"], "interrupted");
    assert_eq!(
        fs::read_dir(f.0.join("desktop-runtime-v1/session-1/runs-v1"))
            .unwrap()
            .count(),
        2
    );
}
#[test]
fn future_journal_and_run_input_mismatch_reject_recovery() {
    for future in [true, false] {
        let f = Fixture::new();
        let r = DesktopRuntime::open(&f.0, profiles()).unwrap();
        create(&r, false);
        call(&r, "chat.send", send_params("session-1"));
        drop(r);
        if future {
            let path = f.0.join("desktop-runtime-v1/journal.jsonl");
            let text = fs::read_to_string(&path)
                .unwrap()
                .replace("\"version\":1", "\"version\":2");
            fs::write(path, text).unwrap();
        } else {
            let path =
                f.0.join("desktop-runtime-v1/session-1/runs-v1/request.jsonl");
            let text = fs::read_to_string(&path)
                .unwrap()
                .replace("hello", "changed");
            fs::write(path, text).unwrap();
        }
        assert!(DesktopRuntime::open(&f.0, profiles()).is_err());
    }
}
#[cfg(unix)]
#[test]
fn symlink_and_hardlink_journals_are_rejected() {
    use std::os::unix::fs::symlink;
    for link in [true, false] {
        let f = Fixture::new();
        let r = DesktopRuntime::open(&f.0, profiles()).unwrap();
        drop(r);
        let path = f.0.join("desktop-runtime-v1/journal.jsonl");
        let other = f.0.join("external");
        fs::rename(&path, &other).unwrap();
        if link {
            symlink(&other, &path).unwrap();
        } else {
            fs::hard_link(&other, &path).unwrap();
        }
        assert!(DesktopRuntime::open(&f.0, profiles()).is_err());
    }
}
#[test]
fn explicit_null_update_is_rejected() {
    let f = Fixture::new();
    let r = DesktopRuntime::open(&f.0, profiles()).unwrap();
    create(&r, false);
    assert_eq!(
        call(
            &r,
            "sessions.update",
            json!({"sessionId":"session-1","pinned":null})
        )["error"]["code"],
        "invalidParams"
    );
}
#[test]
fn active_limit_busy_and_tombstone_keep_writer_lock() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let f = Fixture::new();
    let mut p = profiles();
    p[0].endpoint = format!("http://{}/chat", listener.local_addr().unwrap());
    let r = DesktopRuntime::open(&f.0, p).unwrap();
    for n in 1..=17 {
        create(&r, false);
        let mut request = send_params(&format!("session-{n}"));
        request["requestId"] = json!(format!("request-{n}"));
        let reply = call(&r, "chat.send", request);
        if n <= 16 {
            assert!(reply.get("result").is_some(), "{reply}");
        } else {
            assert_eq!(reply["error"]["code"], "activeLimit");
        }
    }
    let mut request = send_params("session-1");
    request["requestId"] = json!("other");
    assert_eq!(call(&r, "chat.send", request)["error"]["code"], "runBusy");
    call(&r, "sessions.delete", json!({"sessionId":"session-1"}));
    assert!(DesktopRuntime::open(&f.0, profiles()).is_err());
    assert_eq!(
        call(
            &r,
            "sessions.history",
            json!({"sessionId":"session-1","after":0,"limit":1})
        )["error"]["code"],
        "sessionNotFound"
    );
    drop(r);
    drop(listener);
    let r = DesktopRuntime::open(&f.0, profiles()).unwrap();
    assert_eq!(
        call(&r, "sessions.list", json!({}))["result"]["sessions"]
            .as_array()
            .unwrap()
            .len(),
        16
    );
}
#[test]
fn profile_metadata_must_fit_public_frame() {
    let f = Fixture::new();
    let mut p = Vec::new();
    for n in 0..17 {
        let mut profile = profiles().remove(0);
        profile.profile_id = format!("profile-{n}");
        profile.models = (0..128)
            .map(|m| tinker_rust_foundation::desktop_runtime::Model {
                model_id: format!("model-{m}"),
                label: "x".repeat(1024),
                supported_efforts: Vec::new(),
            })
            .collect();
        p.push(profile);
    }
    assert!(DesktopRuntime::open(&f.0, p).is_err());
}
#[test]
fn simultaneous_same_request_executes_one_http_request() {
    use std::{
        io::Write,
        net::TcpListener,
        sync::{Arc, Barrier},
    };
    let f = Fixture::new();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let mut p = profiles();
    p[0].endpoint = format!("http://{}/chat", listener.local_addr().unwrap());
    let r = Arc::new(DesktopRuntime::open(&f.0, p).unwrap());
    create(&r, false);
    let server = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        http_support::read_request(&mut socket);
        let body = "data: {\"choices\":[{\"delta\":{\"content\":\"once\"}}]}\n\ndata: [DONE]\n\n";
        write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
        listener
    });
    let barrier = Arc::new(Barrier::new(3));
    let mut workers = Vec::new();
    for _ in 0..2 {
        let r = r.clone();
        let barrier = barrier.clone();
        workers.push(std::thread::spawn(move || {
            barrier.wait();
            call(&r, "chat.send", send_params("session-1"))
        }));
    }
    barrier.wait();
    for worker in workers {
        assert_eq!(worker.join().unwrap()["result"]["runId"], "request");
    }
    let listener = server.join().unwrap();
    drop(r);
    listener.set_nonblocking(true).unwrap();
    assert!(listener.accept().is_err());
}
