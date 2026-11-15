use serde_json::json;
use tinker_rust_foundation::formal_agent::projection;
#[test]
fn permission_wait_is_active_and_tool_snapshot_is_typed() {
    let turn = json!({"status":"waitingInput","requestId":"r","sessionId":"s","startedAt":1,"toolState":{"transcript":{"messages":[]},"partialText":"checking","pending":null}});
    assert!(projection::active(&turn));
    assert_eq!(
        projection::snapshot(&turn)["payload"]["event"]["type"],
        "tool_run_snapshot"
    );
}

#[test]
fn actual_actor_reload_pending_historical_reply_close_gate_and_full_history() {
    use std::time::{Duration, Instant};
    use tinker_rust_foundation::{
        formal_host::FormalHost,
        formal_platform::{HostEnvironment, TrustedRoot},
    };
    let path = std::env::temp_dir().canonicalize().unwrap().join(format!(
        "tinker-tauri-tools-preview-actor-{}",
        std::process::id()
    ));
    let root = TrustedRoot::create_tools_temporary(&path).unwrap();
    let mut h =
        FormalHost::open_tools(&root, HostEnvironment::new("darwin", false, false).unwrap())
            .unwrap();
    let command = |v| h.command("main", v).unwrap().wait(Duration::from_secs(3));
    let g = command(json!({"command":"bootstrap"})).unwrap()["generation"]
        .as_str()
        .unwrap()
        .to_owned();
    command(json!({"command":"attach","generation":g,"observed":{}})).unwrap();
    let s=command(json!({"command":"invoke","generation":g,"channel":"agent:create-session","args":["tools","local-tools-mock"]})).unwrap()["value"]["id"].as_str().unwrap().to_owned();
    let send=h.command("main",json!({"command":"invoke","generation":g,"channel":"agent:send-message","args":[{"sessionId":s,"requestId":"actor-run","startedAt":1,"channelId":"local-tools-mock","modelId":"local-tools-mock","userMessage":"inspect"}]})).unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let p=command(json!({"command":"invoke","generation":g,"channel":"agent:get-pending-requests","args":[s]})).unwrap();
        if p["value"]["permissions"].as_array().unwrap().len() == 1 {
            break;
        }
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(5));
    }
    assert!(send.try_result().is_none());
    let boot = command(json!({"command":"bootstrap"})).unwrap();
    let g2 = boot["generation"].as_str().unwrap();
    assert_eq!(
        boot["activeRuns"][0]["currentSnapshot"]["payload"]["event"]["type"],
        "tool_run_snapshot"
    );
    let response = |generation: &str, pid: &str| json!({"command":"invoke","generation":generation,"channel":"agent:permission:respond","args":[{"requestId":pid,"behavior":"allow","alwaysAllow":false}]});
    assert_eq!(
        command(response(&g, "p-actor-run-0")).unwrap_err().0,
        "staleGeneration"
    );
    command(json!({"command":"attach","generation":g2,"observed":{}})).unwrap();
    let pending_restore = command(
        json!({"command":"restore","generation":g2,"sessionId":s,"observedDeliverySequence":0}),
    )
    .unwrap();
    let restored_user = &pending_restore["sdkMessages"][0];
    let snapshot_user =
        &pending_restore["activeSnapshot"]["currentSnapshot"]["payload"]["event"]["sdkMessages"][0];
    assert_eq!(restored_user, snapshot_user);
    assert_eq!(restored_user["_desktopRunId"], "actor-run");
    command(
        json!({"command":"resume","generation":g2,"restoreToken":pending_restore["restoreToken"]}),
    )
    .unwrap();
    let close = command(json!({"command":"beginClose","generation":g2})).unwrap();
    assert_eq!(
        command(response(g2, "p-actor-run-0")).unwrap_err().0,
        "closing"
    );
    command(json!({"command":"abortClose","generation":g2,"closeToken":close["closeToken"]}))
        .unwrap();
    command(response(g2, "p-actor-run-0")).unwrap();
    loop {
        let p=command(json!({"command":"invoke","generation":g2,"channel":"agent:get-pending-requests","args":[s]})).unwrap();
        if p["value"]["permissions"][0]["requestId"] == "p-actor-run-1" {
            break;
        }
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(5));
    }
    command(response(g2, "p-actor-run-1")).unwrap();
    send.wait(Duration::from_secs(3)).unwrap();
    command(response(g2, "p-actor-run-0")).unwrap();
    let restore = command(
        json!({"command":"restore","generation":g2,"sessionId":s,"observedDeliverySequence":0}),
    )
    .unwrap();
    assert_eq!(restore["sdkMessages"].as_array().unwrap().len(), 6);
    assert!(restore["activeSnapshot"].is_null());
    assert_eq!(
        restore["sdkMessages"][1]["message"]["content"][1]["id"],
        "actor-run-tool-0"
    );
    assert_eq!(
        restore["sdkMessages"][2]["message"]["content"][0]["tool_use_id"],
        "actor-run-tool-0"
    );
    assert_ne!(
        restore["sdkMessages"][1]["message"]["content"][1]["id"],
        "list_1"
    );
    let mut assistants = 0;
    let mut live_users = 0;
    while let Some(event) = h.next_event(Duration::from_millis(20)) {
        let message = &event.payload["payload"]["message"];
        if message["uuid"] == "actor-run-user" {
            assert_eq!(message, restored_user);
            live_users += 1;
        }
        if event.payload["payload"]["kind"] == "sdk_message"
            && event.payload["payload"]["message"]["type"] == "assistant"
        {
            assistants += 1;
        }
    }
    assert!(live_users > 0);
    assert!(
        assistants > 0,
        "normal delivery must use original SDK message events as well as recovery snapshots"
    );
    assert_eq!(h.mock_records().len(), 3);
    h.shutdown().unwrap();
    drop(h);
    std::fs::remove_dir_all(path).unwrap();
}

