use super::*;
use serde_json::Value;
use std::{net::Shutdown, sync::atomic::AtomicU64};
static NEXT: AtomicU64 = AtomicU64::new(0);
fn root() -> TrustedRoot {
    let path = std::env::temp_dir().canonicalize().unwrap().join(format!(
        "tinker-tauri-channels-preview-qa-task3-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    TrustedRoot::create_channels_temporary(path).unwrap()
}
fn connect(root: &TrustedRoot, method: &str, key: &str, text: &str) -> TcpStream {
    let value: Value =
        serde_json::from_slice(&std::fs::read(root.path().join("qa-endpoint.json")).unwrap())
            .unwrap();
    let mut stream =
        TcpStream::connect(("127.0.0.1", value["port"].as_u64().unwrap() as u16)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .unwrap();
    let body = if method == "POST" {
        serde_json::json!({"messages":[{"role":"user","content":text}]}).to_string()
    } else {
        String::new()
    };
    let path = if method == "POST" {
        "/v1/chat/completions"
    } else {
        "/v1/models"
    };
    write!(stream,"{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {key}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
    stream
}
fn first_delta(s: &mut TcpStream) -> String {
    let mut bytes = Vec::new();
    let mut buffer = [0u8; 4096];
    while !String::from_utf8_lossy(&bytes).contains("Owned QA visible streaming segment") {
        let n = s.read(&mut buffer).unwrap();
        assert!(n > 0, "持有场景必须先返回可见长片段");
        bytes.extend_from_slice(&buffer[..n]);
    }
    let text = String::from_utf8(bytes).unwrap();
    assert!(text.len() > 200);
    text
}
fn observations(root: &TrustedRoot) -> Value {
    serde_json::from_slice(&std::fs::read(root.path().join("qa-observations.json")).unwrap())
        .unwrap()
}
fn idle(root: &TrustedRoot) {
    let deadline = Instant::now() + Duration::from_secs(2);
    while observations(root)["activeHandlers"] != 0 {
        assert!(Instant::now() < deadline, "owned handler没有退出");
        std::thread::sleep(Duration::from_millis(5));
    }
}
#[test]
fn held_delta_concurrent_get_disconnect_and_reopen_are_bounded() {
    let root = root();
    let qa = OwnedQa::start(&root).unwrap();
    let mut a = connect(&root, "POST", QA_SECRET_ONE, "[qa:hold]");
    let _ = first_delta(&mut a);
    a.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
    let mut heartbeat = String::new();
    let mut buffer = [0u8; 256];
    while !heartbeat.contains(": owned qa hold") {
        let n = a
            .read(&mut buffer)
            .expect("持有流必须心跳避免生产15秒idle上限");
        assert!(n > 0);
        heartbeat.push_str(std::str::from_utf8(&buffer[..n]).unwrap());
    }
    let started = Instant::now();
    let mut get = connect(&root, "GET", QA_SECRET_TWO, "");
    let mut bytes = String::new();
    get.read_to_string(&mut bytes).unwrap();
    assert!(bytes.contains("owned-text"));
    assert!(started.elapsed() < Duration::from_secs(1));
    let snapshot = observations(&root);
    assert_eq!(snapshot["getCount"], 1);
    assert_eq!(snapshot["postCount"], 1);
    assert_eq!(snapshot["keyOnePosts"], 1);
    assert_eq!(snapshot["keyTwoGets"], 1);
    let encoded = snapshot.to_string();
    assert!(!encoded.contains(QA_SECRET_ONE));
    assert!(!encoded.contains(QA_SECRET_TWO));
    assert!(!encoded.contains("[qa:hold]"));
    a.shutdown(Shutdown::Both).unwrap();
    drop(a);
    idle(&root);
    let started = Instant::now();
    drop(qa);
    assert!(started.elapsed() < Duration::from_secs(1));
    let before = observations(&root);
    let reopened = OwnedQa::start(&root).unwrap();
    let after = observations(&root);
    assert_eq!(before["getCount"], after["getCount"]);
    assert_eq!(before["postCount"], after["postCount"]);
    drop(reopened);
}
#[test]
fn partial_disconnect_has_long_delta_without_terminal_and_close_interrupts_hold() {
    let root = root();
    let qa = OwnedQa::start(&root).unwrap();
    let mut partial = connect(&root, "POST", QA_SECRET_TWO, "[qa:partial]");
    let mut text = first_delta(&mut partial);
    let mut tail = String::new();
    partial.read_to_string(&mut tail).unwrap();
    text.push_str(&tail);
    assert!(!text.contains("[DONE]"));
    idle(&root);
    assert_eq!(observations(&root)["partialDisconnects"], 1);
    let mut held = connect(&root, "POST", QA_SECRET_ONE, "[qa:hold]");
    let _ = first_delta(&mut held);
    let started = Instant::now();
    drop(qa);
    assert!(started.elapsed() < Duration::from_secs(1));
    idle(&root);
}

#[test]
fn handler_capacity_is_four_and_all_owned_threads_join_on_close() {
    let root = root();
    let qa = OwnedQa::start(&root).unwrap();
    let mut streams = Vec::new();
    for _ in 0..4 {
        let mut stream = connect(&root, "POST", QA_SECRET_ONE, "[qa:hold]");
        let _ = first_delta(&mut stream);
        streams.push(stream);
    }
    let mut rejected = connect(&root, "GET", QA_SECRET_TWO, "");
    let mut bytes = String::new();
    let _ = rejected.read_to_string(&mut bytes);
    assert!(!bytes.contains("200 OK"));
    assert_eq!(observations(&root)["activeHandlers"], 4);
    assert_eq!(observations(&root)["postCount"], 4);
    assert_eq!(observations(&root)["getCount"], 0);
    let started = Instant::now();
    drop(qa);
    assert!(started.elapsed() < Duration::from_secs(1));
    idle(&root);
    drop(streams);
}

#[test]
fn unauthorized_http_is_still_counted_without_recording_the_key() {
    let root = root();
    let qa = OwnedQa::start(&root).unwrap();
    let mut request = connect(&root, "GET", "invalid-owned-qa-key", "");
    let mut response = String::new();
    request.read_to_string(&mut response).unwrap();
    assert!(response.contains("401 Unauthorized"));
    idle(&root);
    let metadata = observations(&root);
    assert_eq!(metadata["getCount"], 1);
    assert_eq!(metadata["unauthorizedRequests"], 1);
    assert_eq!(metadata["keyOneGets"], 0);
    assert_eq!(metadata["keyTwoGets"], 0);
    assert!(!metadata.to_string().contains("invalid-owned-qa-key"));
    drop(qa);
}

#[test]
fn route_window_has_two_separate_sockets_and_keeps_both_on_restart() {
    let root = root();
    let ports = || {
        ["qa-endpoint.json", "qa-secondary-endpoint.json"].map(|file| {
            let bytes = std::fs::read(root.path().join(file)).unwrap();
            serde_json::from_slice::<Value>(&bytes).unwrap()["port"]
                .as_u64()
                .unwrap()
        })
    };
    let qa = OwnedQa::start(&root).unwrap();
    let first = ports();
    assert_ne!(first[0], first[1]);
    for port in first {
        let base = format!("http://127.0.0.1:{port}/v1");
        assert_eq!(qa.policy().normalize(&base).unwrap(), base);
        assert!(qa.policy().normalize(&format!("{base}/other")).is_err());
    }
    drop(qa);
    let reopened = OwnedQa::start(&root).unwrap();
    assert_eq!(ports(), first);
    drop(reopened);
    std::fs::remove_dir_all(root.path()).unwrap();
}

#[test]
fn upgrade_probe_requires_the_four_turns_from_the_selected_project() {
    let user = |text: &str| serde_json::json!({"role":"user","content":text});
    let assistant = |text: &str| serde_json::json!({"role":"assistant","content":text});
    let mut turns = vec![
        user("A green northern ridge."),
        assistant("The ridge is green."),
        user("The alpine larch colour is amber."),
        assistant("Recorded the amber observation."),
        user("[qa:upgrade-context]"),
    ];
    let matches =
        |turns: &[Value]| super::has_upgrade_history(&serde_json::json!({"messages": turns}));
    assert!(matches(&turns));
    assert!(!matches(&turns[4..]));
    turns.insert(2, user("Coastal cypress shades the bay."));
    assert!(!matches(&turns));
}

#[test]
fn document_mock_rejects_extra_context_and_replay() {
    let excerpt = serde_json::json!({"type":"untrusted_document_excerpt","filename":"Orchard.md","startLine":2,"endLine":2,"text":"QA_SELECTED_CEDAR_42"});
    let question = format!("[qa:document-selection]\nQuoted reference:\n{excerpt}");
    let mut request = serde_json::json!({"messages":[{"role":"user","content":question}]});
    assert_eq!(
        document_probe(&request, &question),
        Ok(Some("Selected project lines verified. "))
    );
    request["system"] = "QA_OTHER_PROJECT_65".into();
    assert!(document_probe(&request, &question).is_err());
    let followup = "[qa:document-followup]";
    let mut next = serde_json::json!({"messages":[{"role":"user","content":"[qa:document-selection]"},{"role":"assistant","content":"Selected project lines verified."},{"role":"user","content":followup}]});
    assert_eq!(
        document_probe(&next, followup),
        Ok(Some("No document excerpt replayed. "))
    );
    next["messages"][0]["content"] = question.clone().into();
    assert!(document_probe(&next, followup).is_err());
    let invalid = serde_json::json!({"messages":[{"role":"system","content":question}]});
    assert!(document_probe(&invalid, &question).is_err());
}
