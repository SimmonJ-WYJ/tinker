//! 走正式窗口同一组宿主命令。图片必须来自该宿主自建的 HTTP 模拟器。
use serde_json::{json, Value};
use std::time::Duration;
use tinker_rust_foundation::{
    formal_host::FormalHost,
    formal_platform::{HostEnvironment, TrustedRoot},
};
fn call(host: &FormalHost, v: Value) -> std::result::Result<Value, String> {
    host.command("main", v)
        .and_then(|r| r.wait(Duration::from_secs(12)))
        .map_err(|e| e.0.to_owned())
}
fn boot(host: &FormalHost) -> String {
    let b = call(host, json!({"command":"bootstrap"})).unwrap();
    assert_eq!(b["nativeImages"], true);
    let g = b["generation"].as_str().unwrap();
    call(
        host,
        json!({"command":"attach","generation":g,"observed":{}}),
    )
    .unwrap();
    g.to_owned()
}
fn invoke(host: &FormalHost, g: &str, c: &str, args: Value) -> std::result::Result<Value, String> {
    call(
        host,
        json!({"command":"invoke","generation":g,"channel":c,"args":args}),
    )
    .map(|v| v["value"].clone())
}
fn snap(host: &FormalHost, g: &str, sid: &str) -> Value {
    let b = call(
        host,
        json!({"command":"restore","generation":g,"sessionId":sid,"observedDeliverySequence":0}),
    )
    .unwrap();
    call(
        host,
        json!({"command":"resume","generation":g,"restoreToken":b["restoreToken"]}),
    )
    .unwrap();
    b
}
fn versions(b: &Value) -> Vec<Value> {
    b["sdkMessages"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|m| {
            let blk = &m["message"]["content"][0];
            (blk["type"] == "tool_result" && blk["is_error"] != true)
                .then(|| serde_json::from_str(blk["content"].as_str().unwrap()).unwrap())
        })
        .collect()
}
#[test]
fn generate_edit_read_and_restart_on_owned_http() {
    let path = std::fs::canonicalize(std::env::temp_dir())
        .unwrap()
        .join(format!(
            "tinker-tauri-formal-preview-test-images-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
    let root = TrustedRoot::create_temporary(path).unwrap();
    let open =
        || FormalHost::open(&root, HostEnvironment::new("darwin", false, false).unwrap()).unwrap();
    let mut host = open();
    let g = boot(&host);
    let s = invoke(
        &host,
        &g,
        "agent:get-or-create-draft-session",
        json!(["local-mock", "local-mock-workspace-id"]),
    )
    .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let send = |id: &str, prompt: &str, action: &str, reference: Option<&str>, time: u64| {
        let mut args = json!({"sessionId":s,"requestId":id,"channelId":"local-mock","modelId":"local-mock-a","userMessage":prompt,"nativeImageAction":action,"taskMode":"search","startedAt":time});
        if let Some(r) = reference {
            args["imageEditReferenceId"] = json!(r);
        }
        args
    };
    let gen = send("first", "Generate an image of a fox", "generate", None, 1);
    invoke(&host, &g, "agent:send-message", json!([gen])).unwrap();
    invoke(&host, &g, "agent:send-message", json!([gen])).unwrap();
    let b = snap(&host, &g, &s);
    let first = versions(&b).remove(0);
    assert_eq!(host.mock_records().len(), 1);
    let base = first["imageId"].as_str().unwrap();
    let original = invoke(
        &host,
        &g,
        "chat:read-attachment",
        json!([first["generatedImage"]["localPath"]]),
    )
    .unwrap();
    assert!(original.as_str().unwrap().starts_with("iVBOR"));
    let edit = send("second", "Make the fox blue", "edit", Some(base), 2);
    invoke(&host, &g, "agent:send-message", json!([edit])).unwrap();
    assert_eq!(host.mock_records().len(), 2);
    let b = snap(&host, &g, &s);
    assert_eq!(versions(&b)[1]["baseImageId"], base);
    assert!(b["sdkMessages"]
        .as_array()
        .unwrap()
        .iter()
        .any(|m| m["imageEditReference"]["imageId"] == base));
    let directory = invoke(
        &host,
        &g,
        "agent:get-session-path",
        json!(["local-mock-workspace-id", s]),
    )
    .unwrap();
    let list = invoke(&host, &g, "agent:list-directory", json!([directory, {}])).unwrap();
    assert_eq!(list["entries"].as_array().unwrap().len(), 2);
    let path = list["entries"][0]["path"].as_str().unwrap();
    assert!(
        invoke(&host, &g, "agent:preview-read-binary", json!([path]))
            .unwrap()
            .as_str()
            .unwrap()
            .starts_with("iVBOR")
    );
    assert!(invoke(
        &host,
        &g,
        "agent:preview-read-binary",
        json!([format!("{path}/../unknown.png")])
    )
    .is_err());
    let next = invoke(
        &host,
        &g,
        "agent:get-or-create-draft-session",
        json!(["local-mock", "local-mock-workspace-id"]),
    )
    .unwrap();
    assert_ne!(next["id"], s);
    host.shutdown().unwrap();
    drop(host);
    let host = open();
    let g = boot(&host);
    assert_eq!(versions(&snap(&host, &g, &s)), versions(&b));
    assert_eq!(
        invoke(
            &host,
            &g,
            "chat:read-attachment",
            json!([first["generatedImage"]["localPath"]])
        )
        .unwrap(),
        original
    );
    assert!(host.mock_records().is_empty());
    let bad = send("third", "Edit the fox [image-error]", "edit", Some(base), 3);
    assert!(invoke(&host, &g, "agent:send-message", json!([bad])).is_err());
    assert_eq!(host.mock_records().len(), 1);
    assert_eq!(versions(&snap(&host, &g, &s)), versions(&b));
    assert_eq!(
        invoke(
            &host,
            &g,
            "chat:read-attachment",
            json!([first["generatedImage"]["localPath"]])
        )
        .unwrap(),
        original
    );
    drop(host);
    std::fs::remove_dir_all(root.path()).unwrap();
}
#[test]
fn aborted_close_preserves_run_and_confirmed_close_joins_image_worker() {
    use std::time::{Instant, SystemTime, UNIX_EPOCH};
    let path = std::fs::canonicalize(std::env::temp_dir())
        .unwrap()
        .join(format!(
            "tinker-tauri-formal-preview-test-images-close-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
    let root = TrustedRoot::create_temporary(path).unwrap();
    let open =
        || FormalHost::open(&root, HostEnvironment::new("darwin", false, false).unwrap()).unwrap();
    let h = open();
    let g = boot(&h);
    let sid = invoke(
        &h,
        &g,
        "agent:create-session",
        json!(["close image", "local-mock"]),
    )
    .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let send = |id: &str| {
        h.command("main",json!({"command":"invoke","generation":g,"channel":"agent:send-message","args":[{"sessionId":sid,"channelId":"local-mock","modelId":"local-mock-a","requestId":id,"startedAt":12,"nativeImageAction":"generate","userMessage":"generate an image [image-slow]"}]})).unwrap()
    };
    let received = |n| {
        let end = Instant::now() + Duration::from_secs(5);
        while h.mock_records().len() < n {
            assert!(Instant::now() < end, "mock did not receive image request");
            std::thread::sleep(Duration::from_millis(5));
        }
    };
    let pending = send("keep");
    received(1);
    let c = call(&h, json!({"command":"beginClose","generation":g})).unwrap();
    call(
        &h,
        json!({"command":"abortClose","generation":g,"closeToken":c["closeToken"]}),
    )
    .unwrap();
    let reply = pending.wait(Duration::from_secs(5)).unwrap();
    assert!(reply["imageId"].as_str().is_some());
    assert_eq!(versions(&snap(&h, &g, &sid)).len(), 1);
    let pending = send("stop");
    received(2);
    invoke(&h, &g, "agent:stop", json!([sid])).unwrap();
    pending.wait(Duration::from_secs(5)).unwrap();
    assert_eq!(versions(&snap(&h, &g, &sid)).len(), 1);
    let pending = send("closing");
    received(3);
    let c = call(&h, json!({"command":"beginClose","generation":g})).unwrap();
    call(&h,json!({"command":"closeReady","generation":g,"closeToken":c["closeToken"],"committedRevision":c["baselineRevision"]})).unwrap();
    assert!(pending.wait(Duration::from_secs(2)).is_err());
    drop(h);
    let h = open();
    let g = boot(&h);
    assert_eq!(versions(&snap(&h, &g, &sid)).len(), 1);
    assert!(h.mock_records().is_empty());
    drop(h);
    std::fs::remove_dir_all(root.path()).unwrap();
}
