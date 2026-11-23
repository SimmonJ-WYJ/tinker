//! 通过窗口使用的宿主命令验证项目归属、只读投影和重新打开后的任务状态。
#![cfg(all(target_os = "macos", feature = "formal-preview"))]
use serde_json::{json, Value};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tinker_rust_foundation::{
    desktop_runtime::DesktopError,
    formal_host::FormalHost,
    formal_platform::{HostEnvironment, TrustedRoot},
};

fn call(host: &FormalHost, request: Value) -> Result<Value, DesktopError> {
    host.command("main", request)?.wait(Duration::from_secs(12))
}
fn invoke(host: &FormalHost, generation: &str, channel: &str, args: Value) -> Value {
    call(
        host,
        json!({"command":"invoke","generation":generation,"channel":channel,"args":args}),
    )
    .unwrap()["value"]
        .clone()
}
fn statuses(host: &FormalHost, generation: &str, project: &Value) -> Result<Value, DesktopError> {
    call(
        host,
        json!({"command":"projectTaskStatuses","generation":generation,"workspaceId":project}),
    )
}
fn start(host: &FormalHost) -> String {
    let b = call(host, json!({"command":"bootstrap"})).unwrap();
    assert_eq!(b["nativeTaskLifecycle"], true);
    let g = b["generation"].as_str().unwrap();
    call(
        host,
        json!({"command":"attach","generation":g,"observed":{}}),
    )
    .unwrap();
    g.to_owned()
}

#[test]
fn latest_text_task_per_project_survives_reopen_without_submitting() {
    let root =
        TrustedRoot::create_temporary(std::env::temp_dir().canonicalize().unwrap().join(format!(
            "tinker-tauri-formal-preview-test-project-tasks-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        )))
        .unwrap();
    let open =
        || FormalHost::open(&root, HostEnvironment::new("darwin", false, false).unwrap()).unwrap();
    let mut host = open();
    let g = start(&host);
    let a = json!("local-mock-workspace-id");
    let b = invoke(
        &host,
        &g,
        "agent:create-workspace",
        json!(["Second project"]),
    )["id"]
        .clone();
    let session = |project: &Value| {
        invoke(
            &host,
            &g,
            "agent:create-session",
            json!(["Synthetic", "local-mock", project]),
        )["id"]
            .clone()
    };
    let sa = session(&a);
    let sb = session(&b);
    let image_only = session(&a);
    let send = |sid: &Value, project: &Value, rid: &str, image: bool| {
        let mut params = json!({"sessionId":sid,"workspaceId":project,"requestId":rid,"channelId":"local-mock","modelId":"local-mock-a","userMessage":"synthetic question","startedAt":1});
        if image {
            params["nativeImageAction"] = json!("generate");
        }
        invoke(&host, &g, "agent:send-message", json!([params]));
    };
    send(&sa, &a, "older", false);
    send(&sb, &b, "second", false);
    send(&sa, &a, "latest", false);
    send(&image_only, &a, "image", true);
    let first = json!({"value":[{"sessionId":sa,"requestId":"latest","status":"completed"}]});
    let second = json!({"value":[{"sessionId":sb,"requestId":"second","status":"completed"}]});
    assert_eq!(statuses(&host, &g, &a).unwrap(), first);
    assert_eq!(statuses(&host, &g, &b).unwrap(), second);
    assert_eq!(
        statuses(&host, "obsolete", &a).unwrap_err().0,
        "staleGeneration"
    );
    assert_eq!(
        statuses(&host, &g, &json!("missing")).unwrap_err().0,
        "workspaceNotFound"
    );
    assert_eq!(host.mock_records().len(), 4);
    host.shutdown().unwrap();
    drop(host);
    let host = open();
    let g = start(&host);
    assert_eq!(statuses(&host, &g, &b).unwrap(), second);
    assert_eq!(statuses(&host, &g, &a).unwrap(), first);
    invoke(&host, &g, "agent:toggle-archive", json!([sa]));
    assert_eq!(statuses(&host, &g, &a).unwrap(), json!({"value":[]}));
    invoke(&host, &g, "agent:delete-session", json!([sb]));
    assert_eq!(statuses(&host, &g, &b).unwrap(), json!({"value":[]}));
    assert!(host.mock_records().is_empty());
    drop(host);
    std::fs::remove_dir_all(root.path()).unwrap();
}
