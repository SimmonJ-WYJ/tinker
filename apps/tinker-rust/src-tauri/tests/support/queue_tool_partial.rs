use super::*;
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc,
};
use tinker_rust_foundation::{
    desktop_runtime::TrustedToolBinding, formal_platform::TrustedRoot, run_types::RunError,
    synthetic_workspace::SyntheticWorkspace, tool_types::*,
};

struct Count {
    inner: SyntheticWorkspace,
    calls: AtomicUsize,
}
impl ToolExecutor for Count {
    fn workspace_revision(&self) -> &str {
        self.inner.workspace_revision()
    }
    fn catalog(&self) -> Vec<ToolSpec> {
        self.inner.catalog()
    }
    fn execute(&self, call: &ToolCall, cancelled: &AtomicBool) -> Result<ToolResult, RunError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.inner.execute(call, cancelled)
    }
}

fn unfinished_round(empty: bool) {
    let partial = if empty { "" } else { "partial-A café 你好" };
    let answer = if empty { "" } else { "D-answer" };
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/chat", listener.local_addr().unwrap());
    let observer = listener.try_clone().unwrap();
    let (ready_tx, ready_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let server = thread::spawn(move || {
        let mut bodies = Vec::new();
        for n in 0..4 {
            let (mut socket, _) = listener.accept().unwrap();
            let bytes = http::read_request(&mut socket);
            let offset = bytes.windows(4).position(|v| v == b"\r\n\r\n").unwrap() + 4;
            bodies.push(serde_json::from_slice::<Value>(&bytes[offset..]).unwrap());
            let delta = match n {
                0 => {
                    json!({"content":"prior-round","tool_calls":[{"index":0,"id":"a-call","type":"function","function":{"name":"workspace_list","arguments":"{\"path\":\"notes\"}"}}]})
                }
                1 => json!({"content":partial}),
                2 => json!({"content":answer}),
                _ => json!({"content":"B-answer"}),
            };
            let frame = json!({"choices":[{"index":0,"delta":delta,"finish_reason":match n {0 => Some("tool_calls"), 1 => None, _ => Some("stop")}}]});
            let mut body = format!("data: {frame}\n\n");
            if n != 1 {
                body.push_str("data: [DONE]\n\n");
            }
            write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n{body}").unwrap();
            socket.flush().unwrap();
            if n == 1 {
                ready_tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(10)).unwrap();
            }
        }
        bodies
    });
    let path = std::env::temp_dir().canonicalize().unwrap().join(format!(
        "tinker-tauri-tools-preview-partial-{}-{empty}",
        std::process::id()
    ));
    let root = TrustedRoot::create_tools_temporary(&path).unwrap();
    let executor = Arc::new(Count {
        inner: SyntheticWorkspace::create(&root).unwrap(),
        calls: AtomicUsize::new(0),
    });
    let bindings = || {
        vec![TrustedToolBinding {
            profile_id: "local".into(),
            options: ToolRunOptions::new(
                executor.workspace_revision().into(),
                Duration::from_secs(60),
                Duration::from_secs(120),
            )
            .unwrap(),
            executor: executor.clone(),
        }]
    };
    let ps = || {
        let mut profiles = profiles();
        profiles[0].endpoint = endpoint.clone();
        profiles
    };
    let runtime = DesktopRuntime::open_with_queueing(root.path(), ps(), bindings()).unwrap();
    let sid = create(&runtime, false)["result"]["sessionId"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(call(&runtime, "chat.beginChain", send_params(&sid))["error"].is_null());
    wait(&runtime, &sid, "waitingInput");
    let permission = call(
        &runtime,
        "chat.pendingPermissions",
        json!({"sessionId":sid}),
    )["result"]["permissions"][0]["permissionId"]
        .clone();
    let granted = call(
        &runtime,
        "chat.permissionRespond",
        json!({"sessionId":sid,"runId":"request","permissionId":permission,"behavior":"allow","alwaysAllow":false}),
    );
    assert!(granted["error"].is_null(), "{granted}");
    ready_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let snapshot = state(&runtime, &sid);
        let tool = &snapshot["activeTurn"]["toolState"];
        if tool["currentRound"] == 1 && tool["partialText"] == partial {
            assert_eq!(tool["transcript"]["messages"].as_array().unwrap().len(), 3);
            assert!(tool["pending"].is_null());
            break;
        }
        assert!(Instant::now() < deadline, "{snapshot}");
        thread::sleep(Duration::from_millis(5));
    }
    assert!(queue(&runtime, &sid, "b", false)["error"].is_null());
    assert!(queue(&runtime, &sid, "d", true)["error"].is_null());
    wait(&runtime, &sid, "cancelled");
    let log = path
        .join("desktop-runtime-v1")
        .join(&sid)
        .join("runs-v1/tools-v3/request.jsonl");
    let durable = std::fs::read(&log).unwrap();
    release_tx.send(()).unwrap();
    for _ in 0..2 {
        let advanced = advance(&runtime, &sid);
        assert!(advanced["error"].is_null(), "{advanced}");
        wait(&runtime, &sid, "completed");
    }
    let bodies = server.join().unwrap();
    let mut expected = bodies[1]["messages"].as_array().unwrap().clone();
    assert_eq!(expected.len(), 3);
    assert_eq!(expected[0], json!({"role":"user","content":"hello"}));
    assert_eq!(expected[1]["content"], "prior-round");
    assert_eq!(expected[1]["tool_calls"][0]["id"], "a-call");
    assert_eq!(expected[2]["role"], "tool");
    assert_eq!(expected[2]["tool_call_id"], "a-call");
    if !empty {
        expected.push(json!({"role":"assistant","content":partial}));
    }
    expected.push(json!({"role":"user","content":"D"}));
    assert_eq!(bodies[2]["messages"], json!(expected));
    expected.push(json!({"role":"assistant","content":answer}));
    expected.push(json!({"role":"user","content":"B"}));
    assert_eq!(bodies[3]["messages"], json!(expected));
    assert_eq!(executor.calls.load(Ordering::SeqCst), 1);
    assert_eq!(std::fs::read(&log).unwrap(), durable);
    let pending = queue(&runtime, &sid, "c", false);
    assert!(pending["error"].is_null(), "{pending}");
    drop(runtime);
    let reopened = DesktopRuntime::open_with_queueing(root.path(), ps(), bindings()).unwrap();
    let recovered = state(&reopened, &sid);
    assert_eq!(recovered["closureReason"], "recovered");
    let abandoned = recovered["messages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|message| message["uuid"] == "c")
        .unwrap();
    assert_eq!(abandoned["disposition"], "abandoned");
    assert_eq!(queue(&reopened, &sid, "c", false), pending);
    let history = call(
        &reopened,
        "sessions.historyV2",
        json!({"sessionId":sid,"after":0,"limit":128}),
    );
    assert!(history["error"].is_null(), "{history}");
    assert_eq!(history["result"]["turns"].as_array().unwrap().len(), 3);
    assert_eq!(
        history["result"]["turns"][0]["toolState"]["partialText"],
        partial
    );
    assert_eq!(std::fs::read(log).unwrap(), durable);
    assert_eq!(executor.calls.load(Ordering::SeqCst), 1);
    observer.set_nonblocking(true).unwrap();
    assert!(matches!(observer.accept(), Err(e) if e.kind() == std::io::ErrorKind::WouldBlock));
    drop(reopened);
    std::fs::remove_dir_all(path).unwrap();
}

#[test]
fn tool_redirect_preserves_unfinished_round_for_descendant_and_reopen() {
    unfinished_round(false);
}

#[test]
fn tool_redirect_omits_empty_partial_and_keeps_completed_empty_assistant() {
    unfinished_round(true);
}
