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
    let duplicate = send("keep");
    received(1);
    let c = call(&h, json!({"command":"beginClose","generation":g})).unwrap();
    call(
        &h,
        json!({"command":"abortClose","generation":g,"closeToken":c["closeToken"]}),
    )
    .unwrap();
    let reply = pending.wait(Duration::from_secs(5)).unwrap();
    assert!(reply["imageId"].as_str().is_some());
    assert_eq!(duplicate.wait(Duration::from_secs(5)).unwrap(), reply);
    assert_eq!(h.mock_records().len(), 1);
    assert_eq!(versions(&snap(&h, &g, &sid)).len(), 1);
    let pending = send("stop");
    received(2);
    invoke(&h, &g, "agent:stop", json!([sid, "keep"])).unwrap();
    let running = snap(&h, &g, &sid);
    assert_eq!(running["activeSnapshot"]["requestId"], "stop");
    let image = running["sdkMessages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["type"] == "assistant" && m["_desktopImageTaskRequestId"] == "stop")
        .expect("运行中的图片工具消息应立即可恢复");
    assert_eq!(image["_desktopImageTaskStatus"], "running");
    assert_eq!(image["_desktopImageTaskKind"], "generate");
    invoke(&h, &g, "agent:stop", json!([sid, "stop"])).unwrap();
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
    let restored = snap(&h, &g, &sid);
    assert_eq!(versions(&restored).len(), 1);
    for (id, status) in [
        ("keep", "completed"),
        ("stop", "cancelled"),
        ("closing", "interrupted"),
    ] {
        let records: Vec<_> = restored["sdkMessages"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|m| m["_agentRequestId"] == id)
            .collect();
        assert_eq!(records.len(), 3);
        assert_eq!(records[1]["_desktopImageTaskStatus"], status);
        assert_eq!(
            records[1]["uuid"],
            format!("native-image-{sid}-{id}-assistant")
        );
    }
    assert!(h.mock_records().is_empty());
    drop(h);
    std::fs::remove_dir_all(root.path()).unwrap();
}

#[cfg(all(target_os = "macos", feature = "formal-preview"))]
#[test]
fn retry_restores_an_edits_exact_source_and_respects_cross_kind_admission_order() {
    use std::time::{SystemTime, UNIX_EPOCH};
    let path = std::env::temp_dir().canonicalize().unwrap().join(format!(
        "tinker-tauri-formal-preview-test-image-retry-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let root = TrustedRoot::create_temporary(path).unwrap();
    let open =
        || FormalHost::open(&root, HostEnvironment::new("darwin", false, false).unwrap()).unwrap();
    let mut host = open();
    let g = boot(&host);
    let sid = invoke(
        &host,
        &g,
        "agent:create-session",
        json!(["Image tasks", "local-mock"]),
    )
    .unwrap()["id"]
        .clone();
    let submit =
        |h: &FormalHost, g: &str, input: Value| invoke(h, g, "agent:send-message", json!([input]));
    let normal = |id: &str, time: u64, prompt: &str| json!({"sessionId":sid,"requestId":id,"startedAt":time,"channelId":"local-mock","modelId":"local-mock-a","userMessage":prompt});
    let retry = |source: &str, new: &str| json!({"sessionId":sid,"requestId":new,"startedAt":9,"retryOfRequestId":source});
    let mut generate = normal("base", 30, "Synthetic lake");
    generate["nativeImageAction"] = json!("generate");
    submit(&host, &g, generate).unwrap();
    let base = versions(&snap(&host, &g, sid.as_str().unwrap()))[0]["imageId"].clone();
    assert!(submit(&host, &g, normal("original-text", 99, "[error] Synthetic")).is_err());
    let mut edit = normal("failed-edit", 5, "Retain the lake [image-error]");
    edit["nativeImageAction"] = json!("edit");
    edit["imageEditReferenceId"] = base.clone();
    assert!(submit(&host, &g, edit).is_err());
    assert_eq!(
        submit(&host, &g, retry("original-text", "stale-text")).unwrap_err(),
        "requestConflict"
    );
    assert_eq!(host.mock_records().len(), 3);
    host.shutdown().unwrap();
    drop(host);
    let host = open();
    let g = boot(&host);
    let sid_str = sid.as_str().unwrap();
    assert_eq!(versions(&snap(&host, &g, sid_str)).len(), 1);
    assert!(host.mock_records().is_empty());
    let mut forged = retry("failed-edit", "forged");
    forged["imageEditReferenceId"] = json!("other");
    assert!(submit(&host, &g, forged).is_err());
    assert_eq!(
        submit(&host, &g, retry("failed-edit", "retry")).unwrap_err(),
        "responseFailed"
    );
    assert_eq!(
        submit(&host, &g, retry("failed-edit", "retry")).unwrap_err(),
        "responseFailed"
    );
    assert_eq!(
        submit(&host, &g, retry("failed-edit", "second-click")).unwrap_err(),
        "requestConflict"
    );
    let restored = snap(&host, &g, sid_str);
    let sdk = restored["sdkMessages"].as_array().unwrap();
    let retried = sdk
        .iter()
        .find(|m| m["type"] == "assistant" && m["_desktopImageTaskRequestId"] == "retry")
        .unwrap();
    assert_eq!(retried["_desktopImageTaskKind"], "edit");
    assert_eq!(retried["_desktopImageTaskStatus"], "failed");
    assert_eq!(retried["_desktopTaskRetryable"], true);
    assert!(
        sdk.iter()
            .filter(|m| m["type"] == "assistant" && m["_desktopTaskRetryable"] == true)
            .count()
            == 1
    );
    assert_eq!(
        retried["message"]["content"][0]["input"],
        json!({"prompt":"Retain the lake [image-error]","baseImageId":base})
    );
    assert_eq!(host.mock_records().len(), 1);
    assert_eq!(host.mock_records()[0].scenario, "image-edit-failed");
    assert!(submit(&host, &g, normal("later-text", 1, "[error] Synthetic")).is_err());
    assert_eq!(
        submit(&host, &g, retry("retry", "stale-image")).unwrap_err(),
        "requestConflict"
    );
    assert_eq!(
        submit(&host, &g, retry("later-text", "retry-text")).unwrap_err(),
        "responseFailed"
    );
    assert_eq!(
        submit(&host, &g, retry("failed-edit", "retry")).unwrap_err(),
        "responseFailed"
    );
    assert_eq!(host.mock_records().len(), 3);
    drop(host);
    std::fs::remove_dir_all(root.path()).unwrap();
}
