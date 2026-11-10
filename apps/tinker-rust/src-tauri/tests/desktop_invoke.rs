use serde_json::{json, Value};
use tauri::{
    ipc::{CallbackFn, InvokeBody},
    test::{get_ipc_response, mock_builder, mock_context, noop_assets, INVOKE_KEY},
    webview::InvokeRequest,
};
use tinker_rust_foundation::{
    desktop_commands::{self, DesktopHostState},
    desktop_runtime::{DesktopRuntime, TrustedProfile},
};
#[test]
fn real_tauri_mock_invoke_uses_same_service_and_decoder() {
    let root = std::env::temp_dir()
        .canonicalize()
        .unwrap()
        .join(format!("desktop-invoke-{}", std::process::id()));
    std::fs::create_dir(&root).unwrap();
    let profiles:Vec<TrustedProfile>=serde_json::from_value(json!([{"profileId":"local","label":"Synthetic","configRevision":"r1","models":[{"modelId":"model","label":"Model"}],"endpoint":"http://127.0.0.1:1/v1/chat/completions","key":"fake-secret"}])).unwrap();
    let runtime = DesktopRuntime::open(&root, profiles).unwrap();
    let request = json!({"version":1,"id":"same","method":"sessions.create","params":{"title":"合成","profileId":"local","workspaceId":null,"reuseDraft":true}});
    let direct = serde_json::to_value(runtime.dispatch(request.clone()).unwrap()).unwrap();
    let app = mock_builder()
        .manage(DesktopHostState(Some(runtime)))
        .invoke_handler(tauri::generate_handler![
            desktop_commands::desktop_runtime_request
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
                cmd: "desktop_runtime_request".into(),
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
    assert_eq!(invoke(request).unwrap(), direct);
    assert_eq!(
        invoke(
            json!({"version":1,"id":"invalid","method":"chat.send","params":{"endpoint":"secret"}})
        )
        .unwrap()["error"]["code"],
        "invalidParams"
    );
    assert_eq!(
        invoke(json!({"version":1,"id":"../bad","method":"runtime.describe","params":{}})),
        Err(json!("invalidId"))
    );
    drop(window);
    drop(app);
    std::fs::remove_dir_all(root).unwrap();
}
