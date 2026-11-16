use serde_json::{json, Value};
use std::{
    io::Write,
    net::TcpListener,
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};
use tinker_rust_foundation::desktop_runtime::DesktopRuntime;
#[path = "support/http.rs"]
mod http;
#[path = "support/protocol_http.rs"]
mod protocol_http;
#[path = "support/desktop.rs"]
mod support;
use support::*;
fn state(r: &DesktopRuntime, sid: &str) -> Value {
    let mut state = call(
        r,
        "chat.queueState",
        json!({"sessionId":sid,"chainId":"request"}),
    )["result"]
        .clone();
    if let Some(rid) = state["activeExecution"]["requestId"].as_str() {
        let events = call(
            r,
            "chat.eventsV2",
            json!({"sessionId":sid,"requestId":rid,"afterSequence":0,"limit":1}),
        );
        assert!(events["error"].is_null(), "{events}");
        state["activeTurn"] = events["result"]["turn"].clone();
    }
    state
}

fn wait(r: &DesktopRuntime, sid: &str, status: &str) -> Value {
    let end = Instant::now() + Duration::from_secs(5);
    loop {
        let s = state(r, sid);
        if s["activeTurn"]["status"] == status {
            return s;
        }
        assert!(Instant::now() < end, "{s}");
        thread::sleep(Duration::from_millis(5));
    }
}
fn advance(r: &DesktopRuntime, sid: &str) -> Value {
    let s = state(r, sid);
    call(
        r,
        "chat.advanceQueue",
        json!({"sessionId":sid,"chainId":"request","expectedActiveRequestId":s["activeTurn"]["requestId"],"expectedQueueRevision":s["revision"]}),
    )
}
fn queue(r: &DesktopRuntime, sid: &str, u: &str, interrupt: bool) -> Value {
    call(
        r,
        "chat.queue",
        json!({"sessionId":sid,"chainId":"request","uuid":u,"userMessage":u.to_uppercase(),"interrupt":interrupt}),
    )
}
fn exercise(interrupt: bool, empty: bool, repeated: bool, anthropic: bool) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let (tx, rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let server = thread::spawn(move || {
        let mut bodies = vec![];
        for n in 0..if repeated {
            5
        } else if interrupt {
            4
        } else {
            3
        } {
            let (mut s, _) = listener.accept().unwrap();
            let bytes = http::read_request(&mut s);
            let end = bytes.windows(4).position(|v| v == b"\r\n\r\n").unwrap() + 4;
            bodies.push(serde_json::from_slice::<Value>(&bytes[end..]).unwrap());
            if n == 0 {
                let body = if anthropic {
                    let mut b = protocol_http::start() + &protocol_http::block(0);
                    if !empty {
                        b += &protocol_http::delta(0, "partial-A");
                    }
                    b
                } else if empty {
                    String::new()
                } else {
                    "data: {\"choices\":[{\"delta\":{\"content\":\"partial-A\"}}]}\n\n".into()
                };
                write!(s,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n{body}").unwrap();
                s.flush().unwrap();
                tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                let _ = write!(s, "data: [DONE]\n\n");
            } else {
                let body = if anthropic {
                    protocol_http::anthropic("answer")
                } else {
                    "data: {\"choices\":[{\"delta\":{\"content\":\"answer\"}}]}\n\ndata: [DONE]\n\n"
                        .into()
                };
                write!(s,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
            }
        }
        bodies
    });
    let f = Fixture::new();
    let mut ps = profiles();
    ps[0].endpoint = format!("http://{addr}/v1/chat/completions");
    if anthropic {
        ps[0].protocol = serde_json::from_value(json!("anthropic-messages")).unwrap();
    }
    let r = DesktopRuntime::open_with_queueing(&f.0, ps, vec![]).unwrap();
    let sid = create(&r, false)["result"]["sessionId"]
        .as_str()
        .unwrap()
        .to_owned();
    let b = call(&r, "chat.beginChain", send_params(&sid));
    assert!(b["error"].is_null(), "{b}");
    rx.recv_timeout(Duration::from_secs(5)).unwrap();
    if !empty {
        let end = Instant::now() + Duration::from_secs(5);
        while state(&r, &sid)["activeTurn"]["assistantMessage"] != "partial-A" {
            assert!(Instant::now() < end);
            thread::sleep(Duration::from_millis(5));
        }
    }
    for u in ["b", "c"] {
        let q = queue(&r, &sid, u, false);
        assert!(q["error"].is_null(), "{q}");
        assert_eq!(queue(&r, &sid, u, false), q);
    }
    if interrupt {
        let q = queue(&r, &sid, "d", true);
        assert!(q["error"].is_null(), "{q}");
        assert_eq!(queue(&r, &sid, "d", true), q);
    }
    if repeated {
        assert!(queue(&r, &sid, "e", true)["error"].is_null());
    }
    release_tx.send(()).unwrap();
    wait(&r, &sid, if interrupt { "cancelled" } else { "completed" });
    for _ in 0..if repeated {
        4
    } else if interrupt {
        3
    } else {
        2
    } {
        let a = advance(&r, &sid);
        assert!(a["error"].is_null(), "{a}");
        wait(&r, &sid, "completed");
    }
    let closed = advance(&r, &sid);
    assert_eq!(closed["result"]["closureReason"], "completed");
    assert_eq!(
        closed["result"]["badgeClearBoundary"],
        if repeated { 4 } else { 3 }
    );
    let bodies = server.join().unwrap();
    let inputs: Vec<_> = bodies
        .iter()
        .map(|v| {
            v["messages"].as_array().unwrap().last().unwrap()["content"]
                .as_str()
                .unwrap()
        })
        .collect();
    assert_eq!(
        inputs,
        if repeated {
            vec!["hello", "E", "D", "B", "C"]
        } else if interrupt {
            vec!["hello", "D", "B", "C"]
        } else {
            vec!["hello", "B", "C"]
        }
    );
    assert_eq!(bodies[1]["messages"][0]["content"], "hello");
    if !empty {
        assert_eq!(bodies[1]["messages"][1]["content"], "partial-A");
    }
    drop(r);
    if interrupt {
        assert!(matches!(
            tinker_rust_foundation::run_controller::RunController::open(
                f.0.join("desktop-runtime-v1").join(&sid)
            ),
            Err(tinker_rust_foundation::run_types::RunError::UnsupportedVersion)
        ));
    }
    let r = DesktopRuntime::open_with_queueing(&f.0, profiles(), vec![]).unwrap();
    assert_eq!(state(&r, &sid)["closureReason"], "completed");
    drop(r);
    if interrupt {
        let journal = f.0.join("desktop-runtime-v1/journal.jsonl");
        let text = std::fs::read_to_string(&journal).unwrap();
        let changed = text
            .lines()
            .map(|l| {
                let mut v: Value = serde_json::from_str(l).unwrap();
                let t = &mut v["entry"]["transition"];
                if t["operation"] == "bind" && !t["redirectSequence"].is_null() {
                    t["redirectSequence"] = json!(999);
                }
                format!("{v}\n")
            })
            .collect::<String>();
        std::fs::write(&journal, &changed).unwrap();
        assert!(DesktopRuntime::open_with_queueing(&f.0, profiles(), vec![]).is_err());
        assert_eq!(std::fs::read_to_string(journal).unwrap(), changed);
    }
}
#[test]
fn fifo_dispatch_runs_once() {
    exercise(false, false, false, false)
}
#[test]
fn redirect_preserves_partial_and_fifo_descendants() {
    exercise(true, false, false, false)
}
#[test]
fn redirect_before_delta_preserves_input() {
    exercise(true, true, false, false)
}

#[test]
fn redirect_closes_pending_permission_without_replaying_parent_tool() {
    use std::sync::Arc;
    use tinker_rust_foundation::{
        desktop_runtime::TrustedToolBinding,
        formal_mock::OwnedMock,
        formal_platform::TrustedRoot,
        synthetic_workspace::SyntheticWorkspace,
        tool_types::{ToolExecutor, ToolRunOptions},
    };
    let path = std::env::temp_dir().canonicalize().unwrap().join(format!(
        "tinker-tauri-tools-preview-queue-{}",
        std::process::id()
    ));
    let root = TrustedRoot::create_tools_temporary(&path).unwrap();
    let mut mock = OwnedMock::start_tools().unwrap();
    let executor = Arc::new(SyntheticWorkspace::create(&root).unwrap());
    let binding = TrustedToolBinding {
        profile_id: "local-tools-mock".into(),
        options: ToolRunOptions::new(
            executor.workspace_revision().into(),
            Duration::from_secs(60),
            Duration::from_secs(120),
        )
        .unwrap(),
        executor: executor.clone(),
    };
    let r =
        DesktopRuntime::open_with_queueing(root.path(), mock.profiles().unwrap(), vec![binding])
            .unwrap();
    let sid=call(&r,"sessions.create",json!({"title":"queue","profileId":"local-tools-mock","workspaceId":null,"reuseDraft":false}))["result"]["sessionId"].as_str().unwrap().to_owned();
    let mut p = send_params(&sid);
    p["profileId"] = json!("local-tools-mock");
    p["modelId"] = json!("local-tools-mock");
    assert!(call(&r, "chat.beginChain", p)["error"].is_null());
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let pending = call(&r, "chat.pendingPermissions", json!({"sessionId":sid}));
        if !pending["result"]["permissions"]
            .as_array()
            .unwrap()
            .is_empty()
        {
            break;
        }
        assert!(Instant::now() < deadline, "{pending}");
        thread::sleep(Duration::from_millis(5));
    }
    assert!(queue(&r, &sid, "d", true)["error"].is_null());
    let pending = call(&r, "chat.pendingPermissions", json!({"sessionId":sid}));
    assert!(pending["result"]["permissions"]
        .as_array()
        .unwrap()
        .is_empty());
    let a = advance(&r, &sid);
    assert!(a["error"].is_null(), "{a}");
    loop {
        let p = call(
            &r,
            "chat.eventsV2",
            json!({"sessionId":sid,"requestId":"d","afterSequence":0,"limit":256}),
        );
        let t = &p["result"]["turn"];
        if t["status"] == "completed" {
            break;
        }
        if let Some(pid) = t["toolState"]["pending"]["permissionId"].as_str() {
            assert!(call(&r,"chat.permissionRespond",json!({"sessionId":sid,"runId":"d","permissionId":pid,"behavior":"allow","alwaysAllow":false}))["error"].is_null());
        }
        assert!(Instant::now() < deadline, "{p}");
        thread::sleep(Duration::from_millis(5));
    }
    assert_eq!(mock.records()[1].user_messages, 2);
    assert_eq!(mock.records().len(), 4);
    drop(r);
    let binding = TrustedToolBinding {
        profile_id: "local-tools-mock".into(),
        options: ToolRunOptions::new(
            executor.workspace_revision().into(),
            Duration::from_secs(60),
            Duration::from_secs(120),
        )
        .unwrap(),
        executor,
    };
    let r =
        DesktopRuntime::open_with_queueing(root.path(), mock.profiles().unwrap(), vec![binding])
            .unwrap();
    assert_eq!(state(&r, &sid)["closureReason"], "recovered");
    assert_eq!(mock.records().len(), 4);
    drop(r);
    mock.shutdown();
    std::fs::remove_dir_all(path).unwrap();
}

#[test]
fn repeated_interrupts_choose_execution_parent() {
    exercise(true, false, true, false)
}
#[test]
fn anthropic_redirect_preserves_partial() {
    exercise(true, false, false, true)
}
#[test]
fn anthropic_redirect_before_delta() {
    exercise(true, true, false, true)
}

#[test]
fn later_failure_preserves_success_and_abandons_unexecuted_text() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let observer = listener.try_clone().unwrap();
    let (release_tx, release_rx) = mpsc::channel();
    let (seen_tx, seen_rx) = mpsc::channel();
    let server = thread::spawn(move || {
        for n in 0..2 {
            let (mut socket, _) = listener.accept().unwrap();
            http::read_request(&mut socket);
            if n == 0 {
                seen_tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            }
            let body = if n == 0 {
                "data: {\"choices\":[{\"delta\":{\"content\":\"A-success\"}}]}\n\ndata: [DONE]\n\n"
            } else {
                "data: {\"choices\":[{\"delta\":{\"content\":\"B-partial\"}}]}\n\n"
            };
            write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n{body}").unwrap();
        }
    });
    let f = Fixture::new();
    let mut ps = profiles();
    ps[0].endpoint = format!("http://{address}/chat");
    let r = DesktopRuntime::open_with_queueing(&f.0, ps, vec![]).unwrap();
    let sid = create(&r, false)["result"]["sessionId"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(call(&r, "chat.beginChain", send_params(&sid))["error"].is_null());
    seen_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    assert!(queue(&r, &sid, "b", false)["error"].is_null());
    assert!(queue(&r, &sid, "c", false)["error"].is_null());
    release_tx.send(()).unwrap();
    wait(&r, &sid, "completed");
    assert!(advance(&r, &sid)["error"].is_null());
    wait(&r, &sid, "failed");
    let closed = advance(&r, &sid);
    assert_eq!(closed["result"]["closureReason"], "failure");
    assert_eq!(closed["result"]["messages"][1]["disposition"], "abandoned");
    let history = call(
        &r,
        "sessions.history",
        json!({"sessionId":sid,"after":0,"limit":128}),
    );
    assert_eq!(
        history["result"]["turns"][0]["assistantMessage"],
        "A-success"
    );
    assert_eq!(
        history["result"]["turns"][1]["assistantMessage"],
        "B-partial"
    );
    drop(r);
    server.join().unwrap();
    let r = DesktopRuntime::open_with_queueing(&f.0, profiles(), vec![]).unwrap();
    assert_eq!(state(&r, &sid)["closureReason"], "failure");
    observer.set_nonblocking(true).unwrap();
    assert!(matches!(observer.accept(),Err(e)if e.kind()==std::io::ErrorKind::WouldBlock));
}
#[test]
fn crash_after_atomic_bind_before_start_never_replays() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let observer = listener.try_clone().unwrap();
    let server = thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        http::read_request(&mut socket);
        let body =
            "data: {\"choices\":[{\"delta\":{\"content\":\"complete\"}}]}\n\ndata: [DONE]\n\n";
        write!(
            socket,
            "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n{body}"
        )
        .unwrap();
    });
    let f = Fixture::new();
    let mut ps = profiles();
    ps[0].endpoint = format!("http://{address}/chat");
    let r = DesktopRuntime::open_with_queueing(&f.0, ps, vec![]).unwrap();
    let sid = create(&r, false)["result"]["sessionId"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(call(&r, "chat.beginChain", send_params(&sid))["error"].is_null());
    let receipt = queue(&r, &sid, "b", false);
    assert!(receipt["error"].is_null());
    wait(&r, &sid, "completed");
    drop(r);
    server.join().unwrap();
    let path = f.0.join("desktop-runtime-v1/journal.jsonl");
    let text = std::fs::read_to_string(&path).unwrap();
    let seq = text.lines().count() + 1;
    let event = json!({"version":2,"sequence":seq,"entry":{"kind":"queue","transition":{"operation":"bind","sessionId":sid,"chainId":"request","uuid":"b","revision":3,"acceptedAt":receipt["result"]["acceptedAt"].as_u64().unwrap()+1,"parent":"request","redirectSequence":null}}});
    std::fs::OpenOptions::new()
        .append(true)
        .open(&path)
        .unwrap()
        .write_all(format!("{event}\n").as_bytes())
        .unwrap();
    let r = DesktopRuntime::open_with_queueing(&f.0, profiles(), vec![]).unwrap();
    let snapshot = state(&r, &sid);
    assert_eq!(snapshot["closureReason"], "recovered");
    assert_eq!(snapshot["activeExecution"]["requestId"], "b");
    assert_eq!(snapshot["activeExecution"]["status"], "interrupted");
    assert_eq!(queue(&r, &sid, "b", false), receipt);
    observer.set_nonblocking(true).unwrap();
    assert!(matches!(observer.accept(),Err(e)if e.kind()==std::io::ErrorKind::WouldBlock));
}

