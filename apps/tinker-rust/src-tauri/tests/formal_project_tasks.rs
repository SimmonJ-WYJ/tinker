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
    assert_eq!(b["nativeImageTaskLifecycle"], true);
    let g = b["generation"].as_str().unwrap();
    call(
        host,
        json!({"command":"attach","generation":g,"observed":{}}),
    )
    .unwrap();
    g.to_owned()
}

fn root() -> TrustedRoot {
    TrustedRoot::create_temporary(std::env::temp_dir().canonicalize().unwrap().join(format!(
            "tinker-tauri-formal-preview-test-project-tasks-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        )))
    .unwrap()
}

#[test]
fn latest_image_or_text_task_per_project_survives_reopen_without_submitting() {
    let root = root();
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
    let send = |sid: &Value, project: &Value, rid: &str, started: u64, action: Option<&str>| {
        let mut params = json!({"sessionId":sid,"workspaceId":project,"requestId":rid,"channelId":"local-mock","modelId":"local-mock-a","userMessage":"synthetic question","startedAt":started});
        if let Some(action) = action {
            params["nativeImageAction"] = json!(action);
        }
        invoke(&host, &g, "agent:send-message", json!([params]));
    };
    send(&sa, &a, "older", 1, None);
    send(&sb, &b, "generated", 3, Some("generate"));
    send(&sa, &a, "generated-a", 300, Some("generate"));
    send(&sa, &a, "latest", 3, None);
    send(&sb, &b, "text-b", 4, None);
    // 客户端时钟可倒退；持久接收顺序决定图文混排的最新任务。
    send(&sb, &b, "edited", 1, Some("edit"));
    send(&image_only, &a, "image", 5, Some("generate"));
    let image_row = json!({"sessionId":image_only,"requestId":"image","kind":"imageGenerate","status":"completed"});
    let first = json!({"value":[{"sessionId":sa,"requestId":"latest","kind":"text","status":"completed"}, image_row]});
    let second = json!({"value":[{"sessionId":sb,"requestId":"edited","kind":"imageEdit","status":"completed"}]});
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
    assert_eq!(host.mock_records().len(), 7);
    host.shutdown().unwrap();
    drop(host);
    let host = open();
    let g = start(&host);
    assert_eq!(statuses(&host, &g, &b).unwrap(), second);
    assert_eq!(statuses(&host, &g, &a).unwrap(), first);
    invoke(&host, &g, "agent:toggle-archive", json!([sa]));
    assert_eq!(
        statuses(&host, &g, &a).unwrap(),
        json!({"value":[image_row]})
    );
    invoke(&host, &g, "agent:delete-session", json!([sb]));
    assert_eq!(statuses(&host, &g, &b).unwrap(), json!({"value":[]}));
    assert!(host.mock_records().is_empty());
    drop(host);
    std::fs::remove_dir_all(root.path()).unwrap();
}

#[test]
fn reads_legacy_pending_image_without_replay_and_rejects_corrupt_receipt() {
    use sha2::{Digest, Sha256};
    use std::{
        fs,
        os::unix::fs::{DirBuilderExt, PermissionsExt},
    };
    let root = root();
    let open =
        || FormalHost::open(&root, HostEnvironment::new("darwin", false, false).unwrap()).unwrap();
    let mut host = open();
    let g = start(&host);
    let project = json!("local-mock-workspace-id");
    let session = invoke(
        &host,
        &g,
        "agent:create-session",
        json!(["Old images", "local-mock", project]),
    )["id"]
        .clone();
    let initial = json!({"sessionId":session,"workspaceId":project,"requestId":"text-before-upgrade","channelId":"local-mock","modelId":"local-mock-a","userMessage":"Synthetic","startedAt":3});
    invoke(&host, &g, "agent:send-message", json!([initial]));
    host.shutdown().unwrap();
    drop(host);
    // 固定 v1 格式的旧收据，尚未落盘结果。相同时间沿用旧历史合并顺序。
    let dir = root
        .path()
        .join("formal-images-v1")
        .join(format!("{:x}", Sha256::digest(session.as_str().unwrap())));
    fs::DirBuilder::new().mode(0o700).create(&dir).unwrap();
    let file = dir.join("turns.json");
    let legacy = json!({"version":1,"turns":[{"requestId":"legacy-image","prompt":"Synthetic image","baseImageId":null,"createdAt":3,"status":"pending","asset":null,"error":null}]}).to_string();
    fs::write(&file, &legacy).unwrap();
    fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
    let mut host = open();
    let g = start(&host);
    assert_eq!(
        statuses(&host, &g, &project).unwrap(),
        json!({"value":[{"sessionId":session,"requestId":"legacy-image","kind":"imageGenerate","status":"interrupted"}]})
    );
    assert_eq!(fs::read_to_string(&file).unwrap(), legacy);
    assert!(host.mock_records().is_empty());
    let order_file = dir.join("task-order.json");
    invoke(&host, &g, "agent:send-message", json!([initial]));
    assert!(!order_file.exists());
    assert!(host.mock_records().is_empty());
    // 旧混排缺少跨账本顺序，即便新文字失败也不能用不可信的时钟授权 Retry。
    let failed = json!({"sessionId":session,"workspaceId":project,"requestId":"new-text","channelId":"local-mock","modelId":"local-mock-a","userMessage":"[task-retry] Synthetic","startedAt":2});
    let submit = |host: &FormalHost, generation: &str, input: &Value| {
        call(
            host,
            json!({"command":"invoke","generation":generation,"channel":"agent:send-message","args":[input]}),
        )
    };
    assert_eq!(submit(&host, &g, &failed).unwrap_err().0, "responseFailed");
    let old_image_row = json!({"value":[{"sessionId":session,"requestId":"legacy-image","kind":"imageGenerate","status":"interrupted"}]});
    assert_eq!(statuses(&host, &g, &project).unwrap(), old_image_row);
    let retry = json!({"sessionId":session,"requestId":"retry-new-text","startedAt":1,"retryOfRequestId":"new-text"});
    assert_eq!(submit(&host, &g, &retry).unwrap_err().0, "requestConflict");
    assert_eq!(host.mock_records().len(), 1);
    assert!(!order_file.exists());
    host.shutdown().unwrap();
    drop(host);
    let mut host = open();
    let g = start(&host);
    assert_eq!(statuses(&host, &g, &project).unwrap(), old_image_row);
    assert_eq!(submit(&host, &g, &retry).unwrap_err().0, "requestConflict");
    let retry_image = json!({"sessionId":session,"requestId":"retry-old-image","startedAt":4,"retryOfRequestId":"legacy-image"});
    assert_eq!(
        submit(&host, &g, &retry_image).unwrap_err().0,
        "requestConflict"
    );
    assert!(host.mock_records().is_empty());
    assert!(!order_file.exists());
    assert_eq!(fs::read_to_string(&file).unwrap(), legacy);
    host.shutdown().unwrap();
    drop(host);
    // 有效的 request 字符串也必须属于这一会话。
    fs::write(&order_file, json!({"version":1,"admissions":[{"request":"legacy-image","textHead":"unknown","retryOf":null,"original":1,"derived":0,"inDerived":false}]}).to_string()).unwrap();
    fs::set_permissions(&order_file, fs::Permissions::from_mode(0o600)).unwrap();
    let mut host = open();
    let g = start(&host);
    assert_eq!(
        statuses(&host, &g, &project).unwrap_err().0,
        "corruptImages"
    );
    assert!(host.mock_records().is_empty());
    host.shutdown().unwrap();
    drop(host);
    fs::write(&file, b"{").unwrap();
    let host = open();
    let g = start(&host);
    assert_eq!(
        statuses(&host, &g, &project).unwrap_err().0,
        "corruptImages"
    );
    assert!(host.mock_records().is_empty());
    drop(host);
    fs::remove_dir_all(root.path()).unwrap();
}
