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
fn app(fixture: &Fixture) -> tauri::App<tauri::test::MockRuntime> {
    mock_builder()
        .manage(run_commands::RunHostState::new(&fixture.0))
        .invoke_handler(tauri::generate_handler![
            run_commands::start_lab_run,
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
fn real_handler_starts_streams_deduplicates_cancels_and_preserves_failure() {
    let fixture = Fixture::new();
    let app = app(&fixture);
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let start = serde_json::json!({"requestId":"success-1","input":"合成输入","scenario":"success","path":"/not-accepted"});
    let first = invoke(&window, "start_lab_run", start.clone()).unwrap();
    assert_eq!(first["providerKind"], "offlineFixture");
    assert_eq!(
        invoke(&window, "start_lab_run", start).unwrap()["runId"],
        first["runId"]
    );
    let page = terminal(&window, "success-1");
    assert_eq!(page["snapshot"]["status"], "completed");
    assert!(!page["snapshot"]["output"].as_str().unwrap().is_empty());
    let small = invoke(
        &window,
        "read_lab_run",
        serde_json::json!({"runId":"success-1","limit":1,"afterSequence":0}),
    )
    .unwrap();
    assert_eq!(small["events"].as_array().unwrap().len(), 1);
    assert_eq!(small["nextAfterSequence"], 1);
    invoke(
        &window,
        "start_lab_run",
        serde_json::json!({"requestId":"failure-1","input":"保留失败输入","scenario":"failure"}),
    )
    .unwrap();
    let failed = terminal(&window, "failure-1");
    assert_eq!(failed["snapshot"]["status"], "failed");
    assert_eq!(failed["snapshot"]["input"], "保留失败输入");
    assert!(!failed["snapshot"]["output"].as_str().unwrap().is_empty());
    invoke(
        &window,
        "start_lab_run",
        serde_json::json!({"requestId":"slow-1","input":"可取消","scenario":"slow"}),
    )
    .unwrap();
    assert_eq!(
        invoke(
            &window,
            "cancel_lab_run",
            serde_json::json!({"runId":"slow-1"})
        )
        .unwrap()["status"],
        "cancelled"
    );
    assert_eq!(
        invoke(
            &window,
            "cancel_lab_run",
            serde_json::json!({"runId":"slow-1"})
        )
        .unwrap()["status"],
        "cancelled"
    );
    assert_eq!(
        terminal(&window, "slow-1")["snapshot"]["status"],
        "cancelled"
    );
}
#[test]
fn handler_rejects_invalid_options_missing_ids_and_wrong_argument_types() {
    let fixture = Fixture::new();
    let app = app(&fixture);
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    assert_eq!(
        invoke(
            &window,
            "start_lab_run",
            serde_json::json!({"requestId":"../escape","input":"x","scenario":"success"})
        ),
        Err(serde_json::json!("runInvalidOptions"))
    );
    assert_eq!(
        invoke(
            &window,
            "start_lab_run",
            serde_json::json!({"requestId":"valid","input":"x","scenario":"real-provider"})
        ),
        Err(serde_json::json!("runInvalidOptions"))
    );
    assert_eq!(
        invoke(&window, "read_lab_run", serde_json::json!({})),
        Err(serde_json::json!("runNotFound"))
    );
    assert_eq!(
        invoke(
            &window,
            "read_lab_run",
            serde_json::json!({"runId":"missing","limit":0})
        ),
        Err(serde_json::json!("runInvalidOptions"))
    );
    assert!(invoke(
        &window,
        "start_lab_run",
        serde_json::json!({"requestId":7,"input":"x","scenario":"success"})
    )
    .is_err());
}
#[test]
fn unavailable_host_returns_fixed_error_without_starting_work() {
    let app = mock_builder()
        .manage(run_commands::RunHostState::unavailable())
        .invoke_handler(tauri::generate_handler![
            run_commands::start_lab_run,
            run_commands::cancel_lab_run,
            run_commands::read_lab_run
        ])
        .build(mock_context(noop_assets()))
        .unwrap();
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    assert_eq!(
        invoke(&window, "read_lab_run", serde_json::json!({})),
        Err(serde_json::json!("runUnavailable"))
    );
    assert_eq!(
        invoke(
            &window,
            "start_lab_run",
            serde_json::json!({"requestId":"x","input":"合成输入","scenario":"success"})
        ),
        Err(serde_json::json!("runUnavailable"))
    );
}
#[test]
fn crash_fixture_child() {
    let Ok(root) = std::env::var("TINKER_RUN_CRASH_DIR") else {
        return;
    };
    let fixture = Fixture(PathBuf::from(root));
    let app = app(&fixture);
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    invoke(
        &window,
        "start_lab_run",
        serde_json::json!({"requestId":"crash-run","input":"重启保留输入","scenario":"slow"}),
    )
    .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let page = invoke(
            &window,
            "read_lab_run",
            serde_json::json!({"runId":"crash-run"}),
        )
        .unwrap();
        if !page["snapshot"]["output"].as_str().unwrap().is_empty() {
            break;
        }
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(10));
    }
    // 不运行析构，模拟进程退出；只有已经同步落盘的片段能由父进程恢复。
    std::process::exit(0);
}
#[test]
fn real_handler_restores_interrupted_after_abrupt_process_exit_without_replaying_provider() {
    let fixture = Fixture::new();
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "crash_fixture_child", "--nocapture"])
        .env("TINKER_RUN_CRASH_DIR", &fixture.0)
        .status()
        .unwrap();
    assert!(status.success());
    let app = app(&fixture);
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let page = invoke(&window, "read_lab_run", serde_json::json!({})).unwrap();
    assert_eq!(page["snapshot"]["runId"], "crash-run");
    assert_eq!(page["snapshot"]["status"], "interrupted");
    assert_eq!(page["snapshot"]["input"], "重启保留输入");
    assert!(!page["snapshot"]["output"].as_str().unwrap().is_empty());
    let sequence = page["snapshot"]["sequence"].clone();
    std::thread::sleep(Duration::from_millis(60));
    assert_eq!(
        invoke(&window, "read_lab_run", serde_json::json!({})).unwrap()["snapshot"]["sequence"],
        sequence
    );
    assert_eq!(
        invoke(
            &window,
            "start_lab_run",
            serde_json::json!({"requestId":"crash-run","input":"重启保留输入","scenario":"slow"})
        )
        .unwrap()["status"],
        "interrupted"
    );
}

