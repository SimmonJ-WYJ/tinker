//! 实际 Tauri handler 绑定与正式 preload ABI，合成根和 owned mock。
use serde_json::{json, Value};
use tauri::{
    ipc::{CallbackFn, InvokeBody},
    test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY},
    webview::InvokeRequest,
};
use tinker_rust_foundation::{
    formal_commands::{self, FormalState},
    formal_host::FormalHost,
    formal_platform::{HostEnvironment, TrustedRoot},
};
#[test]
fn formal_handler_guards_window_generation_and_uses_original_path_abi() {
    let path = std::env::temp_dir().canonicalize().unwrap().join(format!(
        "tinker-tauri-formal-preview-invoke-{}",
        std::process::id()
    ));
    let root = TrustedRoot::create_temporary(&path).unwrap();
    let host =
        FormalHost::open(&root, HostEnvironment::new("darwin", false, false).unwrap()).unwrap();
    let state = FormalState::new(host);
    let (pending, sequence) = state
        .environment(HostEnvironment::new("darwin", true, false).unwrap())
        .unwrap();
    pending.wait(std::time::Duration::from_secs(2)).unwrap();
    let app = mock_builder()
        .manage(state.clone())
        .invoke_handler(tauri::generate_handler![
            formal_commands::formal_request,
            formal_commands::formal_window
        ])
        .build(mock_context(noop_assets()))
        .unwrap();
    let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    let invoke = |request: Value| {
        get_ipc_response(
            &window,
            InvokeRequest {
                cmd: "formal_request".into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: "http://tauri.localhost".parse().unwrap(),
                body: InvokeBody::Json(json!({"request":request})),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.into(),
            },
        )
        .map(|body| body.deserialize::<Value>().unwrap())
    };
    let boot = invoke(json!({"command":"bootstrap"})).unwrap();
    assert_eq!(boot["environmentSequence"], sequence);
    assert_eq!(boot["platformSnapshot"]["theme"]["isDark"], true);
    let generation = boot["generation"].as_str().unwrap();
    let session = invoke(json!({"command":"invoke","generation":generation,"channel":"agent:create-session","args":["原 ABI","local-mock","local-mock-workspace-id"]})).unwrap();
    let id = session["value"]["id"].as_str().unwrap();
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../electron/src/tauri-formal/preload-abi.fixture.json"
    ))
    .unwrap();
    assert_eq!(id, fixture["path"]["args"][1]);
    let location = invoke(json!({"command":"invoke","generation":generation,"channel":fixture["path"]["channel"],"args":fixture["path"]["args"]})).unwrap();
    assert!(location["value"].as_str().unwrap().ends_with(id));
    assert_eq!(invoke(json!({"command":"invoke","generation":generation,"channel":"agent:get-session-path","args":["invalid-workspace",id]})).unwrap_err()["code"], "workspaceNotFound");
    assert_eq!(
        invoke(json!({"command":"attach","generation":"old","observed":{}})).unwrap_err()["code"],
        "staleGeneration"
    );
    let ticket = invoke(json!({"command":"beginClose","generation":generation})).unwrap();
    assert_eq!(invoke(json!({"command":"invoke","generation":generation,"channel":"agent:update-title","args":[id,"too late"]})).unwrap_err()["code"], "closing");
    invoke(
        json!({"command":"abortClose","generation":generation,"closeToken":ticket["closeToken"]}),
    )
    .unwrap();
    let other = tauri::WebviewWindowBuilder::new(&app, "other", Default::default())
        .build()
        .unwrap();
    assert!(get_ipc_response(
        &other,
        InvokeRequest {
            cmd: "formal_request".into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "http://tauri.localhost".parse().unwrap(),
            body: InvokeBody::Json(json!({"request":{"command":"bootstrap"}})),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.into()
        }
    )
    .is_err());
    assert_eq!(invoke(json!({"command":"closeWindow","generation":generation,"closeToken":"unknown","committedRevision":0})).unwrap_err()["code"], "invalidCloseToken");
    let ticket = invoke(json!({"command":"beginClose","generation":generation})).unwrap();
    let rejected = json!({"command":"closeReady","generation":generation,"closeToken":ticket["closeToken"],"committedRevision":123});
    assert_eq!(invoke(rejected).unwrap_err()["code"], "revisionConflict");
    assert!(state.host.lock().unwrap().is_some());
    invoke(
        json!({"command":"abortClose","generation":generation,"closeToken":ticket["closeToken"]}),
    )
    .unwrap();
    let ticket = invoke(json!({"command":"beginClose","generation":generation})).unwrap();
    let close = json!({"command":"closeReady","generation":generation,"closeToken":ticket["closeToken"],"committedRevision":boot["platformSnapshot"]["revision"]});
    let result = invoke(close.clone()).unwrap();
    assert_eq!(result["closed"], true);
    // closeReady 回包丢失/迟到不会关窗；同 token 查询不重复 drain。
    assert!(!state
        .approved_close
        .load(std::sync::atomic::Ordering::SeqCst));
    assert!(state.host.lock().unwrap().is_none());
    assert_eq!(invoke(close).unwrap(), result);
    assert_eq!(invoke(json!({"command":"closeWindow","generation":"old","closeToken":ticket["closeToken"],"committedRevision":0})).unwrap_err()["code"], "staleGeneration");
    assert_eq!(invoke(json!({"command":"closeWindow","generation":generation,"closeToken":"wrong","committedRevision":0})).unwrap_err()["code"], "invalidCloseToken");
    assert!(!state
        .approved_close
        .load(std::sync::atomic::Ordering::SeqCst));
    drop(other);
    drop(window);
    drop(app);
    std::fs::remove_dir_all(path).unwrap();
}

#[test]
fn origin_is_only_the_bundled_local_document() {
    for url in ["tauri://localhost", "http://tauri.localhost/index.html"] {
        assert!(formal_commands::local_origin(&url.parse().unwrap()));
    }
    for url in [
        "https://example.com",
        "http://localhost:5177",
        "tauri://localhost.evil",
        "tauri://user@localhost",
        "tauri://localhost:123",
    ] {
        assert!(
            !formal_commands::local_origin(&url.parse().unwrap()),
            "{url}"
        );
    }
}
