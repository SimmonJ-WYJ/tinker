use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};
use tauri::{
    ipc::{CallbackFn, InvokeBody},
    test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY},
    webview::InvokeRequest,
};
use tinker_rust_foundation::history_commands::{self, HistoryState};
static NEXT: AtomicU64 = AtomicU64::new(0);
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!(
            "tinker-history-ipc-{}-{}",
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
fn invoke(
    root: &std::path::Path,
    body: serde_json::Value,
) -> Result<serde_json::Value, serde_json::Value> {
    let app = mock_builder()
        .manage(HistoryState::new(root))
        .invoke_handler(tauri::generate_handler![
            history_commands::read_session_history
        ])
        .build(mock_context(noop_assets()))
        .unwrap();
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    get_ipc_response(
        &window,
        InvokeRequest {
            cmd: "read_session_history".into(),
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
#[test]
fn real_invoke_dispatch_deserializes_arguments_and_returns_serialized_page() {
    let fixture = Fixture::new();
    let path = fixture.0.join("history.jsonl");
    let records=(1..=3).map(|i|format!("{}\n",serde_json::json!({"type":"assistant","message":{"content":[{"type":"text","text":format!("fixture {i}")}]},"uuid":format!("fixture-{i}"),"parent_tool_use_id":null}))).collect::<String>();
    fs::write(&path, &records).unwrap();
    let page=invoke(&fixture.0,serde_json::json!({"sessionId":"history","limit":2,"beforeLine":null,"path":"/not-accepted/outside.jsonl"})).unwrap();
    assert_eq!(page["protocolVersion"], 1);
    assert_eq!(page["entries"][0]["lineNumber"], 2);
    assert_eq!(page["entries"][1]["text"], "fixture 3");
    let older = invoke(
        &fixture.0,
        serde_json::json!({"sessionId":"history","limit":2,"beforeLine":page["nextBeforeLine"]}),
    )
    .unwrap();
    assert_eq!(older["entries"].as_array().unwrap().len(), 1);
    assert_eq!(older["entries"][0]["lineNumber"], 1);
    assert_eq!(fs::read(&path).unwrap(), records.as_bytes());
}
#[test]
fn invoke_rejects_escape_missing_data_and_bad_cursors_with_fixed_codes() {
    let fixture = Fixture::new();
    assert_eq!(
        invoke(&fixture.0, serde_json::json!({"sessionId":"../private"})),
        Err(serde_json::json!("historyInvalidOptions"))
    );
    assert_eq!(
        invoke(&fixture.0, serde_json::json!({"sessionId":"missing"})),
        Err(serde_json::json!("historyNotFound"))
    );
    fs::write(
        fixture.0.join("history.jsonl"),
        "private malformed fixture\n",
    )
    .unwrap();
    assert_eq!(
        invoke(&fixture.0, serde_json::json!({"sessionId":"history"})),
        Err(serde_json::json!("historyCorrupt"))
    );
    assert_eq!(
        invoke(
            &fixture.0,
            serde_json::json!({"sessionId":"history","beforeLine":0})
        ),
        Err(serde_json::json!("historyInvalidOptions"))
    );
}