struct HostEcho;
impl tinker_rust_foundation::run_provider::RunProvider for HostEcho {
    fn execute(
        &self,
        input: &str,
        _: &std::sync::atomic::AtomicBool,
        emit: &mut dyn FnMut(&str) -> Result<(), tinker_rust_foundation::run_types::RunError>,
    ) -> Result<(), tinker_rust_foundation::run_types::RunError> {
        emit(input)?;
        emit("/host")
    }
}
struct HostPanic;
impl tinker_rust_foundation::run_provider::RunProvider for HostPanic {
    fn execute(
        &self,
        _: &str,
        _: &std::sync::atomic::AtomicBool,
        emit: &mut dyn FnMut(&str) -> Result<(), tinker_rust_foundation::run_types::RunError>,
    ) -> Result<(), tinker_rust_foundation::run_types::RunError> {
        emit("partial")?;
        panic!("private synthetic panic payload");
    }
}
#[test]
fn real_handler_uses_trusted_host_provider_injection_without_changing_dto() {
    for (provider, expected_status, expected_output) in [
        (
            std::sync::Arc::new(HostEcho)
                as std::sync::Arc<dyn tinker_rust_foundation::run_provider::RunProvider>,
            "completed",
            "input/host",
        ),
        (std::sync::Arc::new(HostPanic), "failed", "partial"),
    ] {
        let fixture = Fixture::new();
        let app = mock_builder()
            .manage(run_commands::RunHostState::with_provider(
                &fixture.0, provider,
            ))
            .invoke_handler(tauri::generate_handler![
                run_commands::start_lab_run,
                run_commands::cancel_lab_run,
                run_commands::read_lab_run
            ])
            .build(mock_context(noop_assets()))
            .unwrap();
        let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let request =
            serde_json::json!({"requestId":"injected","input":"input","scenario":"failure"});
        invoke(&window, "start_lab_run", request.clone()).unwrap();
        let page = terminal(&window, "injected");
        assert_eq!(page["snapshot"]["status"], expected_status);
        assert_eq!(page["snapshot"]["output"], expected_output);
        assert_eq!(page["snapshot"]["scenario"], "failure");
        assert_eq!(
            invoke(&window, "start_lab_run", request).unwrap(),
            page["snapshot"]
        );
        let log = fs::read_to_string(fixture.0.join("runs-v1/injected.jsonl")).unwrap();
        assert!(!log.contains("private synthetic"));
        if expected_status == "failed" {
            assert_eq!(page["snapshot"]["errorCode"], "providerPanicked");
        }
    }
}

