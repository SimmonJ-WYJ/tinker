#[path = "support/http.rs"]
mod http_support;
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant},
};
use tauri::{
    ipc::{CallbackFn, InvokeBody},
    test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY},
    webview::InvokeRequest,
};
use tinker_rust_foundation::run_commands;
static NEXT: AtomicU64 = AtomicU64::new(0);
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!(
            "tinker-run-ipc-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&p).unwrap();
        Self(p)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
#[allow(dead_code)]
fn app(fixture: &Fixture) -> tauri::App<tauri::test::MockRuntime> {
    mock_builder()
        .manage(run_commands::RunHostState::new(&fixture.0))
        .invoke_handler(tauri::generate_handler![
            run_commands::start_lab_run,
            run_commands::continue_lab_run,
            run_commands::cancel_lab_run,
            run_commands::read_lab_run
        ])
        .build(mock_context(noop_assets()))
        .unwrap()
}
fn invoke(
    window: &tauri::WebviewWindow<tauri::test::MockRuntime>,
    cmd: &str,
    body: serde_json::Value,
) -> Result<serde_json::Value, serde_json::Value> {
    get_ipc_response(
        window,
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "http://tauri.localhost".parse().unwrap(),
            body: InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.into(),
        },
    )
    .map(|body| body.deserialize::<serde_json::Value>().unwrap())
}
fn terminal(
    window: &tauri::WebviewWindow<tauri::test::MockRuntime>,
    id: &str,
) -> serde_json::Value {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let page = invoke(window, "read_lab_run", serde_json::json!({"runId":id})).unwrap();
        if ["completed", "failed", "cancelled", "interrupted"]
            .contains(&page["snapshot"]["status"].as_str().unwrap())
        {
            return page;
        }
        assert!(Instant::now() < deadline, "离线执行未在有界时间内停止");
        std::thread::sleep(Duration::from_millis(5));
    }
}
#[test]
fn context_http_two_turns_restart_and_branches() {
    use std::{io::Write, net::TcpListener};
    let fixture = Fixture::new();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/chat", listener.local_addr().unwrap());
    let server = std::thread::spawn(move || {
        let expected = [
            serde_json::json!([{"role":"user","content":"问题一"}]),
            serde_json::json!([{"role":"user","content":"问题一"},{"role":"assistant","content":"回答✨"},{"role":"user","content":"问题二"}]),
            serde_json::json!([{"role":"user","content":"问题一"},{"role":"assistant","content":"回答✨"},{"role":"user","content":"问题二"},{"role":"assistant","content":"回答✨"},{"role":"user","content":"三"}]),
            serde_json::json!([{"role":"user","content":"问题一"},{"role":"assistant","content":"回答✨"},{"role":"user","content":"分支"}]),
            serde_json::json!([{"role":"user","content":"问题一"},{"role":"assistant","content":"回答✨"},{"role":"user","content":"问题二"},{"role":"assistant","content":"回答✨"},{"role":"user","content":"父B"}]),
        ];
        for messages in expected {
            let (mut socket, _) = listener.accept().unwrap();
            let bytes = http_support::read_request(&mut socket);
            let end = bytes.windows(4).position(|v| v == b"\r\n\r\n").unwrap() + 4;
            let body: serde_json::Value = serde_json::from_slice(&bytes[end..]).unwrap();
            assert_eq!(body["messages"], messages);
            let body = "data: {\"choices\":[{\"delta\":{\"content\":\"回答\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"✨\"}}]}\n\ndata: [DONE]\n\n";
            write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
        }
    });
    for phase in 0..2 {
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "context_http_child", "--nocapture"])
            .env("TINKER_CONTEXT_ROOT", &fixture.0)
            .env("TINKER_CONTEXT_ENDPOINT", &endpoint)
            .env("TINKER_CONTEXT_PHASE", phase.to_string())
            .status()
            .unwrap();
        assert!(status.success());
    }
    server.join().unwrap();
}
#[test]
fn context_http_child() {
    let Ok(root) = std::env::var("TINKER_CONTEXT_ROOT") else {
        return;
    };
    let fixture = Fixture(PathBuf::from(root));
    let endpoint = std::env::var("TINKER_CONTEXT_ENDPOINT").unwrap();
    let phase: u8 = std::env::var("TINKER_CONTEXT_PHASE")
        .unwrap()
        .parse()
        .unwrap();
    let config = tinker_rust_foundation::chat_http::ChatHttpConfig::new(
        endpoint.clone(),
        "synthetic-key".into(),
        "synthetic-model".into(),
    )
    .unwrap();
    let app = mock_builder()
        .manage(run_commands::RunHostState::with_chat_http(
            &fixture.0, config,
        ))
        .invoke_handler(tauri::generate_handler![
            run_commands::start_lab_run,
            run_commands::continue_lab_run,
            run_commands::read_lab_run,
            run_commands::cancel_lab_run
        ])
        .build(mock_context(noop_assets()))
        .unwrap();
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    if phase == 1 {
        let b = invoke(&window,"continue_lab_run",serde_json::json!({"requestId":"B","parentRunId":"A","input":"问题二","scenario":"success"})).unwrap();
        assert_eq!(b["status"], "completed");
    }
    let requests = if phase == 0 {
        vec![("A", None, "问题一"), ("B", Some("A"), "问题二")]
    } else {
        vec![
            ("C", Some("B"), "三"),
            ("D", Some("A"), "分支"),
            ("E", Some("B"), "父B"),
        ]
    };
    for (id, parent, input) in requests {
        let cmd = if parent.is_some() {
            "continue_lab_run"
        } else {
            "start_lab_run"
        };
        let req = serde_json::json!({"requestId":id,"parentRunId":parent,"input":input,"scenario":"success"});
        invoke(&window, cmd, req.clone()).unwrap();
        let page = terminal(&window, id);
        assert_eq!(page["snapshot"]["status"], "completed");
        assert_eq!(page["snapshot"]["output"], "回答✨");
        let _: tinker_rust_foundation::run_types::RunEventPage =
            serde_json::from_value(page.clone()).unwrap();
        assert_eq!(invoke(&window, cmd, req).unwrap(), page["snapshot"]);
        assert_eq!(
            invoke(&window, "cancel_lab_run", serde_json::json!({"runId":id})).unwrap(),
            page["snapshot"]
        );
    }
    std::mem::forget(fixture);
}
fn host(fixture: &Fixture, endpoint: &str) -> tauri::App<tauri::test::MockRuntime> {
    let config = tinker_rust_foundation::chat_http::ChatHttpConfig::new(
        endpoint.into(),
        "synthetic-key".into(),
        "synthetic-model".into(),
    )
    .unwrap()
    .with_timeouts(Duration::from_secs(2), Duration::from_millis(250))
    .unwrap();
    mock_builder()
        .manage(run_commands::RunHostState::with_chat_http(
            &fixture.0, config,
        ))
        .invoke_handler(tauri::generate_handler![
            run_commands::start_lab_run,
            run_commands::continue_lab_run,
            run_commands::cancel_lab_run,
            run_commands::read_lab_run
        ])
        .build(mock_context(noop_assets()))
        .unwrap()
}
fn child_process(fixture: &Fixture, endpoint: &str, mode: &str) -> std::process::ExitStatus {
    std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "context_fault_child", "--nocapture"])
        .env("TINKER_CONTEXT_ROOT", &fixture.0)
        .env("TINKER_CONTEXT_ENDPOINT", endpoint)
        .env("TINKER_CONTEXT_MODE", mode)
        .status()
        .unwrap()
}
#[test]
fn context_http_cancel_fail_timeout_transport_and_crash_exclude_failed_turn() {
    use std::{io::Write, net::TcpListener};
    for mode in [
        "cancel",
        "status",
        "timeout",
        "transport",
        "reflection",
        "crash",
    ] {
        let fixture = Fixture::new();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}/chat", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            for index in 0..3 {
                let (mut socket, _) = listener.accept().unwrap();
                let bytes = http_support::read_request(&mut socket);
                let end = bytes.windows(4).position(|v| v == b"\r\n\r\n").unwrap() + 4;
                let body: serde_json::Value = serde_json::from_slice(&bytes[end..]).unwrap();
                let messages = if index == 0 {
                    serde_json::json!([{"role":"user","content":"root"}])
                } else {
                    serde_json::json!([{"role":"user","content":"root"},{"role":"assistant","content":"a"},{"role":"user","content":"next"}])
                };
                assert_eq!(body["messages"], messages);
                if index == 1 {
                    match mode {
                        "status" => {
                            let body = "private-http-error-body synthetic-key";
                            write!(socket,"HTTP/1.1 503 Bad\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
                        }
                        "reflection" => {
                            let body="data: {\"choices\":[{\"delta\":{\"content\":\"synthetic-key\"}}]}\n\ndata: [DONE]\n\n";
                            write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
                        }
                        "transport" => {}
                        _ => {
                            let part =
                                "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n";
                            write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n{part}").unwrap();
                            socket.flush().unwrap();
                            std::thread::sleep(Duration::from_millis(400));
                            let _=write!(socket,"data: {{\"choices\":[{{\"delta\":{{\"content\":\"late\"}}}}]}}\n\ndata: [DONE]\n\n");
                        }
                    }
                } else {
                    let text =
                        "data: {\"choices\":[{\"delta\":{\"content\":\"a\"}}]}\n\ndata: [DONE]\n\n";
                    write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{text}",text.len()).unwrap();
                }
            }
            listener.set_nonblocking(true).unwrap();
            std::thread::sleep(Duration::from_millis(30));
            assert!(listener.accept().is_err());
        });
        let status = child_process(&fixture, &endpoint, mode);
        if mode == "crash" {
            assert_eq!(status.code(), Some(23));
            assert!(child_process(&fixture, &endpoint, "recover").success());
        } else {
            assert!(status.success());
        }
        server.join().unwrap();
    }
}
#[test]
fn context_fault_child() {
    let Ok(mode) = std::env::var("TINKER_CONTEXT_MODE") else {
        return;
    };
    let fixture = Fixture(PathBuf::from(std::env::var("TINKER_CONTEXT_ROOT").unwrap()));
    let endpoint = std::env::var("TINKER_CONTEXT_ENDPOINT").unwrap();
    let app = host(&fixture, &endpoint);
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let request =
        serde_json::json!({"requestId":"B","parentRunId":"A","input":"next","scenario":"success"});
    if mode != "recover" {
        invoke(
            &window,
            "start_lab_run",
            serde_json::json!({"requestId":"A","input":"root","scenario":"success"}),
        )
        .unwrap();
        assert_eq!(terminal(&window, "A")["snapshot"]["status"], "completed");
        invoke(&window, "continue_lab_run", request.clone()).unwrap();
        std::thread::scope(|scope| {
            let first = scope.spawn(|| invoke(&window, "continue_lab_run", request.clone()));
            let second = scope.spawn(|| invoke(&window, "continue_lab_run", request.clone()));
            assert_eq!(first.join().unwrap().unwrap()["runId"], "B");
            assert_eq!(second.join().unwrap().unwrap()["runId"], "B");
        });
        if ["cancel", "timeout", "crash"].contains(&mode.as_str()) {
            let until = Instant::now() + Duration::from_secs(3);
            loop {
                let page =
                    invoke(&window, "read_lab_run", serde_json::json!({"runId":"B"})).unwrap();
                if page["snapshot"]["output"] == "partial" {
                    break;
                }
                assert!(Instant::now() < until);
                std::thread::sleep(Duration::from_millis(2));
            }
        }
        if mode == "crash" {
            std::process::exit(23);
        }
        if mode == "cancel" {
            invoke(&window, "cancel_lab_run", serde_json::json!({"runId":"B"})).unwrap();
        }
    }
    let b = terminal(&window, "B");
    assert_eq!(
        b["snapshot"]["status"],
        if mode == "cancel" {
            "cancelled"
        } else if mode == "recover" {
            "interrupted"
        } else {
            "failed"
        }
    );
    if ["cancel", "timeout", "recover"].contains(&mode.as_str()) {
        assert_eq!(b["snapshot"]["output"], "partial");
    }
    if mode == "timeout" {
        assert_eq!(b["snapshot"]["errorCode"], "httpTimeout");
    }
    assert_eq!(
        invoke(&window, "continue_lab_run", request).unwrap(),
        b["snapshot"]
    );
    assert_eq!(invoke(&window,"continue_lab_run",serde_json::json!({"requestId":"bad","parentRunId":"B","input":"next","scenario":"success"})).unwrap_err(),"contextParentNotCompleted");
    std::thread::sleep(Duration::from_millis(450));
    invoke(
        &window,
        "continue_lab_run",
        serde_json::json!({"requestId":"C","parentRunId":"A","input":"next","scenario":"success"}),
    )
    .unwrap();
    assert_eq!(terminal(&window, "C")["snapshot"]["status"], "completed");
    assert_eq!(
        invoke(&window, "read_lab_run", serde_json::json!({"runId":"B"})).unwrap(),
        b
    );
    for id in ["A", "B", "C"] {
        let dir = if id == "A" {
            "runs-v1"
        } else {
            "runs-v1/context-v2"
        };
        let log = fs::read_to_string(fixture.0.join(dir).join(format!("{id}.jsonl"))).unwrap();
        assert!(!log.contains("synthetic-key"));
        assert!(!log.contains("private-http-error-body"));
    }
    assert!(!b.to_string().contains("synthetic-key"));
    assert!(!b.to_string().contains("private-http-error-body"));
    if mode == "reflection" {
        assert_eq!(b["snapshot"]["errorCode"], "httpProtocol");
        assert_eq!(b["snapshot"]["output"], "");
    }
    std::mem::forget(fixture);
}
#[test]
fn context_large_escaped_http_body_remains_typed_and_bounded() {
    use std::{io::Write, net::TcpListener};
    let fixture = Fixture::new();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/chat", listener.local_addr().unwrap());
    let server = std::thread::spawn(move || {
        for index in 0..2 {
            let (mut socket, _) = listener.accept().unwrap();
            let bytes = http_support::read_request_with_limit(
                &mut socket,
                tinker_rust_foundation::run_context::MAX_HTTP_REQUEST_BYTES + 16384,
            );
            let end = bytes.windows(4).position(|v| v == b"\r\n\r\n").unwrap() + 4;
            assert!(bytes.len() > 16384);
            assert!(
                bytes.len() - end <= tinker_rust_foundation::run_context::MAX_HTTP_REQUEST_BYTES
            );
            let v: serde_json::Value = serde_json::from_slice(&bytes[end..]).unwrap();
            let input = "\u{1}\"中".repeat(10000);
            assert_eq!(v["messages"][0]["content"], input);
            assert_eq!(
                v["messages"].as_array().unwrap().len(),
                if index == 0 { 1 } else { 3 }
            );
            if index == 1 {
                assert_eq!(
                    v["messages"][1],
                    serde_json::json!({"role":"assistant","content":"✨"})
                );
                assert_eq!(
                    v["messages"][2],
                    serde_json::json!({"role":"user","content":"\0续"})
                );
            }
            let text = "data: {\"choices\":[{\"delta\":{\"content\":\"✨\"}}]}\n\ndata: [DONE]\n\n";
            write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{text}",text.len()).unwrap();
        }
    });
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "context_large_child", "--nocapture"])
        .env("TINKER_CONTEXT_ROOT", &fixture.0)
        .env("TINKER_CONTEXT_ENDPOINT", endpoint)
        .status()
        .unwrap();
    assert!(status.success());
    server.join().unwrap();
}
#[test]
fn context_large_child() {
    let Ok(root) = std::env::var("TINKER_CONTEXT_ROOT") else {
        return;
    };
    let fixture = Fixture(PathBuf::from(root));
    let endpoint = std::env::var("TINKER_CONTEXT_ENDPOINT").unwrap();
    let app = host(&fixture, &endpoint);
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let input = "\u{1}\"中".repeat(10000);
    invoke(
        &window,
        "start_lab_run",
        serde_json::json!({"requestId":"A","input":input,"scenario":"success"}),
    )
    .unwrap();
    assert_eq!(terminal(&window, "A")["snapshot"]["status"], "completed");
    invoke(
        &window,
        "continue_lab_run",
        serde_json::json!({"requestId":"B","parentRunId":"A","input":"\0续","scenario":"success"}),
    )
    .unwrap();
    assert_eq!(terminal(&window, "B")["snapshot"]["status"], "completed");
    std::mem::forget(fixture);
}