#[test]
fn interrupt_after_generic_cancel_cannot_retroactively_authorize_context() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let observer = listener.try_clone().unwrap();
    let (ready_tx, ready_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let server = thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        http::read_request(&mut socket);
        write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: {{\"choices\":[{{\"delta\":{{\"content\":\"partial\"}}}}]}}\n\n").unwrap();
        socket.flush().unwrap();
        ready_tx.send(()).unwrap();
        release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    });
    let f = Fixture::new();
    let mut ps = profiles();
    ps[0].endpoint = format!("http://{address}/chat");
    let r = DesktopRuntime::open_with_queueing(&f.0, ps, vec![]).unwrap();
    let sid = create(&r, false)["result"]["sessionId"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(call(&r, "chat.beginChain", send_params(&sid))["error"].is_null());
    ready_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    assert!(call(
        &r,
        "chat.cancel",
        json!({"sessionId":sid,"requestId":"request"})
    )["error"]
        .is_null());
    assert_eq!(state(&r, &sid)["activeExecution"]["status"], "cancelled");
    release_tx.send(()).unwrap();
    server.join().unwrap();
    assert!(queue(&r, &sid, "d", true)["error"].is_null());
    let advanced = advance(&r, &sid);
    assert_eq!(advanced["result"]["closureReason"], "failure", "{advanced}");
    assert_eq!(
        advanced["result"]["messages"][0]["disposition"],
        "abandoned"
    );
    observer.set_nonblocking(true).unwrap();
    assert!(matches!(observer.accept(),Err(e)if e.kind()==std::io::ErrorKind::WouldBlock));
}
