//! 捕获本机模拟渠道的真实 HTTP 正文，区分本轮显式授权、普通续聊和恢复。
use super::*;
use crate::desktop_runtime::import_tests::{call, profiles};
use sha2::{Digest, Sha256};
use std::{
    io::Write,
    net::TcpListener,
    time::{Duration, Instant},
};

#[path = "../../tests/support/http.rs"]
mod http;

fn request(sid: &str, rid: &str) -> Send {
    Send {
        request_id: rid.into(),
        session_id: sid.into(),
        profile_id: "synthetic-local".into(),
        model_id: "synthetic-model".into(),
        user_message: "What does the selected passage say?".into(),
        started_at: 300,
        effort: None,
    }
}

fn wait_status(rt: &DesktopRuntime, sid: &str, rid: &str, status: &str) {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let page = call(
            rt,
            "chat.events",
            json!({"sessionId":sid,"requestId":rid,"afterSequence":0,"limit":64}),
        );
        match page["turn"]["status"].as_str() {
            Some(current) if current == status => return,
            Some("queued" | "running") if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(5))
            }
            _ => panic!("unexpected task state: {}", page["turn"]),
        }
    }
}

fn temporary_root() -> TrustedRoot {
    TrustedRoot::create_temporary(std::env::temp_dir().canonicalize().unwrap().join(format!(
        "tinker-tauri-formal-preview-docsend-{}",
        crate::credentialed_channels::catalog::random_reference().unwrap()
    )))
    .unwrap()
}

#[test]
fn only_the_explicit_send_receives_the_excerpt_and_reopening_restores_a_locator() {
    verify_scoped_send(
        "中文 notes.md",
        b"NEVER-SEND-A\nSELECTED-ONLY\nNEVER-SEND-C",
        None,
    );
}

#[cfg(target_os = "macos")]
fn selected_pdf() -> Vec<u8> {
    formal_documents::pdf_fixture(&[
        &["NEVER-SEND-PAGE-ONE-TOP", "NEVER-SEND-SAME-LINE"],
        &[
            "NEVER-SEND-PAGE-TWO-TOP",
            "SELECTED-ONLY",
            "NEVER-SEND-BOTTOM",
        ],
    ])
}

#[cfg(target_os = "macos")]
#[test]
fn pdf_wire_contains_only_the_selected_page_lines_and_followup_omits_the_excerpt() {
    verify_scoped_send("synthetic notes.pdf", &selected_pdf(), Some(2));
}