#[test]
fn http_host_real_handler_streams_once_and_reopens_history() {
    use std::{io::Write, net::TcpListener};
    let fixture = Fixture::new();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!(
        "http://{}/v1/chat/completions",
        listener.local_addr().unwrap()
    );
    let server = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        let buf = http_support::read_request(&mut socket);
        let request = std::str::from_utf8(&buf).unwrap();
        assert!(request.starts_with("POST /v1/chat/completions"));
        let body="data: {\"choices\":[{\"delta\":{\"content\":\"synthetic output\"}}]}\n\ndata: [DONE]\n\n";
        write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
        listener.set_nonblocking(true).unwrap();
        std::thread::sleep(Duration::from_millis(50));
        assert!(listener.accept().is_err());
    });
    let child = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "http_fixture_child", "--nocapture"])
        .env("TINKER_HTTP_TEST_ROOT", &fixture.0)
        .env("TINKER_HTTP_TEST_ENDPOINT", endpoint)
        .status()
        .unwrap();
    assert!(child.success());
    server.join().unwrap();
    let app = app(&fixture);
    let window = tauri::WebviewWindowBuilder::new(&app, "reopened", Default::default())
        .build()
        .unwrap();
    assert_eq!(
        invoke(
            &window,
            "read_lab_run",
            serde_json::json!({"runId":"http-once"})
        )
        .unwrap()["snapshot"]["output"],
        "synthetic output"
    );
}

