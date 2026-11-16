#[path = "support/http.rs"]
mod http_support;
use std::{
    io::Write,
    net::TcpListener,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};
use tinker_rust_foundation::{
    chat_http::{ChatHttpConfig, ChatHttpProvider},
    formal_platform::TrustedRoot,
    run_controller::RunController,
    run_types::RunError,
    session_lifecycle::RunStatus,
    synthetic_workspace::SyntheticWorkspace,
    tool_types::*,
};
static NEXT: AtomicUsize = AtomicUsize::new(0);
fn root() -> TrustedRoot {
    TrustedRoot::create_temporary(std::fs::canonicalize(std::env::temp_dir()).unwrap().join(
        format!(
            "tinker-tauri-formal-preview-adversarial-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        ),
    ))
    .unwrap()
}
fn frame(delta: serde_json::Value, finish: Option<&str>) -> String {
    format!(
        "data: {}\n\n",
        serde_json::json!({"choices":[{"index":0,"delta":delta,"finish_reason":finish}]})
    )
}
fn call(id: &str) -> serde_json::Value {
    serde_json::json!({"tool_calls":[{"index":0,"id":id,"type":"function","function":{"name":"workspace_read","arguments":"{\"path\":\"notes/intro.txt\"}"}}]})
}
fn response(s: &mut std::net::TcpStream, status: u16, body: &str) {
    write!(s,"HTTP/1.1 {status} Response\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
}
struct Executor {
    workspace: SyntheticWorkspace,
    count: Arc<AtomicUsize>,
    leak: bool,
}
impl ToolExecutor for Executor {
    fn workspace_revision(&self) -> &str {
        self.workspace.workspace_revision()
    }
    fn catalog(&self) -> Vec<ToolSpec> {
        self.workspace.catalog()
    }
    fn execute(&self, c: &ToolCall, t: &AtomicBool) -> Result<ToolResult, RunError> {
        self.count.fetch_add(1, Ordering::SeqCst);
        let mut r = self.workspace.execute(c, t)?;
        if self.leak {
            r.content = "known-fake-key".into();
        }
        Ok(r)
    }
}
fn run_case(
    responses: Vec<(u16, String)>,
    leak: bool,
    expected_calls: usize,
    expected_error: Option<&str>,
) {
    let root = root();
    let counts = Arc::new(AtomicUsize::new(0));
    let executor = Arc::new(Executor {
        workspace: SyntheticWorkspace::create(&root).unwrap(),
        count: counts.clone(),
        leak,
    });
    let options = ToolRunOptions::new(
        executor.workspace_revision().into(),
        Duration::from_secs(2),
        Duration::from_secs(5),
    )
    .unwrap();
    let c = RunController::open_with_tools(root.path()).unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/chat", listener.local_addr().unwrap());
    let seen = Arc::new(AtomicUsize::new(0));
    let seen_server = seen.clone();
    let expected_requests = responses.len();
    let server = thread::spawn(move || {
        listener.set_nonblocking(true).unwrap();
        let deadline = Instant::now() + Duration::from_secs(6);
        for (status, body) in responses {
            let mut socket = loop {
                match listener.accept() {
                    Ok((s, _)) => break s,
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        assert!(Instant::now() < deadline);
                        thread::sleep(Duration::from_millis(2));
                    }
                    Err(e) => panic!("{e}"),
                }
            };
            socket.set_nonblocking(false).unwrap();
            http_support::read_request(&mut socket);
            seen_server.fetch_add(1, Ordering::SeqCst);
            response(&mut socket, status, &body);
        }
        listener
    });
    c.start_tools(
        "r1".into(),
        None,
        "read".into(),
        Arc::new(ChatHttpProvider::new(
            ChatHttpConfig::new(url, "known-fake-key".into(), "synthetic".into()).unwrap(),
        )),
        executor,
        options,
    )
    .unwrap();
    let deadline = Instant::now() + Duration::from_secs(6);
    loop {
        let page = c.read_tools("r1", 0, 256).unwrap();
        assert!(!serde_json::to_string(&page)
            .unwrap()
            .contains("known-fake-key"));
        let s = page.snapshot;
        if let Some(p) = s.pending {
            c.respond_permission(
                "r1",
                PermissionReply {
                    permission_id: p.permission_id,
                    decision: PermissionDecision::Granted,
                },
            )
            .unwrap();
        }
        if matches!(s.status, RunStatus::Failed | RunStatus::Completed) {
            assert_eq!(s.status, RunStatus::Failed);
            if let Some(code) = expected_error {
                assert_eq!(s.error_code.as_deref(), Some(code));
            }
            break;
        }
        assert!(Instant::now() < deadline);
        thread::sleep(Duration::from_millis(2));
    }
    assert_eq!(counts.load(Ordering::SeqCst), expected_calls);
    assert_eq!(seen.load(Ordering::SeqCst), expected_requests);
    let listener = server.join().unwrap();
    assert!(matches!(listener.accept(),Err(e) if e.kind()==std::io::ErrorKind::WouldBlock));
    assert!(
        !std::fs::read_to_string(root.path().join("runs-v1/tools-v3/r1.jsonl"))
            .unwrap()
            .contains("known-fake-key")
    );
}
#[test]
fn actual_http_rejects_result_secret_before_persistence() {
    run_case(
        vec![(
            200,
            frame(call("c1"), Some("tool_calls")) + "data: [DONE]\n\n",
        )],
        true,
        1,
        Some("toolFailed"),
    );
}
#[test]
fn actual_http_rejects_changed_and_empty_metadata() {
    for field in ["id", "name", "type"] {
        for empty in [false, true] {
            let mut first = call("c1");
            if empty {
                if field == "name" {
                    first["tool_calls"][0]["function"]["name"] = "".into();
                } else {
                    first["tool_calls"][0][field] = "".into();
                }
            }
            let replacement = if field == "name" {
                serde_json::json!({"tool_calls":[{"index":0,"function":{"name":"workspace_list"}}]})
            } else {
                let mut v = serde_json::json!({"tool_calls":[{"index":0}]});
                v["tool_calls"][0][field] = if field == "id" { "c2" } else { "function" }.into();
                v
            };
            run_case(
                vec![(
                    200,
                    frame(first, None)
                        + &frame(replacement, Some("tool_calls"))
                        + "data: [DONE]\n\n",
                )],
                false,
                0,
                None,
            );
        }
    }
}
#[test]
fn actual_http_rejects_multiple_choices_and_hides_error_body() {
    run_case(vec![(200,"data: {\"choices\":[{\"index\":0,\"delta\":{}},{\"index\":1,\"delta\":{\"content\":\"known-fake-key\"}}]}\n\n".into())],false,0,None);
    run_case(vec![(500, "known-fake-key".into())], false, 0, None);
}
#[test]
fn actual_http_fifth_call_hits_four_call_cap() {
    run_case(
        (0..5)
            .map(|i| {
                (
                    200,
                    frame(call(&format!("c{i}")), Some("tool_calls")) + "data: [DONE]\n\n",
                )
            })
            .collect(),
        false,
        4,
        Some("toolLimit"),
    );
}
#[test]
fn child_exits_after_real_read_before_result_commit() {
    let Ok(path) = std::env::var("TINKER_TEST_READ_CRASH_ROOT") else {
        return;
    };
    struct Crash(SyntheticWorkspace, std::path::PathBuf);
    impl ToolExecutor for Crash {
        fn workspace_revision(&self) -> &str {
            self.0.workspace_revision()
        }
        fn catalog(&self) -> Vec<ToolSpec> {
            self.0.catalog()
        }
        fn execute(&self, c: &ToolCall, t: &AtomicBool) -> Result<ToolResult, RunError> {
            let result = self.0.execute(c, t)?;
            assert_eq!(
                result.content,
                "This is a synthetic workspace. Unicode fixture: café — 你好.\n"
            );
            let mut marker = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.1)
                .unwrap();
            marker.write_all(result.content.as_bytes()).unwrap();
            marker.sync_all().unwrap();
            std::process::exit(73);
        }
    }
    let root = TrustedRoot::open_temporary(path).unwrap();
    let e = Arc::new(Crash(
        SyntheticWorkspace::create(&root).unwrap(),
        root.path().join("read-marker"),
    ));
    let o = ToolRunOptions::new(
        e.workspace_revision().into(),
        Duration::from_secs(2),
        Duration::from_secs(5),
    )
    .unwrap();
    let c = RunController::open_with_tools(root.path()).unwrap();
    let provider = ChatHttpProvider::new(
        ChatHttpConfig::new(
            std::env::var("TINKER_TEST_READ_CRASH_URL").unwrap(),
            "fake-key".into(),
            "synthetic".into(),
        )
        .unwrap(),
    );
    c.start_tools("r1".into(), None, "read".into(), Arc::new(provider), e, o)
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(6);
    loop {
        if let Some(p) = c.read_tools("r1", 0, 256).unwrap().snapshot.pending {
            c.respond_permission(
                "r1",
                PermissionReply {
                    permission_id: p.permission_id,
                    decision: PermissionDecision::Granted,
                },
            )
            .unwrap();
        }
        assert!(Instant::now() < deadline);
        thread::sleep(Duration::from_millis(2));
    }
}
#[test]
fn real_read_crash_reopen_closes_without_network_or_runner() {
    let root = root();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/chat", listener.local_addr().unwrap());
    let server = thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        http_support::read_request(&mut socket);
        response(
            &mut socket,
            200,
            &(frame(call("c1"), Some("tool_calls")) + "data: [DONE]\n\n"),
        );
        listener
    });
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "child_exits_after_real_read_before_result_commit",
            "--test-threads=1",
        ])
        .env("TINKER_TEST_READ_CRASH_ROOT", root.path())
        .env("TINKER_TEST_READ_CRASH_URL", url)
        .status()
        .unwrap();
    assert_eq!(status.code(), Some(73));
    let marker = std::fs::read(root.path().join("read-marker")).unwrap();
    let log = root.path().join("runs-v1/tools-v3/r1.jsonl");
    let before = std::fs::read_to_string(&log).unwrap();
    assert!(before.contains("toolStarted"));
    assert!(!before.contains("toolFinished"));
    let listener = server.join().unwrap();
    listener.set_nonblocking(true).unwrap();
    let c = RunController::open_with_tools(root.path()).unwrap();
    let page = c.read_tools("r1", 0, 256).unwrap();
    assert_eq!(page.snapshot.status, RunStatus::Interrupted);
    assert!(page.snapshot.pending.is_none());
    assert!(
        matches!(page.snapshot.transcript.messages.last(),Some(TranscriptMessage::Tool{result}) if result.outcome==ToolOutcome::Interrupted)
    );
    assert_eq!(
        std::fs::read(root.path().join("read-marker")).unwrap(),
        marker
    );
    assert_eq!(
        std::fs::read_to_string(log)
            .unwrap()
            .matches("toolStarted")
            .count(),
        1
    );
    assert!(matches!(listener.accept(),Err(e) if e.kind()==std::io::ErrorKind::WouldBlock));
}

#[test]
fn structured_metadata_guard_checks_nested_identifiers_and_policy_without_exposing_key() {
    use tinker_rust_foundation::run_provider::RunProvider;
    let provider = ChatHttpProvider::new(
        ChatHttpConfig::new(
            "http://127.0.0.1:1/chat".into(),
            "known-fake-key".into(),
            "synthetic".into(),
        )
        .unwrap(),
    );
    for metadata in [
        serde_json::json!({"requestId":"known-fake-key"}),
        serde_json::json!({"parent":{"runId":"known-fake-key","sequence":1}}),
        serde_json::json!({"workspaceRevision":"known-fake-key"}),
        serde_json::json!({"binding":{"configRevision":"prefix-known-fake-key-suffix"}}),
    ] {
        assert_eq!(
            provider.validate_tool_metadata(&metadata),
            Err(RunError::ToolFailed)
        );
    }
    assert_eq!(provider.validate_tool_metadata(&serde_json::json!({"requestId":"safe","parent":null,"workspaceRevision":"synthetic-v1"})),Ok(()));
}