#[test]
fn tools_entry_rejects_m2_root_without_creating_files() {
    use tinker_rust_foundation::{
        formal_host::FormalHost,
        formal_platform::{HostEnvironment, TrustedRoot},
    };
    let path = std::env::temp_dir().canonicalize().unwrap().join(format!(
        "tinker-tauri-formal-preview-wrong-tools-{}",
        std::process::id()
    ));
    let root = TrustedRoot::create_temporary(&path).unwrap();
    let before = std::fs::read_dir(&path).unwrap().count();
    assert!(
        FormalHost::open_tools(&root, HostEnvironment::new("darwin", false, false).unwrap())
            .is_err()
    );
    assert_eq!(std::fs::read_dir(&path).unwrap().count(), before);
    std::fs::remove_dir_all(path).unwrap();
}

#[test]
fn full_outbox_recovers_all_tools_after_unobserved_permissions_resolve() {
    use std::time::{Duration, Instant};
    use tinker_rust_foundation::{
        formal_host::FormalHost,
        formal_platform::{HostEnvironment, TrustedRoot},
    };
    let path = std::env::temp_dir().canonicalize().unwrap().join(format!(
        "tinker-tauri-tools-preview-backlog-{}",
        std::process::id()
    ));
    let root = TrustedRoot::create_tools_temporary(&path).unwrap();
    let mut h =
        FormalHost::open_tools(&root, HostEnvironment::new("darwin", false, false).unwrap())
            .unwrap();
    let command = |v| {
        h.command("main", v)
            .unwrap()
            .wait(Duration::from_secs(3))
            .unwrap()
    };
    let g = command(json!({"command":"bootstrap"}))["generation"]
        .as_str()
        .unwrap()
        .to_owned();
    command(json!({"command":"attach","generation":g,"observed":{}}));
    let s=command(json!({"command":"invoke","generation":g,"channel":"agent:create-session","args":["backlog","local-tools-mock"]}))["value"]["id"].as_str().unwrap().to_owned();
    let send=h.command("main",json!({"command":"invoke","generation":g,"channel":"agent:send-message","args":[{"sessionId":s,"requestId":"backlog","startedAt":1,"channelId":"local-tools-mock","modelId":"local-tools-mock","userMessage":"[backlog] inspect"}]})).unwrap();
    let deadline = Instant::now() + Duration::from_secs(15);
    for round in 0..2 {
        loop {
            let pending = command(
                json!({"command":"invoke","generation":g,"channel":"agent:get-pending-requests","args":[s]}),
            );
            if pending["value"]["permissions"][0]["requestId"] == format!("p-backlog-{round}") {
                break;
            }
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(5));
        }
        command(
            json!({"command":"invoke","generation":g,"channel":"agent:permission:respond","args":[{"requestId":format!("p-backlog-{round}"),"behavior":"allow","alwaysAllow":false}]}),
        );
    }
    send.wait(Duration::from_secs(3)).unwrap();
    let mut delivered = 0;
    let mut final_snapshot = None;
    let mut complete = false;
    while !complete {
        let event = h
            .next_event(Duration::from_secs(2))
            .expect("terminal delivery after draining");
        delivered += 1;
        if event.payload["payload"]["event"]["type"] == "tool_run_snapshot" {
            final_snapshot = Some(event.payload["payload"]["event"].clone());
        }
        complete = event.channel == "agent:stream:complete";
    }
    assert!(
        delivered > 256,
        "fixture must actually saturate the outbox: {delivered}"
    );
    let snapshot = final_snapshot.unwrap();
    assert_eq!(snapshot["sdkMessages"].as_array().unwrap().len(), 6);
    assert_eq!(snapshot["pendingPermissions"], json!([]));
    assert_eq!(snapshot["activeText"], "");
    assert_eq!(h.mock_records().len(), 3);
    h.shutdown().unwrap();
    drop(h);
    std::fs::remove_dir_all(path).unwrap();
}

