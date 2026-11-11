//! 原生正式适配必须经过真实HTTP/core，不使用替身执行引擎。
use serde_json::{json, Value};
use std::{
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};
use tinker_rust_foundation::{
    formal_host::FormalHost,
    formal_platform::{HostEnvironment, TrustedRoot},
};
static NEXT: AtomicU64 = AtomicU64::new(0);
fn setup() -> (TrustedRoot, FormalHost) {
    let path = std::fs::canonicalize(std::env::temp_dir())
        .unwrap()
        .join(format!(
            "tinker-tauri-formal-preview-test-agent-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
    let root = TrustedRoot::create_temporary(path).unwrap();
    let host =
        FormalHost::open(&root, HostEnvironment::new("darwin", false, false).unwrap()).unwrap();
    (root, host)
}
fn call(h: &FormalHost, v: Value) -> Value {
    h.command("main", v)
        .unwrap()
        .wait(Duration::from_secs(10))
        .unwrap()
}
fn bootstrap(h: &FormalHost) -> String {
    call(h, json!({"command":"bootstrap"}))["generation"]
        .as_str()
        .unwrap()
        .into()
}
fn invoke(h: &FormalHost, g: &str, c: &str, a: Value) -> Value {
    call(
        h,
        json!({"command":"invoke","generation":g,"channel":c,"args":a}),
    )["value"]
        .clone()
}
fn create(h: &FormalHost, g: &str) -> String {
    invoke(
        h,
        g,
        "agent:create-session",
        json!(["合成会话", "local-mock", "local-mock-workspace-id"]),
    )["id"]
        .as_str()
        .unwrap()
        .into()
}
fn send(
    h: &FormalHost,
    g: &str,
    s: &str,
    id: &str,
    text: &str,
) -> tinker_rust_foundation::formal_agent::PendingReply {
    h.command("main",json!({"command":"invoke","generation":g,"channel":"agent:send-message","args":[{"sessionId":s,"requestId":id,"startedAt":1234,"channelId":"local-mock","modelId":"local-mock-a","workspaceId":"local-mock-workspace-id","userMessage":text}]})).unwrap()
}
#[test]
fn actual_http_unicode_multiturn_and_duplicate_send_wait_for_terminal() {
    let (_root, h) = setup();
    let g = bootstrap(&h);
    let s = create(&h, &g);
    call(&h, json!({"command":"attach","observed":{},"generation":g}));
    let pending = send(&h, &g, &s, "first", "[slow] hello");
    assert!(pending.try_result().is_none());
    let duplicate = send(&h, &g, &s, "first", "[slow] hello");
    assert_eq!(
        send(&h, &g, &s, "busy", "hello")
            .wait(Duration::from_secs(2))
            .unwrap_err()
            .0,
        "runBusy"
    );
    pending.wait(Duration::from_secs(10)).unwrap();
    duplicate.wait(Duration::from_secs(2)).unwrap();
    let history = invoke(&h, &g, "agent:get-messages", json!([s]));
    assert!(history[1]["content"].as_str().unwrap().contains("你好 🌱"));
    send(&h, &g, &s, "second", "continue")
        .wait(Duration::from_secs(10))
        .unwrap();
    let records = h.mock_records();
    assert_eq!(records.len(), 2);
    assert_eq!(records[1].assistant_messages, 1);
    assert!(
        invoke(&h, &g, "channel:list", json!([]))[0]["models"][0]["name"]
            .as_str()
            .unwrap()
            .starts_with("Local Mock")
    );
}
#[test]
fn restore_barrier_cancel_and_generation_are_native_owned() {
    let (_root, h) = setup();
    let g = bootstrap(&h);
    let s = create(&h, &g);
    let pending = send(&h, &g, &s, "restore", "[slow] hello");
    let boot = call(&h, json!({"command":"bootstrap"}));
    let g2 = boot["generation"].as_str().unwrap();
    assert_eq!(boot["activeRuns"][0]["requestId"], "restore");
    assert_eq!(
        h.command(
            "main",
            json!({"command":"attach","observed":{},"generation":g})
        )
        .unwrap()
        .wait(Duration::from_secs(2))
        .unwrap_err()
        .0,
        "staleGeneration"
    );
    call(
        &h,
        json!({"command":"attach","observed":{},"generation":g2}),
    );
    let restore = call(
        &h,
        json!({"command":"restore","observedDeliverySequence":0,"generation":g2,"sessionId":s}),
    );
    invoke(&h, g2, "agent:stop", json!([s]));
    pending.wait(Duration::from_secs(3)).unwrap();
    call(
        &h,
        json!({"command":"resume","generation":g2,"restoreToken":restore["restoreToken"]}),
    );
    let mut complete = false;
    while let Some(e) = h.next_event(Duration::from_millis(50)) {
        if e.generation == g2 && e.channel == "agent:stream:complete" {
            complete = true;
        }
    }
    assert!(complete);
    let bundle = call(
        &h,
        json!({"command":"restore","observedDeliverySequence":0,"generation":g2,"sessionId":s}),
    );
    assert_eq!(
        bundle["sdkMessages"].as_array().unwrap().last().unwrap()["subtype"],
        "asci_turn_stopped"
    );
}
#[test]
fn failure_rejects_and_native_boundary_rejects_unknown_or_external_authority() {
    let (_root, h) = setup();
    let g = bootstrap(&h);
    let s = create(&h, &g);
    assert_eq!(
        send(&h, &g, &s, "partial", "[partial-error]")
            .wait(Duration::from_secs(10))
            .unwrap_err()
            .0,
        "responseFailed"
    );
    let messages = invoke(&h, &g, "agent:get-messages", json!([s]));
    assert!(!messages[1]["content"].as_str().unwrap().is_empty());
    assert!(h.command("other", json!({"command":"bootstrap"})).is_err());
    assert!(h
        .command("main", json!({"command":"bootstrap","root":"/Users/real"}))
        .is_err());
    assert_eq!(
        h.command(
            "main",
            json!({"command":"invoke","generation":g,"channel":"files:read","args":["/Users/real"]})
        )
        .unwrap()
        .wait(Duration::from_secs(2))
        .unwrap_err()
        .0,
        "unsupported"
    );
}
#[test]
fn original_workspace_capability_parameters_use_slug_not_session_id() {
    let (_root, h) = setup();
    let g = bootstrap(&h);
    assert_eq!(
        invoke(
            &h,
            &g,
            "agent:get-capabilities",
            json!(["local-mock-workspace"])
        ),
        json!({"skills":[],"mcpServers":[]})
    );
    assert_eq!(
        invoke(&h, &g, "agent:get-skills", json!(["local-mock-workspace"])),
        json!([])
    );
}
#[test]
fn a_slow_event_consumer_gets_final_snapshot_without_reattaching() {
    let (_root, h) = setup();
    let g = bootstrap(&h);
    let s = create(&h, &g);
    call(&h, json!({"command":"attach","observed":{},"generation":g}));
    send(&h, &g, &s, "overflow", "[backlog]")
        .wait(Duration::from_secs(5))
        .unwrap();
    let mut previous = 0;
    let mut text = String::new();
    let mut complete = false;
    let deadline = std::time::Instant::now() + Duration::from_secs(3);
    while std::time::Instant::now() < deadline {
        if let Some(event) = h.next_event(Duration::from_millis(30)) {
            assert!(event.delivery_sequence > previous);
            previous = event.delivery_sequence;
            let p = &event.payload["payload"];
            if p["event"]["type"] == "text_snapshot" {
                text = p["event"]["text"].as_str().unwrap().into();
            } else if p["event"]["type"] == "text_delta" {
                text.push_str(p["event"]["text"].as_str().unwrap());
            }
            if event.channel == "agent:stream:complete" {
                complete = true;
                break;
            }
        }
    }
    assert!(complete, "满队列后必须自动补终态，不能留下永久running");
    let history = invoke(&h, &g, "agent:get-messages", json!([s]));
    assert_eq!(text, history[1]["content"].as_str().unwrap());
}
#[test]
fn restore_watermark_and_adjacent_reads_share_one_baseline_across_terminal() {
    let (_root, h) = setup();
    let g = bootstrap(&h);
    let s = create(&h, &g);
    call(&h, json!({"command":"attach","observed":{},"generation":g}));
    let pending = send(&h, &g, &s, "watermark", "[backlog]");
    // 以实际事件而不是sleep判断已有输出；保留其余outbox用于验证屏障游标。
    loop {
        let e = h.next_event(Duration::from_secs(2)).unwrap();
        if e.payload["payload"]["event"]["type"] == "text_delta" {
            break;
        }
    }
    let first = call(
        &h,
        json!({"command":"restore","observedDeliverySequence":0,"generation":g,"sessionId":s}),
    );
    let second = call(
        &h,
        json!({"command":"restore","observedDeliverySequence":0,"generation":g,"sessionId":s}),
    );
    assert_eq!(first, second);
    let watermark = first["deliverySequence"]
        .as_u64()
        .expect("restore必须包含单会话投递屏障序号");
    pending.wait(Duration::from_secs(5)).unwrap();
    // 等待终态期间该session仍暂停，不能抢在历史Promise消费者之前投递。
    while let Some(e) = h.next_event(Duration::from_millis(10)) {
        assert!(e.delivery_sequence <= watermark);
    }
    call(
        &h,
        json!({"command":"resume","generation":g,"restoreToken":first["restoreToken"]}),
    );
    let mut output = first["activeSnapshot"]["currentSnapshot"]["payload"]["event"]["text"]
        .as_str()
        .unwrap_or("")
        .to_owned();
    loop {
        let e = h.next_event(Duration::from_secs(2)).unwrap();
        assert!(e.delivery_sequence > watermark);
        let event = &e.payload["payload"]["event"];
        if event["type"] == "text_snapshot" {
            output = event["text"].as_str().unwrap().into();
        }
        if e.channel == "agent:stream:complete" {
            break;
        }
    }
    assert_eq!(
        output,
        invoke(&h, &g, "agent:get-messages", json!([s]))[1]["content"]
            .as_str()
            .unwrap()
    );
}
#[test]
fn close_revision_interlock_refuses_send_and_releases_runtime_only_after_cancel() {
    let (root, mut h) = setup();
    let g = bootstrap(&h);
    let s = create(&h, &g);
    let pending = send(&h, &g, &s, "closing", "[slow]");
    let ticket = call(&h, json!({"command":"beginClose","generation":g}));
    assert_eq!(
        send(&h, &g, &s, "too-late", "hello")
            .wait(Duration::from_secs(2))
            .unwrap_err()
            .0,
        "closing"
    );
    call(
        &h,
        json!({"command":"invoke","generation":g,"channel":"settings:update","args":[{"language":"zh"}],"mutation":{"mutationId":"last-write","expectedRevision":0}}),
    );
    assert_eq!(h.command("main",json!({"command":"closeReady","generation":g,"closeToken":ticket["closeToken"],"committedRevision":0})).unwrap().wait(Duration::from_secs(2)).unwrap_err().0,"revisionConflict");
    call(
        &h,
        json!({"command":"closeReady","generation":g,"closeToken":ticket["closeToken"],"committedRevision":1}),
    );
    assert!(pending.wait(Duration::from_secs(2)).is_ok());
    assert!(h.command("main",json!({"command":"invoke","generation":g,"channel":"settings:update","args":[{"language":"en"}],"mutation":{"mutationId":"after-drain","expectedRevision":1}})).is_err());
    h.shutdown().unwrap();
    let h = FormalHost::open(&root, HostEnvironment::new("darwin", false, false).unwrap()).unwrap();
    let g = bootstrap(&h);
    assert_eq!(invoke(&h, &g, "settings:get", json!([]))["language"], "zh");
    let bundle = call(&h, json!({"command":"attach","observed":{},"generation":g}));
    assert!(bundle["activeRuns"].as_array().unwrap().is_empty());
    let history = call(
        &h,
        json!({"command":"restore","observedDeliverySequence":0,"generation":g,"sessionId":s}),
    );
    assert_eq!(
        history["sdkMessages"][1]["_desktopRuntimeStatus"],
        "cancelled"
    );
    assert!(h.mock_records().is_empty());
}
#[test]
fn two_models_effort_and_session_mutations_use_the_actual_registry() {
    let (_root, h) = setup();
    let g = bootstrap(&h);
    let s = create(&h, &g);
    let input = json!({"sessionId":s,"requestId":"model-b","startedAt":9,"channelId":"local-mock","modelId":"local-mock-b","effort":"low","userMessage":"hello"});
    invoke(&h, &g, "agent:send-message", json!([input]));
    assert_eq!(h.mock_records()[0].model, "local-mock-b");
    assert_eq!(h.mock_records()[0].effort.as_deref(), Some("low"));
    assert!(
        invoke(&h, &g, "agent:get-messages", json!([s]))[1]["content"]
            .as_str()
            .unwrap()
            .contains("Local Mock B")
    );
    assert_eq!(
        invoke(&h, &g, "agent:toggle-pin", json!([s]))["pinned"],
        true
    );
    let archived = invoke(&h, &g, "agent:toggle-archive", json!([s]));
    assert_eq!(archived["archived"], true);
    assert_eq!(archived["pinned"], false);
    assert_eq!(
        invoke(&h, &g, "agent:update-title", json!([s, "改名"]))["title"],
        "改名"
    );
    let draft = invoke(
        &h,
        &g,
        "agent:get-or-create-draft-session",
        json!(["local-mock", "local-mock-workspace-id"]),
    );
    assert_eq!(
        draft,
        invoke(
            &h,
            &g,
            "agent:get-or-create-draft-session",
            json!(["local-mock", "local-mock-workspace-id"])
        )
    );
    let path = invoke(&h, &g, "agent:get-session-path", json!([s]));
    assert!(std::path::Path::new(path.as_str().unwrap()).is_dir());
    invoke(&h, &g, "agent:delete-session", json!([s]));
    assert_eq!(
        invoke(&h, &g, "agent:list-sessions", json!([]))
            .as_array()
            .unwrap()
            .len(),
        1
    );
}
#[test]
fn concurrent_sessions_deliver_ordered_global_sequences_and_old_run_cannot_stop_new_run() {
    let (_root, h) = setup();
    let g = bootstrap(&h);
    let a = create(&h, &g);
    let b = create(&h, &g);
    call(&h, json!({"command":"attach","observed":{},"generation":g}));
    let first = send(&h, &g, &a, "old-a", "[slow]");
    let other = send(&h, &g, &b, "other-b", "[backlog]");
    invoke(&h, &g, "agent:stop", json!([a]));
    first.wait(Duration::from_secs(2)).unwrap();
    let next = send(&h, &g, &a, "new-a", "hello");
    let mut previous = 0;
    let mut completed = std::collections::HashSet::new();
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    while std::time::Instant::now() < deadline && completed.len() < 2 {
        if let Some(e) = h.next_event(Duration::from_millis(50)) {
            assert!(e.delivery_sequence > previous);
            previous = e.delivery_sequence;
            if e.channel == "agent:stream:complete"
                && (e.payload["requestId"] == "new-a" || e.payload["requestId"] == "other-b")
            {
                completed.insert(e.payload["requestId"].as_str().unwrap().to_owned());
                assert_eq!(e.payload["resultSubtype"], "success");
            }
        }
    }
    assert_eq!(completed.len(), 2);
    next.wait(Duration::from_secs(2)).unwrap();
    other.wait(Duration::from_secs(2)).unwrap();
}
#[test]
fn crash_child_fixture() {
    let Ok(path) = std::env::var("TINKER_FORMAL_CRASH_ROOT") else {
        return;
    };
    let root = TrustedRoot::open_temporary(path).unwrap();
    let h = FormalHost::open(&root, HostEnvironment::new("darwin", false, false).unwrap()).unwrap();
    let g = bootstrap(&h);
    call(&h, json!({"command":"attach","observed":{},"generation":g}));
    let _pending = send(&h, &g, "session-1", "crash-run", "[slow]");
    loop {
        let e = h.next_event(Duration::from_secs(3)).unwrap();
        if e.payload["payload"]["event"]["type"] == "text_delta" {
            std::process::exit(0);
        }
    }
}
#[test]
fn full_process_restart_marks_interrupted_without_http_replay_and_keeps_successful_context() {
    let (root, mut h) = setup();
    let g = bootstrap(&h);
    let s = create(&h, &g);
    send(&h, &g, &s, "before-crash", "hello")
        .wait(Duration::from_secs(4))
        .unwrap();
    h.shutdown().unwrap();
    drop(h);
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "crash_child_fixture", "--nocapture"])
        .env("TINKER_FORMAL_CRASH_ROOT", root.path())
        .status()
        .unwrap();
    assert!(status.success());
    let h = FormalHost::open(&root, HostEnvironment::new("darwin", false, false).unwrap()).unwrap();
    let g = bootstrap(&h);
    call(&h, json!({"command":"attach","observed":{},"generation":g}));
    let history = call(
        &h,
        json!({"command":"restore","observedDeliverySequence":0,"generation":g,"sessionId":s}),
    );
    assert_eq!(
        history["sdkMessages"][3]["_desktopRuntimeStatus"],
        "interrupted"
    );
    assert!(h.mock_records().is_empty());
    call(
        &h,
        json!({"command":"resume","generation":g,"restoreToken":history["restoreToken"]}),
    );
    assert!(
        h.next_event(Duration::from_millis(30)).is_none(),
        "重启后的普通终态历史读取不可制造COMPLETE"
    );
    send(&h, &g, &s, "before-crash", "hello")
        .wait(Duration::from_secs(3))
        .unwrap();
    assert!(h.mock_records().is_empty());
    send(&h, &g, &s, "after-crash", "hello")
        .wait(Duration::from_secs(4))
        .unwrap();
    assert_eq!(h.mock_records().len(), 1);
    assert_eq!(h.mock_records()[0].assistant_messages, 1);
}
#[test]
fn bootstrap_seeded_run_finishing_before_attach_always_delivers_complete() {
    let (_root, h) = setup();
    let g = bootstrap(&h);
    let s = create(&h, &g);
    let pending = send(&h, &g, &s, "seeded", "[backlog]");
    let boot = call(&h, json!({"command":"bootstrap"}));
    let new_g = boot["generation"].as_str().unwrap();
    assert_eq!(boot["activeRuns"][0]["requestId"], "seeded");
    pending.wait(Duration::from_secs(5)).unwrap();
    assert!(h.next_event(Duration::from_millis(20)).is_none());
    call(
        &h,
        json!({"command":"attach","observed":{},"generation":new_g}),
    );
    loop {
        let e = h.next_event(Duration::from_secs(2)).unwrap();
        assert_eq!(e.generation, new_g);
        if e.channel == "agent:stream:complete" {
            assert_eq!(e.payload["requestId"], "seeded");
            break;
        }
    }
    let next = send(&h, new_g, &s, "strict-mode", "[backlog]");
    call(&h, json!({"command":"detach","generation":new_g}));
    next.wait(Duration::from_secs(5)).unwrap();
    call(
        &h,
        json!({"command":"attach","observed":{},"generation":new_g}),
    );
    loop {
        let e = h.next_event(Duration::from_secs(2)).unwrap();
        if e.channel == "agent:stream:complete" && e.payload["requestId"] == "strict-mode" {
            break;
        }
    }
}
#[test]
fn malformed_send_and_wrong_workspace_model_or_effort_never_reach_http() {
    let (_root, h) = setup();
    let g = bootstrap(&h);
    let s = create(&h, &g);
    let input = json!({"sessionId":s,"requestId":"invalid","startedAt":1,"channelId":"local-mock","modelId":"local-mock-a","userMessage":"hello"});
    for (key, bad) in [
        ("workspaceId", json!("local-mock-workspace")),
        ("modelId", json!("remote")),
        ("effort", json!("max")),
        ("endpoint", json!("https://example.com")),
        ("attachments", json!([])),
        ("requestId", json!("../escape")),
        ("userMessage", json!("@file:/Users/private")),
        ("startedAt", json!(9007199254740992u64)),
    ] {
        let mut v = input.clone();
        v[key] = bad;
        let result=h.command("main",json!({"command":"invoke","generation":g,"channel":"agent:send-message","args":[v]})).unwrap().wait(Duration::from_secs(2));
        assert!(result.is_err(), "必须拒绝 {key}");
        assert!(!result.unwrap_err().to_string().contains('/'));
    }
    assert!(h.mock_records().is_empty());
}
#[test]
fn terminal_idempotent_send_still_settles_renderer_stream_without_second_http() {
    let (_root, h) = setup();
    let g = bootstrap(&h);
    let s = create(&h, &g);
    call(&h, json!({"command":"attach","observed":{},"generation":g}));
    send(&h, &g, &s, "replayed", "hello")
        .wait(Duration::from_secs(3))
        .unwrap();
    loop {
        if h.next_event(Duration::from_secs(2)).unwrap().channel == "agent:stream:complete" {
            break;
        }
    }
    send(&h, &g, &s, "replayed", "hello")
        .wait(Duration::from_secs(3))
        .unwrap();
    let mut complete = false;
    while let Some(e) = h.next_event(Duration::from_millis(100)) {
        if e.channel == "agent:stream:complete" {
            complete = true;
            break;
        }
    }
    assert!(complete, "terminal replay仍须清理renderer running");
    assert_eq!(h.mock_records().len(), 1);
}
#[test]
fn terminal_duplicate_while_detached_also_resolves_without_attach() {
    let (_root, h) = setup();
    let g = bootstrap(&h);
    let s = create(&h, &g);
    send(&h, &g, &s, "detached-replay", "hello")
        .wait(Duration::from_secs(3))
        .unwrap();
    send(&h, &g, &s, "detached-replay", "hello")
        .wait(Duration::from_secs(2))
        .unwrap();
    assert_eq!(h.mock_records().len(), 1);
}
#[test]
fn expired_restore_recovers_delivery_and_rejects_the_stale_ack() {
    let (_root, h) = setup();
    let g = bootstrap(&h);
    let s = create(&h, &g);
    call(&h, json!({"command":"attach","observed":{},"generation":g}));
    let pending = send(&h, &g, &s, "expiry", "[backlog]");
    let bundle = call(
        &h,
        json!({"command":"restore","observedDeliverySequence":0,"generation":g,"sessionId":s}),
    );
    pending.wait(Duration::from_secs(4)).unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(7);
    let mut complete = false;
    while std::time::Instant::now() < deadline {
        if let Some(e) = h.next_event(Duration::from_millis(100)) {
            if e.channel == "agent:stream:complete" {
                complete = true;
                break;
            }
        }
    }
    assert!(complete);
    assert!(h
        .command(
            "main",
            json!({"command":"resume","generation":g,"restoreToken":bundle["restoreToken"]})
        )
        .unwrap()
        .wait(Duration::from_secs(2))
        .is_err());
}
#[test]
fn only_native_environment_updates_change_chrome_without_persisted_revision() {
    let (_root, h) = setup();
    let g = bootstrap(&h);
    let snapshot = h
        .set_host_environment(HostEnvironment::new("darwin", true, true).unwrap())
        .unwrap()
        .wait(Duration::from_secs(2))
        .unwrap();
    assert_eq!(snapshot["revision"], 0);
    assert_eq!(snapshot["chrome"]["fullscreen"], true);
    assert_eq!(
        invoke(&h, &g, "window:chrome-state", json!([]))["fullscreen"],
        true
    );
    assert!(h
        .command(
            "main",
            json!({"command":"setHostEnvironment","fullscreen":false})
        )
        .is_err());
}
#[test]
fn injected_runtime_registry_is_the_channel_authority_not_mock_constants() {
    use tinker_rust_foundation::{
        chat_http::HttpProtocol, desktop_runtime::DesktopRuntime, formal_agent::FormalAgentHost,
        formal_mock::OwnedMock, formal_platform::FormalPlatform,
    };
    let (root, mut original) = setup();
    original.shutdown().unwrap();
    drop(original);
    let mock = OwnedMock::start().unwrap();
    let mut profiles = mock.profiles().unwrap();
    profiles[0].protocol = HttpProtocol::AnthropicMessages;
    let platform = FormalPlatform::open(
        &root,
        &profiles,
        HostEnvironment::new("darwin", false, false).unwrap(),
    )
    .unwrap();
    let runtime = std::sync::Arc::new(DesktopRuntime::open(root.path(), profiles).unwrap());
    let host = FormalAgentHost::new(runtime, platform, root).unwrap();
    let boot = host
        .command("main", json!({"command":"bootstrap"}))
        .unwrap()
        .wait(Duration::from_secs(2))
        .unwrap();
    let result=host.command("main",json!({"command":"invoke","generation":boot["generation"],"channel":"channel:list","args":[]})).unwrap().wait(Duration::from_secs(2)).unwrap();
    assert_eq!(result["value"][0]["provider"], "custom-anthropic");
    assert!(mock.records().is_empty());
}
#[test]
fn terminal_queued_before_restore_watermark_is_settled_again_after_resume() {
    let (_root, h) = setup();
    let g = bootstrap(&h);
    let s = create(&h, &g);
    call(&h, json!({"command":"attach","observed":{},"generation":g}));
    send(&h, &g, &s, "queued-terminal", "hello")
        .wait(Duration::from_secs(3))
        .unwrap();
    // 确保前次poll已将COMPLETE加入outbox，但模拟WebView尚未处理它。
    invoke(&h, &g, "agent:get-messages", json!([s]));
    let bundle = call(
        &h,
        json!({"command":"restore","observedDeliverySequence":0,"generation":g,"sessionId":s}),
    );
    let watermark = bundle["deliverySequence"].as_u64().unwrap();
    assert!(bundle["activeSnapshot"].is_null());
    while let Some(e) = h.next_event(Duration::from_millis(10)) {
        assert!(e.delivery_sequence <= watermark);
    }
    call(
        &h,
        json!({"command":"resume","generation":g,"restoreToken":bundle["restoreToken"]}),
    );
    let mut complete = false;
    while let Some(e) = h.next_event(Duration::from_millis(100)) {
        assert!(e.delivery_sequence > watermark);
        if e.channel == "agent:stream:complete" {
            complete = true;
            break;
        }
    }
    assert!(
        complete,
        "水位前的终态被丢弃后仍须清理bootstrap seeded running"
    );
}
#[test]
fn observed_terminal_is_not_redelivered_by_history_refresh_or_strictmode_attach() {
    let (_root, h) = setup();
    let g = bootstrap(&h);
    let s = create(&h, &g);
    call(&h, json!({"command":"attach","generation":g,"observed":{}}));
    send(&h, &g, &s, "observed", "hello")
        .wait(Duration::from_secs(3))
        .unwrap();
    let observed = loop {
        let e = h.next_event(Duration::from_secs(2)).unwrap();
        if e.channel == "agent:stream:complete" {
            break e.delivery_sequence;
        }
    };
    for _ in 0..3 {
        let bundle = call(
            &h,
            json!({"command":"restore","generation":g,"sessionId":s,"observedDeliverySequence":observed}),
        );
        call(
            &h,
            json!({"command":"resume","generation":g,"restoreToken":bundle["restoreToken"]}),
        );
        assert!(
            h.next_event(Duration::from_millis(50)).is_none(),
            "实际已dispatch的COMPLETE不可因history refresh再次发射"
        );
    }
    call(&h, json!({"command":"detach","generation":g}));
    call(
        &h,
        json!({"command":"attach","generation":g,"observed":{s:observed}}),
    );
    assert!(h.next_event(Duration::from_millis(50)).is_none());
    assert_eq!(h.mock_records().len(), 1);
}
#[test]
fn strictmode_gap_recovers_complete_that_was_queued_but_never_observed() {
    let (_root, h) = setup();
    let g = bootstrap(&h);
    let s = create(&h, &g);
    call(&h, json!({"command":"attach","generation":g,"observed":{}}));
    send(&h, &g, &s, "unobserved", "hello")
        .wait(Duration::from_secs(3))
        .unwrap();
    invoke(&h, &g, "agent:get-messages", json!([s]));
    call(&h, json!({"command":"detach","generation":g}));
    while h.next_event(Duration::from_millis(10)).is_some() {}
    call(&h, json!({"command":"attach","generation":g,"observed":{}}));
    let terminal = loop {
        let e = h.next_event(Duration::from_secs(2)).unwrap();
        if e.channel == "agent:stream:complete" {
            break e.delivery_sequence;
        }
    };
    call(&h, json!({"command":"detach","generation":g}));
    call(
        &h,
        json!({"command":"attach","generation":g,"observed":{s:terminal}}),
    );
    assert!(h.next_event(Duration::from_millis(50)).is_none());
}
#[test]
fn failed_terminal_history_projection_rejects_send_and_respects_restore_pause() {
    use std::io::Write;
    let (root, h) = setup();
    let g = bootstrap(&h);
    let s = create(&h, &g);
    call(&h, json!({"command":"attach","generation":g,"observed":{}}));
    send(&h, &g, &s, "ancestor", "hello")
        .wait(Duration::from_secs(3))
        .unwrap();
    loop {
        if h.next_event(Duration::from_secs(2)).unwrap().channel == "agent:stream:complete" {
            break;
        }
    }
    let pending = send(&h, &g, &s, "projection-fault", "[backlog]");
    let bundle = call(
        &h,
        json!({"command":"restore","generation":g,"sessionId":s,"observedDeliverySequence":0}),
    );
    let file = root
        .path()
        .join("desktop-runtime-v1")
        .join(&s)
        .join("runs-v1/ancestor.jsonl");
    std::fs::OpenOptions::new()
        .append(true)
        .open(file)
        .unwrap()
        .write_all(b"injected-corruption\n")
        .unwrap();
    invoke(&h, &g, "agent:stop", json!([s]));
    assert_eq!(
        pending.wait(Duration::from_secs(2)).unwrap_err().0,
        "runtimeUnavailable",
        "终态历史失败必须保留失败草稿，不能已resolve成功或超时"
    );
    while let Some(e) = h.next_event(Duration::from_millis(10)) {
        assert!(
            e.delivery_sequence <= bundle["deliverySequence"].as_u64().unwrap(),
            "错误也必须服从restore屏障"
        );
    }
    call(
        &h,
        json!({"command":"resume","generation":g,"restoreToken":bundle["restoreToken"]}),
    );
    loop {
        let e = h.next_event(Duration::from_secs(2)).unwrap();
        if e.channel == "agent:stream:error" {
            assert!(!e.payload["error"].as_str().unwrap().contains("injected"));
            break;
        }
    }
}