#[test]
fn http_errors_and_reflected_keys_never_enter_ipc_or_jsonl() {
    use std::{io::Write, net::TcpListener};
    use tinker_rust_foundation::chat_http::ChatHttpConfig;
    for status in [401, 429, 503, 200] {
        let fixture = Fixture::new();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!(
            "http://{}/v1/chat/completions",
            listener.local_addr().unwrap()
        );
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            http_support::read_request(&mut socket);
            let body = if status == 200 {
                "data: {\"choices\":[{\"delta\":{\"content\":\"safe fake-secret-\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"token\"}}]}\n\ndata: [DONE]\n\n"
            } else {
                "fake-secret-token private-error-body"
            };
            let _=write!(socket,"HTTP/1.1 {status} Synthetic\r\nContent-Type: text/event-stream\r\nX-Secret: fake-secret-token\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());
        });
        {
            let app = mock_builder()
                .manage(run_commands::RunHostState::with_chat_http(
                    &fixture.0,
                    ChatHttpConfig::new(
                        endpoint,
                        "fake-secret-token".into(),
                        "synthetic-model".into(),
                    )
                    .unwrap(),
                ))
                .invoke_handler(tauri::generate_handler![
                    run_commands::start_lab_run,
                    run_commands::read_lab_run,
                    run_commands::cancel_lab_run
                ])
                .build(mock_context(noop_assets()))
                .unwrap();
            let window = tauri::WebviewWindowBuilder::new(&app, "redaction", Default::default())
                .build()
                .unwrap();
            invoke(&window,"start_lab_run",serde_json::json!({"requestId":"redaction","input":"synthetic input","scenario":"success"})).unwrap();
            let page = terminal(&window, "redaction");
            assert_eq!(page["snapshot"]["status"], "failed");
            assert_eq!(
                page["snapshot"]["output"],
                if status == 200 { "safe " } else { "" }
            );
            let text = page.to_string();
            for sensitive in [
                "fake-secret-token",
                "private-error-body",
                "127.0.0.1",
                "reqwest",
            ] {
                assert!(!text.contains(sensitive));
            }
        }
        server.join().unwrap();
        fn check_tree(path: &std::path::Path) {
            for entry in fs::read_dir(path).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    check_tree(&path)
                } else {
                    let bytes = fs::read(path).unwrap();
                    let text = String::from_utf8_lossy(&bytes);
                    for secret in ["fake-secret-token", "fake-secret-", "private-error-body"] {
                        assert!(!text.contains(secret));
                    }
                }
            }
        }
        check_tree(&fixture.0);
    }
}

#[test]
fn http_fixture_child() {
    let Some(root) = std::env::var_os("TINKER_HTTP_TEST_ROOT") else {
        return;
    };
    let endpoint = std::env::var("TINKER_HTTP_TEST_ENDPOINT").unwrap();
    let url = reqwest::Url::parse(&endpoint).unwrap();
    assert!(url
        .host_str()
        .unwrap()
        .parse::<std::net::IpAddr>()
        .unwrap()
        .is_loopback());
    use tinker_rust_foundation::chat_http::ChatHttpConfig;
    let app = mock_builder()
        .manage(run_commands::RunHostState::with_chat_http(
            &root,
            ChatHttpConfig::new(endpoint, "fake-credential".into(), "synthetic-model".into())
                .unwrap(),
        ))
        .invoke_handler(tauri::generate_handler![
            run_commands::start_lab_run,
            run_commands::read_lab_run,
            run_commands::cancel_lab_run
        ])
        .build(mock_context(noop_assets()))
        .unwrap();
    let window = tauri::WebviewWindowBuilder::new(&app, "http", Default::default())
        .build()
        .unwrap();
    let request = serde_json::json!({"requestId":"http-once","input":"synthetic input","scenario":"success","endpoint":"http://127.0.0.1:1/ignored"});
    invoke(&window, "start_lab_run", request.clone()).unwrap();
    let page = terminal(&window, "http-once");
    assert_eq!(page["snapshot"]["status"], "completed");
    assert_eq!(page["snapshot"]["output"], "synthetic output");
    invoke(&window, "start_lab_run", request).unwrap();
    assert!(!page.to_string().contains("fake-credential"));
}