#[test]
fn delete_pending_under_backpressure_still_delivers_permission_cleanup() {
    use std::time::{Duration, Instant};
    use tinker_rust_foundation::{
        formal_host::FormalHost,
        formal_platform::{HostEnvironment, TrustedRoot},
    };
    let path = std::env::temp_dir().canonicalize().unwrap().join(format!(
        "tinker-tauri-tools-preview-delete-backlog-{}",
        std::process::id()
    ));
    let root = TrustedRoot::create_tools_temporary(&path).unwrap();
    let mut h =
        FormalHost::open_tools(&root, HostEnvironment::new("darwin", false, false).unwrap())
            .unwrap();
    let command = |v| {
        h.command("main", v)
            .unwrap()
            .wait(Duration::from_secs(3))
            .unwrap()
    };
    let g = command(json!({"command":"bootstrap"}))["generation"]
        .as_str()
        .unwrap()
        .to_owned();
    command(json!({"command":"attach","generation":g,"observed":{}}));
    let s=command(json!({"command":"invoke","generation":g,"channel":"agent:create-session","args":["delete","local-tools-mock"]}))["value"]["id"].as_str().unwrap().to_owned();
    let send=h.command("main",json!({"command":"invoke","generation":g,"channel":"agent:send-message","args":[{"sessionId":s,"requestId":"delete-run","startedAt":1,"channelId":"local-tools-mock","modelId":"local-tools-mock","userMessage":"[backlog] inspect"}]})).unwrap();
    let deadline = Instant::now() + Duration::from_secs(12);
    loop {
        let pending = command(
            json!({"command":"invoke","generation":g,"channel":"agent:get-pending-requests","args":[s]}),
        );
        if pending["value"]["permissions"].as_array().unwrap().len() == 1 {
            break;
        }
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(5));
    }
    command(json!({"command":"invoke","generation":g,"channel":"agent:delete-session","args":[s]}));
    send.wait(Duration::from_secs(3)).unwrap();
    let mut complete = false;
    let mut final_snapshot = None;
    while let Some(event) = h.next_event(Duration::from_millis(200)) {
        if event.payload["payload"]["event"]["type"] == "tool_run_snapshot" {
            final_snapshot = Some(event.payload["payload"]["event"].clone());
        }
        if event.channel == "agent:stream:complete" {
            complete = true;
            break;
        }
    }
    assert!(
        complete,
        "deleted runs must retain the bounded terminal delivery plan"
    );
    assert_eq!(final_snapshot.unwrap()["pendingPermissions"], json!([]));
    assert_eq!(h.mock_records().len(), 1);
    h.shutdown().unwrap();
    drop(h);
    std::fs::remove_dir_all(path).unwrap();
}

#[test]
fn permission_projection_never_exposes_absolute_model_paths() {
    let turn = json!({"runId":"r","requestId":"r","sessionId":"s","status":"waitingInput","toolState":{"partialText":"","transcript":{"messages":[]},"pending":{"permissionId":"p-r-0","call":{"name":"workspace_read","arguments":{"path":"/private/secret"}}}}});
    let event = projection::snapshot(&turn);
    assert!(!event.to_string().contains("/private/secret"));
    assert_eq!(
        event["payload"]["event"]["pendingPermissions"][0]["toolPreview"]["kind"],
        "file"
    );
}

#[test]
fn terminal_tool_failure_is_visible_in_restored_sdk_history() {
    let turn = json!({"runId":"failed","requestId":"failed","sessionId":"s","userMessageId":"failed-user","userMessage":"inspect","modelId":"local-tools-mock","status":"failed","errorCode":"providerFailed","toolState":{"partialText":"partial","transcript":{"messages":[{"kind":"user","text":"inspect"}]},"pending":null}});
    let history = projection::history(&[turn]);
    let assistant = &history["sdkMessages"][1];
    assert_eq!(assistant["_desktopRuntimeStatus"], "failed");
    assert_eq!(assistant["error"]["message"], "responseFailed");
    assert_eq!(assistant["message"]["content"][0]["text"], "partial");
}
