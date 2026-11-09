#[path = "../src/run_commands.rs"]
mod run_commands;
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