#[test]
fn http_handler_cancel_deduplicates_active_request_and_rejects_late_output() {
    use std::{
        io::{Read, Write},
        net::TcpListener,
    };
    use tinker_rust_foundation::chat_http::ChatHttpConfig;
    let fixture = Fixture::new();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!(
        "http://{}/v1/chat/completions",
        listener.local_addr().unwrap()
    );
    let server = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        http_support::read_request(&mut socket);
        let mut buf = [0; 1];
        socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: 100000\r\n\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n").unwrap();
        match socket.read(&mut buf) {
            Ok(0) => (),
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::BrokenPipe
                ) => {}
            other => panic!("客户端未释放连接: {other:?}"),
        }
        let _ = socket.write_all(b"data: {\"choices\":[{\"delta\":{\"content\":\"late\"}}]}\n\n");
        listener.set_nonblocking(true).unwrap();
        assert!(listener.accept().is_err());
    });
    let app = mock_builder()
        .manage(run_commands::RunHostState::with_chat_http(
            &fixture.0,
            ChatHttpConfig::new(
                endpoint,
                "fake-secret-token".into(),
                "synthetic-model".into(),
            )
            .unwrap(),
        ))
        .invoke_handler(tauri::generate_handler![
            run_commands::start_lab_run,
            run_commands::read_lab_run,
            run_commands::cancel_lab_run
        ])
        .build(mock_context(noop_assets()))
        .unwrap();
    let window = tauri::WebviewWindowBuilder::new(&app, "cancel-http", Default::default())
        .build()
        .unwrap();
    let request = serde_json::json!({"requestId":"cancel-http","input":"synthetic input","scenario":"success"});
    invoke(&window, "start_lab_run", request.clone()).unwrap();
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        let page = invoke(
            &window,
            "read_lab_run",
            serde_json::json!({"runId":"cancel-http"}),
        )
        .unwrap();
        if page["snapshot"]["output"] == "partial" {
            break;
        }
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(5));
    }
    invoke(&window, "start_lab_run", request).unwrap();
    let snapshot = invoke(
        &window,
        "cancel_lab_run",
        serde_json::json!({"runId":"cancel-http"}),
    )
    .unwrap();
    assert_eq!(snapshot["status"], "cancelled");
    assert_eq!(snapshot["output"], "partial");
    server.join().unwrap();
    let page = invoke(
        &window,
        "read_lab_run",
        serde_json::json!({"runId":"cancel-http"}),
    )
    .unwrap();
    assert_eq!(page["snapshot"], snapshot);
    assert!(
        !fs::read_to_string(fixture.0.join("runs-v1/cancel-http.jsonl"))
            .unwrap()
            .contains("late")
    );
}

fn assert_http_budget_output(key: String, prefix: String, text: String) {
    use std::{io::Write, net::TcpListener};
    use tinker_rust_foundation::chat_http::ChatHttpConfig;
    let fixture = Fixture::new();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!(
        "http://{}/v1/chat/completions",
        listener.local_addr().unwrap()
    );
    let expected = prefix.clone() + &text;
    let server = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        http_support::read_request(&mut socket);
        let first = serde_json::json!({"choices":[{"delta":{"content":prefix}}]});
        let second = serde_json::json!({"choices":[{"delta":{"content":text}}]});
        let body = format!("data: {first}\n\ndata: {second}\n\ndata: [DONE]\n\n");
        write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
    });
    let app = mock_builder()
        .manage(run_commands::RunHostState::with_chat_http(
            &fixture.0,
            ChatHttpConfig::new(endpoint, key, "synthetic-model".into()).unwrap(),
        ))
        .invoke_handler(tauri::generate_handler![
            run_commands::start_lab_run,
            run_commands::read_lab_run
        ])
        .build(mock_context(noop_assets()))
        .unwrap();
    let window = tauri::WebviewWindowBuilder::new(&app, "budget-http", Default::default())
        .build()
        .unwrap();
    invoke(&window,"start_lab_run",serde_json::json!({"requestId":"budget-http","input":"synthetic input","scenario":"success"})).unwrap();
    let page = terminal(&window, "budget-http");
    assert_eq!(page["snapshot"]["status"], "completed");
    assert_eq!(page["snapshot"]["output"], expected);
    server.join().unwrap();
}

#[test]
fn http_secret_prefix_release_respects_utf8_event_budget() {
    assert_http_budget_output(
        "fake-secret-token".into(),
        "fake-".into(),
        "好".repeat(5461) + "x",
    );
    assert_http_budget_output(
        "a".repeat(1000) + "b",
        "a".repeat(1000),
        "\0\n\t\"\\".repeat(3200),
    );
    assert_http_budget_output("\"".repeat(8191) + "b", "\"".repeat(8191), String::new());
}