fn verify_scoped_send(filename: &str, bytes: &[u8], page: Option<usize>) {
    let root = temporary_root();
    let doc = formal_documents::import_selected(&root, "project-a", filename, bytes).unwrap();
    let selection = DocumentSelection {
        document_id: doc.document_id.clone(),
        page,
        start_line: 2,
        end_line: 2,
    };
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/chat", listener.local_addr().unwrap());
    listener.set_nonblocking(true).unwrap();
    let capture = listener.try_clone().unwrap();
    let server = std::thread::spawn(move || {
        let mut payloads = Vec::new();
        let deadline = Instant::now() + Duration::from_secs(10);
        while payloads.len() < 2 {
            match capture.accept() {
                Ok((mut socket, _)) => {
                    socket.set_nonblocking(false).unwrap();
                    let raw = http::read_request(&mut socket);
                    let end = raw.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
                    payloads.push(serde_json::from_slice::<Value>(&raw[end + 4..]).unwrap());
                    let body = "data: {\"choices\":[{\"delta\":{\"content\":\"synthetic answer\"}}]}\n\ndata: [DONE]\n\n";
                    write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
                }
                Err(e)
                    if e.kind() == std::io::ErrorKind::WouldBlock && Instant::now() < deadline =>
                {
                    std::thread::sleep(Duration::from_millis(3))
                }
                Err(e) => panic!("mock accept: {e}"),
            }
        }
        payloads
    });

    let open = || DesktopRuntime::open(root.path(), profiles(&endpoint)).unwrap();
    let rt = open();
    let create = |w| {
        call(&rt, "sessions.create", json!({"title":"Document fixture","profileId":"synthetic-local","workspaceId":w,"reuseDraft":false}))["sessionId"].as_str().unwrap().to_owned()
    };
    let sid = create("project-a");
    let other = create("project-b");
    assert_eq!(
        rt.send_document(
            &root,
            "project-a",
            request(&other, "wrong-project"),
            &selection
        )
        .unwrap_err()
        .0,
        "workspaceMismatch"
    );
    assert_eq!(
        rt.send_document(
            &root,
            "project-b",
            request(&other, "foreign-document"),
            &selection
        )
        .unwrap_err()
        .0,
        "documentNotFound"
    );
    let first = request(&sid, "document-turn");
    let send = |sel| rt.send_document(&root, "project-a", first.clone(), sel);
    send(&selection).unwrap();
    wait_status(&rt, &sid, &first.request_id, "completed");
    send(&selection).unwrap();
    let other_lines = DocumentSelection {
        start_line: 1,
        ..selection.clone()
    };
    assert_eq!(send(&other_lines).unwrap_err().0, "requestConflict");
    if page.is_some() {
        let other_page = DocumentSelection {
            page: Some(1),
            ..selection.clone()
        };
        assert_eq!(send(&other_page).unwrap_err().0, "requestConflict");
    }
    let plain_replay = rt
        .dispatch(json!({"version":1,"id":"wire","method":"chat.send","params":first}))
        .unwrap();
    assert_eq!(plain_replay.error.unwrap().code, "requestConflict");
    drop(rt);

    let rt = open();
    let history = call(
        &rt,
        "sessions.historyV2",
        json!({"sessionId":sid,"after":0,"limit":32}),
    );
    let view = crate::formal_agent::projection::history(history["turns"].as_array().unwrap());
    let mut source =
        json!({"documentId":doc.document_id,"filename":filename,"startLine":2,"endLine":2});
    if let Some(page) = page {
        source["page"] = json!(page);
    }
    assert_eq!(view["sdkMessages"][0]["_desktopDocumentSource"], source);
    assert_eq!(view["messages"][0]["_desktopDocumentSource"], source);
    assert!(!view.to_string().contains("SELECTED-ONLY"));
    let restored: DocumentSource =
        serde_json::from_value(view["sdkMessages"][0]["_desktopDocumentSource"].clone()).unwrap();
    assert_eq!(restored.selection(), selection);
    assert_eq!(
        formal_documents::read(&root, "project-a", &restored.selection())
            .unwrap()
            .text,
        "SELECTED-ONLY"
    );
    if page.is_none() {
        verify_damaged_snapshot_receipt(&rt, &root, &first, &selection, &other_lines);
    }
    let next = Send {
        user_message: "follow up without a reference".into(),
        ..request(&sid, "ordinary-turn")
    };
    call(&rt, "chat.send", json!(next));
    wait_status(&rt, &sid, &next.request_id, "completed");
    let body = server.join().unwrap();
    let messages = body[0]["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0]["role"], "user");
    let text = messages[0]["content"].as_str().unwrap();
    let data: Value = serde_json::from_str(text.lines().last().unwrap()).unwrap();
    let mut expected = json!({"type":"untrusted_document_excerpt","filename":filename,"startLine":2,"endLine":2,"text":"SELECTED-ONLY"});
    if let Some(page) = page {
        expected["page"] = json!(page);
    }
    assert_eq!(data, expected);
    let wire = body[0].to_string();
    for marker in ["NEVER-SEND", "%PDF-", "JVBERi0", "application/pdf"] {
        assert!(
            !wire.contains(marker),
            "Unexpected material on wire: {marker}"
        );
    }
    assert_eq!(
        body[1]["messages"],
        json!([
            {"role":"user","content":first.user_message},
            {"role":"assistant","content":"synthetic answer"},
            {"role":"user","content":next.user_message}
        ])
    );
    assert_eq!(
        listener.accept().unwrap_err().kind(),
        std::io::ErrorKind::WouldBlock
    );
    drop(rt);
    std::fs::remove_dir_all(root.path()).unwrap();
}

fn verify_damaged_snapshot_receipt(
    rt: &DesktopRuntime,
    root: &TrustedRoot,
    first: &Send,
    selection: &DocumentSelection,
    other_lines: &DocumentSelection,
) {
    // 模拟原文快照损坏，已接受身份只能读取回执；新授权仍须解析成功。
    let snapshot = root
        .path()
        .join(format!(
            "project-documents-v1-{:x}",
            Sha256::digest("project-a")
        ))
        .join("document-00.json");
    assert!(snapshot.is_file());
    std::fs::write(&snapshot, b"synthetic damaged snapshot").unwrap();
    let receipt = rt
        .send_document(root, "project-a", first.clone(), selection)
        .unwrap();
    assert_eq!(receipt["status"], "completed");
    assert_eq!(
        rt.send_document(root, "project-a", first.clone(), other_lines)
            .unwrap_err()
            .0,
        "requestConflict"
    );
    assert_eq!(
        rt.send_document(
            root,
            "project-a",
            request(&first.session_id, "new-reference"),
            selection
        )
        .unwrap_err()
        .0,
        "corruptSnapshot"
    );
    std::fs::remove_file(snapshot).unwrap();
    assert_eq!(
        rt.send_document(root, "project-a", first.clone(), selection)
            .unwrap()["requestId"],
        first.request_id
    );
}

#[test]
fn explicit_text_retry_reuses_the_original_excerpt_after_restart() {
    verify_retry("notes.txt", b"first\nsecond", None);
}

#[cfg(target_os = "macos")]
#[test]
fn explicit_retry_restores_the_original_pdf_page_and_deduplicates_the_request() {
    verify_retry("notes.pdf", &selected_pdf(), Some(2));
}

fn verify_retry(filename: &str, bytes: &[u8], page: Option<usize>) {
    let mock = crate::formal_mock::OwnedMock::start().unwrap();
    let root = temporary_root();
    let open = || DesktopRuntime::open(root.path(), mock.profiles().unwrap()).unwrap();
    let rt = open();
    let sid = call(&rt, "sessions.create", json!({"title":"Retry","profileId":"local-mock","workspaceId":"project-a","reuseDraft":false}))["sessionId"].as_str().unwrap().to_owned();
    let doc = formal_documents::import_selected(&root, "project-a", filename, bytes).unwrap();
    let selection = DocumentSelection {
        document_id: doc.document_id,
        page,
        start_line: 2,
        end_line: 2,
    };
    let first = Send {
        profile_id: "local-mock".into(),
        model_id: "local-mock-a".into(),
        user_message: "[task-retry] synthetic".into(),
        ..request(&sid, "initial")
    };
    rt.send_document(&root, "project-a", first, &selection)
        .unwrap();
    wait_status(&rt, &sid, "initial", "failed");
    drop(rt);
    let rt = open();
    assert_eq!(mock.records().len(), 1);
    let retry = || super::super::TextRetry {
        session_id: sid.clone(),
        request_id: "explicit".into(),
        started_at: 301,
        retry_of_request_id: "initial".into(),
    };
    let resolved = rt.resolve_text_retry(retry()).unwrap();
    assert!(resolved.is_new);
    assert_eq!(resolved.document.as_ref(), Some(&selection));
    rt.send_document(
        &root,
        "project-a",
        resolved.send,
        &resolved.document.unwrap(),
    )
    .unwrap();
    wait_status(&rt, &sid, "explicit", "completed");
    let replay = rt.resolve_text_retry(retry()).unwrap();
    assert!(!replay.is_new);
    rt.send_document(&root, "project-a", replay.send, &replay.document.unwrap())
        .unwrap();
    assert_eq!(mock.records().len(), 2);
    drop(rt);
    std::fs::remove_dir_all(root.path()).unwrap();
}
