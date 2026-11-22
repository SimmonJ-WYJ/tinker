//! 原生队列通过真实 actor、持久 core 与 owned HTTP mock 验证。
use serde_json::{json, Value};
use std::{
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant},
};
use tinker_rust_foundation::{
    formal_host::FormalHost,
    formal_platform::{HostEnvironment, TrustedRoot},
};
static NEXT: AtomicU64 = AtomicU64::new(0);
fn setup() -> (TrustedRoot, FormalHost) {
    let path = std::env::temp_dir().canonicalize().unwrap().join(format!(
        "tinker-tauri-tools-preview-queue-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let root = TrustedRoot::create_tools_temporary(path).unwrap();
    let host =
        FormalHost::open_queueing(&root, HostEnvironment::new("darwin", false, false).unwrap())
            .unwrap();
    (root, host)
}
fn call(h: &FormalHost, v: Value) -> Value {
    h.command("main", v)
        .unwrap()
        .wait(Duration::from_secs(5))
        .unwrap()
}
fn invoke(h: &FormalHost, g: &str, c: &str, args: Value, chain: Option<&str>) -> Value {
    let mut v = json!({"command":"invoke","generation":g,"channel":c,"args":args});
    if let Some(chain) = chain {
        v["expectedChainId"] = json!(chain)
    }
    call(h, v)["value"].clone()
}
fn begin(h: &FormalHost, g: &str, s: &str, id: &str, text: &str) -> Value {
    invoke(
        h,
        g,
        "agent:send-message",
        json!([{"sessionId":s,"requestId":id,"startedAt":1,"channelId":"local-tools-mock","modelId":"local-tools-mock","userMessage":text}]),
        Some(id),
    )
}
fn state(h: &FormalHost, g: &str, s: &str, id: &str) -> Value {
    invoke(
        h,
        g,
        "agent:queue-state",
        json!([{"sessionId":s}]),
        Some(id),
    )
}
fn wait_permission(h: &FormalHost, g: &str, s: &str, id: &str) {
    let deadline = Instant::now() + Duration::from_secs(8);
    loop {
        let p = invoke(h, g, "agent:get-pending-requests", json!([s]), None);
        if p["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["requestId"] == id)
        {
            return;
        }
        assert!(Instant::now() < deadline, "permission {id}: {p}");
        std::thread::sleep(Duration::from_millis(5));
    }
}
fn grant(h: &FormalHost, g: &str, id: &str) {
    invoke(
        h,
        g,
        "agent:permission:respond",
        json!([{"requestId":id,"behavior":"allow","alwaysAllow":false}]),
        None,
    );
}
#[test]
fn queue_fifo_reload_exact_uuid_and_one_chain_completion() {
    let (_root, mut h) = setup();
    let boot = call(&h, json!({"command":"bootstrap"}));
    assert_eq!(boot["queueing"], true);
    let g = boot["generation"].as_str().unwrap();
    call(&h, json!({"command":"attach","generation":g,"observed":{}}));
    let s = invoke(
        &h,
        g,
        "agent:create-session",
        json!(["queue", "local-tools-mock"]),
        None,
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    begin(&h, g, &s, "a", "A");
    wait_permission(&h, g, &s, "p-a-0");
    for id in ["b", "b-user"] {
        let receipt = invoke(
            &h,
            g,
            "agent:queue-message",
            json!([{"sessionId":s,"uuid":id,"userMessage":id,"interrupt":false}]),
            Some("a"),
        );
        assert_eq!(receipt["uuid"], id)
    }
    let boot = call(&h, json!({"command":"bootstrap"}));
    let g = boot["generation"].as_str().unwrap();
    assert_eq!(boot["activeRuns"][0]["requestId"], "a");
    call(&h, json!({"command":"attach","generation":g,"observed":{}}));
    let restore = call(
        &h,
        json!({"command":"restore","generation":g,"sessionId":s,"observedDeliverySequence":0}),
    );
    assert_eq!(
        restore["sdkMessages"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|m| m["_desktopQueueDisposition"] == "pending")
            .count(),
        2
    );
    call(
        &h,
        json!({"command":"resume","generation":g,"restoreToken":restore["restoreToken"]}),
    );
    for id in ["a", "b", "b-user"] {
        for round in 0..2 {
            let pid = format!("p-{id}-{round}");
            wait_permission(&h, g, &s, &pid);
            grant(&h, g, &pid)
        }
    }
    let deadline = Instant::now() + Duration::from_secs(8);
    while state(&h, g, &s, "a")["closureReason"].is_null() {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(5));
    }
    let mut complete = vec![];
    while let Some(event) = h.next_event(Duration::from_millis(50)) {
        if event.generation == g && event.channel == "agent:stream:complete" {
            complete.push(event.payload)
        }
    }
    assert_eq!(complete.len(), 1);
    assert_eq!(complete[0]["requestId"], "a");
    assert_eq!(h.mock_records().len(), 9);
    let history = invoke(&h, g, "agent:get-messages", json!([s]), None);
    assert_eq!(history.as_array().unwrap().len(), 6);
    h.shutdown().unwrap();
}
#[test]
fn interrupt_stop_stale_control_and_close_abort_preserve_chain_authority() {
    let (_root, mut h) = setup();
    let boot = call(&h, json!({"command":"bootstrap"}));
    let g = boot["generation"].as_str().unwrap();
    call(&h, json!({"command":"attach","generation":g,"observed":{}}));
    let s = invoke(
        &h,
        g,
        "agent:create-session",
        json!(["queue", "local-tools-mock"]),
        None,
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    begin(&h, g, &s, "a", "A");
    wait_permission(&h, g, &s, "p-a-0");
    invoke(
        &h,
        g,
        "agent:queue-message",
        json!([{"sessionId":s,"uuid":"d","userMessage":"D","interrupt":true}]),
        Some("a"),
    );
    wait_permission(&h, g, &s, "p-d-0");
    let close = call(&h, json!({"command":"beginClose","generation":g}));
    call(
        &h,
        json!({"command":"abortClose","generation":g,"closeToken":close["closeToken"]}),
    );
    invoke(&h, g, "agent:stop", json!([s]), Some("a"));
    assert_eq!(state(&h, g, &s, "a")["closureReason"], "stop");
    begin(&h, g, &s, "new", "new");
    wait_permission(&h, g, &s, "p-new-0");
    invoke(&h, g, "agent:stop", json!([s]), Some("a"));
    assert!(state(&h, g, &s, "new")["closureReason"].is_null());
    let other = invoke(
        &h,
        g,
        "agent:create-session",
        json!(["other", "local-tools-mock"]),
        None,
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    begin(&h, g, &other, "side", "side");
    wait_permission(&h, g, &other, "p-side-0");
    let _=h.command("main",json!({"command":"invoke","generation":g,"channel":"agent:permission:respond","args":[{"requestId":"p-a-0","behavior":"allow","alwaysAllow":false}]})).unwrap().wait(Duration::from_secs(3));
    wait_permission(&h, g, &s, "p-new-0");
    wait_permission(&h, g, &other, "p-side-0");
    assert!(state(&h, g, &other, "side")["closureReason"].is_null());
    let close = call(&h, json!({"command":"beginClose","generation":g}));
    call(
        &h,
        json!({"command":"closeReady","generation":g,"closeToken":close["closeToken"],"committedRevision":close["baselineRevision"]}),
    );
    h.shutdown().unwrap();
}

#[test]
fn full_outbox_stop_preserves_unexecuted_text_and_restart_makes_no_http() {
    let (root, mut h) = setup();
    let boot = call(&h, json!({"command":"bootstrap"}));
    let g = boot["generation"].as_str().unwrap();
    call(&h, json!({"command":"attach","generation":g,"observed":{}}));
    let s = invoke(
        &h,
        g,
        "agent:create-session",
        json!(["queue", "local-tools-mock"]),
        None,
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    begin(&h, g, &s, "a", "A");
    wait_permission(&h, g, &s, "p-a-0");
    for _ in 0..260 {
        call(&h, json!({"command":"attach","generation":g,"observed":{}}));
    }
    invoke(
        &h,
        g,
        "agent:queue-message",
        json!([{"sessionId":s,"uuid":"b","userMessage":"retained B 你好","interrupt":false}]),
        Some("a"),
    );
    invoke(&h, g, "agent:stop", json!([s]), Some("a"));
    assert_eq!(
        state(&h, g, &s, "a")["messages"][0]["disposition"],
        "abandoned"
    );
    let mut count = 0;
    let mut complete = false;
    let mut latest = None;
    while let Some(e) = h.next_event(Duration::from_millis(100)) {
        count += 1;
        if e.payload["payload"]["event"]["type"] == "native_chain_snapshot" {
            latest = Some(e.payload.clone())
        }
        if e.channel == "agent:stream:complete" {
            complete = true;
            break;
        }
    }
    assert!(count > 256);
    assert!(complete);
    assert_eq!(
        latest.unwrap()["payload"]["event"]["pendingMessages"][0]["_desktopQueueDisposition"],
        "abandoned"
    );
    assert_eq!(h.mock_records().len(), 1);
    h.shutdown().unwrap();
    drop(h);
    let mut reopened =
        FormalHost::open_queueing(&root, HostEnvironment::new("darwin", false, false).unwrap())
            .unwrap();
    let boot = call(&reopened, json!({"command":"bootstrap"}));
    assert_eq!(boot["activeRuns"], json!([]));
    let g = boot["generation"].as_str().unwrap();
    call(
        &reopened,
        json!({"command":"attach","generation":g,"observed":{}}),
    );
    let restored = call(
        &reopened,
        json!({"command":"restore","generation":g,"sessionId":s,"observedDeliverySequence":0}),
    );
    assert!(restored["sdkMessages"]
        .as_array()
        .unwrap()
        .iter()
        .any(|m| m["_desktopQueueUuid"] == "b" && m["_desktopQueueDisposition"] == "abandoned"));
    let hit = invoke(
        &reopened,
        g,
        "agent:search-messages",
        json!(["retained b"]),
        None,
    );
    assert_eq!(hit[0]["messageId"], r#"native-queue:["a","b"]"#);
    assert_eq!(hit[0]["role"], "user");
    assert!(reopened.mock_records().is_empty());
    reopened.shutdown().unwrap();
}

#[test]
fn deletion_under_backpressure_still_completes_chain_and_clears_exact_permissions() {
    let (_root, mut h) = setup();
    let boot = call(&h, json!({"command":"bootstrap"}));
    let g = boot["generation"].as_str().unwrap();
    call(&h, json!({"command":"attach","generation":g,"observed":{}}));
    let s = invoke(
        &h,
        g,
        "agent:create-session",
        json!(["queue", "local-tools-mock"]),
        None,
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    begin(&h, g, &s, "a", "A");
    wait_permission(&h, g, &s, "p-a-0");
    for _ in 0..260 {
        call(&h, json!({"command":"attach","generation":g,"observed":{}}));
    }
    invoke(
        &h,
        g,
        "agent:queue-message",
        json!([{"sessionId":s,"uuid":"b","userMessage":"B","interrupt":false}]),
        Some("a"),
    );
    invoke(&h, g, "agent:delete-session", json!([s]), None);
    let mut complete = false;
    while let Some(e) = h.next_event(Duration::from_millis(100)) {
        if e.channel == "agent:stream:complete" {
            assert_eq!(e.payload["requestId"], "a");
            complete = true;
            break;
        }
    }
    assert!(
        complete,
        "deleted chain must settle original send even when outbox was full"
    );
    assert_eq!(h.mock_records().len(), 1);
    h.shutdown().unwrap();
}

#[test]
fn later_failure_keeps_prior_success_and_unexecuted_inputs_in_history() {
    let (_root, mut h) = setup();
    let boot = call(&h, json!({"command":"bootstrap"}));
    let g = boot["generation"].as_str().unwrap();
    call(&h, json!({"command":"attach","generation":g,"observed":{}}));
    let s = invoke(
        &h,
        g,
        "agent:create-session",
        json!(["queue", "local-tools-mock"]),
        None,
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    begin(&h, g, &s, "a", "A");
    wait_permission(&h, g, &s, "p-a-0");
    for (id, text) in [("b", "[partial-error] B"), ("c", "C untouched")] {
        invoke(
            &h,
            g,
            "agent:queue-message",
            json!([{"sessionId":s,"uuid":id,"userMessage":text,"interrupt":false}]),
            Some("a"),
        );
    }
    for round in 0..2 {
        let id = format!("p-a-{round}");
        wait_permission(&h, g, &s, &id);
        grant(&h, g, &id)
    }
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let q = state(&h, g, &s, "a");
        if q["closureReason"] == "failure" {
            assert_eq!(q["messages"][1]["disposition"], "abandoned");
            break;
        }
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(5));
    }
    let history = invoke(&h, g, "agent:get-messages", json!([s]), None);
    assert!(history[1]["content"].as_str().unwrap().contains("verified"));
    assert_eq!(
        history.as_array().unwrap().last().unwrap()["queueUuid"],
        "c"
    );
    h.shutdown().unwrap();
}

#[test]
fn close_prepare_freezes_advancement_abort_resumes_and_final_close_survives_reopen() {
    let (root, mut h) = setup();
    let boot = call(&h, json!({"command":"bootstrap"}));
    let g = boot["generation"].as_str().unwrap();
    call(&h, json!({"command":"attach","generation":g,"observed":{}}));
    let s = invoke(
        &h,
        g,
        "agent:create-session",
        json!(["queue", "local-tools-mock"]),
        None,
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    begin(&h, g, &s, "a", "A");
    wait_permission(&h, g, &s, "p-a-0");
    invoke(
        &h,
        g,
        "agent:queue-message",
        json!([{"sessionId":s,"uuid":"b","userMessage":"B","interrupt":false}]),
        Some("a"),
    );
    let ticket = call(&h, json!({"command":"beginClose","generation":g}));
    assert_eq!(state(&h, g, &s, "a")["activeExecution"]["requestId"], "a");
    call(
        &h,
        json!({"command":"abortClose","generation":g,"closeToken":ticket["closeToken"]}),
    );
    for round in 0..2 {
        let id = format!("p-a-{round}");
        wait_permission(&h, g, &s, &id);
        grant(&h, g, &id)
    }
    wait_permission(&h, g, &s, "p-b-0");
    invoke(
        &h,
        g,
        "agent:queue-message",
        json!([{"sessionId":s,"uuid":"c","userMessage":"C","interrupt":false}]),
        Some("a"),
    );
    let ticket = call(&h, json!({"command":"beginClose","generation":g}));
    call(
        &h,
        json!({"command":"closeReady","generation":g,"closeToken":ticket["closeToken"],"committedRevision":ticket["baselineRevision"]}),
    );
    h.shutdown().unwrap();
    drop(h);
    let mut reopened =
        FormalHost::open_queueing(&root, HostEnvironment::new("darwin", false, false).unwrap())
            .unwrap();
    let boot = call(&reopened, json!({"command":"bootstrap"}));
    let state = state(&reopened, boot["generation"].as_str().unwrap(), &s, "a");
    assert_eq!(state["closureReason"], "close");
    assert_eq!(state["messages"][1]["disposition"], "abandoned");
    assert!(reopened.mock_records().is_empty());
    reopened.shutdown().unwrap();
}

#[test]
fn unobserved_terminal_replays_on_same_document_reattach_without_new_execution() {
    let (_root, mut h) = setup();
    let boot = call(&h, json!({"command":"bootstrap"}));
    let g = boot["generation"].as_str().unwrap();
    call(&h, json!({"command":"attach","generation":g,"observed":{}}));
    let s = invoke(
        &h,
        g,
        "agent:create-session",
        json!(["queue", "local-tools-mock"]),
        None,
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    begin(&h, g, &s, "a", "A");
    for round in 0..2 {
        let id = format!("p-a-{round}");
        wait_permission(&h, g, &s, &id);
        grant(&h, g, &id)
    }
    loop {
        let e = h.next_event(Duration::from_secs(5)).unwrap();
        if e.channel == "agent:stream:complete" {
            break;
        }
    }
    call(&h, json!({"command":"detach","generation":g}));
    call(&h, json!({"command":"attach","generation":g,"observed":{}}));
    let mut complete = false;
    while let Some(e) = h.next_event(Duration::from_millis(100)) {
        if e.channel == "agent:stream:complete" {
            complete = true;
            break;
        }
    }
    assert!(
        complete,
        "transport did not observe the terminal; reattach must replay it"
    );
    assert_eq!(h.mock_records().len(), 3);
    h.shutdown().unwrap();
}

#[test]
fn disabling_metadata_keeps_accepted_queue_and_receipts_but_blocks_new_chain() {
    let (_root, mut h) = setup();
    let g = call(&h, json!({"command":"bootstrap"}))["generation"]
        .as_str()
        .unwrap()
        .to_owned();
    let s = invoke(
        &h,
        &g,
        "agent:create-session",
        json!(["availability", "local-tools-mock"]),
        None,
    )["id"]
        .as_str()
        .unwrap()
        .to_owned();
    begin(&h, &g, &s, "available-a", "A");
    wait_permission(&h, &g, &s, "p-available-a-0");
    let queued = json!([{"sessionId":s,"uuid":"available-b","userMessage":"B","interrupt":false}]);
    let receipt = invoke(
        &h,
        &g,
        "agent:queue-message",
        queued.clone(),
        Some("available-a"),
    );
    call(
        &h,
        json!({"command":"invoke","generation":g,"channel":"channel:update","args":["local-tools-mock",{"enabled":false}],"mutation":{"mutationId":"disabled","expectedRevision":0}}),
    );
    assert_eq!(
        invoke(&h, &g, "channel:test", json!(["local-tools-mock"]), None)["success"],
        true
    );
    assert_eq!(
        invoke(&h, &g, "agent:queue-message", queued, Some("available-a")),
        receipt
    );
    begin(&h, &g, &s, "available-a", "A");
    for id in ["available-a", "available-b"] {
        for round in 0..2 {
            let pid = format!("p-{id}-{round}");
            wait_permission(&h, &g, &s, &pid);
            grant(&h, &g, &pid);
        }
    }
    let deadline = Instant::now() + Duration::from_secs(8);
    while state(&h, &g, &s, "available-a")["closureReason"].is_null() {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(5));
    }
    let count = h.mock_records().len();
    assert_eq!(count, 6);
    let pending=h.command("main",json!({"command":"invoke","generation":g,"channel":"agent:send-message","expectedChainId":"disabled-new","args":[{"sessionId":s,"requestId":"disabled-new","startedAt":1,"channelId":"local-tools-mock","modelId":"local-tools-mock","userMessage":"new"}]})).unwrap();
    assert_eq!(
        pending.wait(Duration::from_secs(2)).unwrap_err().0,
        "modelUnavailable"
    );
    assert_eq!(h.mock_records().len(), count);
    h.shutdown().unwrap();
}
