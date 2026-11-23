//! 原 preload 渠道配置经实际 FormalHost 与合成 owned HTTP。
use serde_json::{json, Value};
use std::time::Duration;
use tinker_rust_foundation::{
    formal_host::FormalHost,
    formal_platform::{HostEnvironment, TrustedRoot},
};
fn call(h: &FormalHost, v: Value) -> Result<Value, String> {
    h.command("main", v)
        .map_err(|e| e.0.to_string())?
        .wait(Duration::from_secs(10))
        .map_err(|e| e.0.to_string())
}
#[test]
fn existing_channel_metadata_commits_through_original_invoke() {
    let path = std::env::temp_dir().canonicalize().unwrap().join(format!(
        "tinker-tauri-formal-preview-channels-{}",
        std::process::id()
    ));
    let root = TrustedRoot::create_temporary(&path).unwrap();
    let mut host =
        FormalHost::open(&root, HostEnvironment::new("darwin", false, false).unwrap()).unwrap();
    let boot = call(&host, json!({"command":"bootstrap"})).unwrap();
    let g = boot["generation"].as_str().unwrap();
    let request = json!({"command":"invoke","generation":g,"channel":"channel:update","args":["local-mock",{"name":"Renamed","models":[{"id":"local-mock-a","name":"Primary","enabled":false},{"id":"local-mock-b","name":"Secondary","enabled":true}]}],"mutation":{"mutationId":"metadata","expectedRevision":0}});
    let result = call(&host, request.clone()).unwrap();
    assert_eq!(result["value"]["name"], "Renamed");
    assert_eq!(result["revision"], 1);
    assert_eq!(
        result["snapshot"]["settings"]["agentModelId"],
        "local-mock-b"
    );
    assert_eq!(call(&host, request).unwrap(), result);
    host.shutdown().unwrap();
    let host =
        FormalHost::open(&root, HostEnvironment::new("darwin", false, false).unwrap()).unwrap();
    let boot = call(&host, json!({"command":"bootstrap"})).unwrap();
    let list=call(&host,json!({"command":"invoke","generation":boot["generation"],"channel":"channel:list","args":[]})).unwrap();
    assert_eq!(list["value"][0]["name"], "Renamed");
    assert_eq!(host.mock_records().len(), 0);
}

fn setup(suffix: &str) -> (TrustedRoot, FormalHost, String) {
    let path = std::env::temp_dir().canonicalize().unwrap().join(format!(
        "tinker-tauri-formal-preview-channels-{}-{suffix}",
        std::process::id()
    ));
    let root = TrustedRoot::create_temporary(path).unwrap();
    let h = FormalHost::open(&root, HostEnvironment::new("darwin", false, false).unwrap()).unwrap();
    let g = call(&h, json!({"command":"bootstrap"})).unwrap()["generation"]
        .as_str()
        .unwrap()
        .to_owned();
    (root, h, g)
}
fn invoke(h: &FormalHost, g: &str, c: &str, args: Value) -> Result<Value, String> {
    call(
        h,
        json!({"command":"invoke","generation":g,"channel":c,"args":args}),
    )
    .map(|v| v["value"].clone())
}
fn update(h: &FormalHost, g: &str, patch: Value, id: &str, revision: u64) -> Result<Value, String> {
    call(
        h,
        json!({"command":"invoke","generation":g,"channel":"channel:update","args":["local-mock",patch],"mutation":{"mutationId":id,"expectedRevision":revision}}),
    )
}
fn send(h: &FormalHost, g: &str, s: &str, id: &str, model: &str) -> Result<Value, String> {
    invoke(
        h,
        g,
        "agent:send-message",
        json!([{"sessionId":s,"requestId":id,"startedAt":1234,"channelId":"local-mock","modelId":model,"userMessage":"hello"}]),
    )
}
#[test]
fn full_form_compatibility_discovery_and_nonsecret_receipts() {
    let (root, h, g) = setup("form");
    let c = invoke(&h, &g, "channel:list", json!([])).unwrap()[0].clone();
    let key = invoke(&h, &g, "channel:decrypt-key", json!(["local-mock"])).unwrap();
    assert_eq!(key, "synthetic-local-mock-key");
    assert_eq!(c["apiKey"], "");
    let input = json!({"provider":c["provider"],"baseUrl":c["baseUrl"],"apiKey":key,"probeModel":"local-mock-a","imageProtocol":"openai-images"});
    let tested = invoke(&h, &g, "channel:test-direct", json!([input])).unwrap();
    assert_eq!(tested["success"], true);
    assert_eq!(tested["message"], "catalogValidated");
    assert_eq!(
        invoke(&h, &g, "channel:fetch-models", json!([input])).unwrap()["models"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        invoke(&h, &g, "channel:test", json!(["local-mock"])).unwrap()["success"],
        true
    );
    assert_eq!(h.mock_records().len(), 0);
    let patch = json!({"name":"Alias","provider":c["provider"],"baseUrl":c["baseUrl"],"apiKey":key,"models":c["models"],"enabled":true,"capabilities":c["capabilities"]});
    let saved = update(&h, &g, patch.clone(), "form", 0).unwrap();
    assert_eq!(saved["value"]["name"], "Alias");
    // 去掉不可变连接字段后的重试共享同一幂等身份。
    assert_eq!(
        update(
            &h,
            &g,
            json!({"name":"Alias","models":c["models"],"enabled":true}),
            "form",
            0
        )
        .unwrap(),
        saved
    );
    let bytes = std::fs::read(root.path().join("formal-platform-v1/snapshot.json")).unwrap();
    let text = String::from_utf8(bytes).unwrap();
    for forbidden in [
        "synthetic-local-mock-key",
        "http://",
        "baseUrl",
        "apiKey",
        "capabilities",
    ] {
        assert!(!text.contains(forbidden), "{forbidden}")
    }
    for (field, value) in [
        ("baseUrl", json!("http://127.0.0.1:1/v1")),
        (
            "baseUrl",
            json!(format!("{}@127.0.0.1", c["baseUrl"].as_str().unwrap())),
        ),
        ("apiKey", json!("wrong")),
        ("provider", json!("custom-anthropic")),
        ("extra", json!(true)),
        ("imageProtocol", json!("gemini-content")),
        ("probeModel", json!("unknown")),
    ] {
        let mut bad = input.clone();
        bad[field] = value;
        assert!(
            invoke(&h, &g, "channel:test-direct", json!([bad])).is_err(),
            "{field}"
        );
    }
    let mut missing = input;
    missing.as_object_mut().unwrap().remove("probeModel");
    assert_eq!(
        invoke(&h, &g, "channel:test-direct", json!([missing])).unwrap_err(),
        "modelNotFound"
    );
    assert!(invoke(&h, &g, "channel:create", json!([patch])).is_err());
    assert!(invoke(&h, &g, "channel:delete", json!(["local-mock"])).is_err());
}
#[test]
fn strict_validation_conflicts_disabled_gate_and_exact_retries() {
    let (root, h, g) = setup("gate");
    let s = invoke(
        &h,
        &g,
        "agent:create-session",
        json!(["synthetic", "local-mock"]),
    )
    .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    send(&h, &g, &s, "accepted", "local-mock-a").unwrap();
    let count = h.mock_records().len();
    let journal = root.path().join("desktop-runtime-v1/journal.jsonl");
    let history = root
        .path()
        .join("desktop-runtime-v1")
        .join(&s)
        .join("runs-v1/accepted.jsonl");
    let journal_before = std::fs::read(&journal).unwrap();
    let history_before = std::fs::read(&history).unwrap();
    for bad in [
        json!({"name":""}),
        json!({"name":"x".repeat(257)}),
        json!({"enabled":null}),
        json!({"unknown":true}),
        json!({"models":[{"id":"unknown","name":"X","enabled":true}]}),
        json!({"models":[{"id":"local-mock-a","name":"A","enabled":true},{"id":"local-mock-a","name":"A","enabled":true}]}),
        json!({"capabilities":{"supportsPdfDocumentBlock":false},"name":"X"}),
        json!({"apiKey":"changed","name":"X"}),
    ] {
        assert!(update(&h, &g, bad, "bad", 0).is_err())
    }
    let saved = update(&h, &g, json!({"enabled":false}), "disable", 0).unwrap();
    assert_eq!(saved["snapshot"]["settings"]["agentChannelId"], "");
    assert_eq!(saved["snapshot"]["settings"]["agentModelId"], "");
    assert_eq!(
        send(&h, &g, &s, "new", "local-mock-a").unwrap_err(),
        "modelUnavailable"
    );
    send(&h, &g, &s, "accepted", "local-mock-a").unwrap();
    assert_eq!(h.mock_records().len(), count);
    assert_eq!(
        update(&h, &g, json!({"name":"next"}), "stale", 0).unwrap_err(),
        "revisionConflict"
    );
    assert_eq!(
        update(&h, &g, json!({"enabled":true}), "disable", 0).unwrap_err(),
        "mutationConflict"
    );
    let empty = update(&h, &g, json!({"enabled":true,"models":[]}), "empty", 1).unwrap();
    assert_eq!(empty["value"]["models"], json!([]));
    assert_eq!(
        send(&h, &g, &s, "empty", "local-mock-a").unwrap_err(),
        "modelUnavailable"
    );
    let restored = update(
        &h,
        &g,
        json!({"models":[{"id":"local-mock-b","name":"Secondary","enabled":true}]}),
        "restore",
        2,
    )
    .unwrap();
    assert_eq!(restored["revision"], 3);
    assert_eq!(std::fs::read(journal).unwrap(), journal_before);
    assert_eq!(std::fs::read(history).unwrap(), history_before);
    send(&h, &g, &s, "enabled", "local-mock-b").unwrap();
    assert_eq!(h.mock_records().len(), count + 1);
}
#[test]
fn restart_rebinds_owned_port_without_persisting_connection_or_running_http() {
    let (root, mut h, g) = setup("restart");
    let c = invoke(&h, &g, "channel:list", json!([])).unwrap()[0].clone();
    update(&h, &g, json!({"name":"Durable","enabled":false}), "save", 0).unwrap();
    h.shutdown().unwrap();
    drop(h);
    let mut h =
        FormalHost::open(&root, HostEnvironment::new("darwin", false, false).unwrap()).unwrap();
    let boot = call(&h, json!({"command":"bootstrap"})).unwrap();
    let g = boot["generation"].as_str().unwrap();
    let current = invoke(&h, g, "channel:list", json!([])).unwrap()[0].clone();
    assert_eq!(current["name"], "Durable");
    assert_ne!(current["baseUrl"], c["baseUrl"]);
    assert_eq!(boot["platformSnapshot"]["revision"], 1);
    assert!(h.mock_records().is_empty());
    let s = invoke(
        &h,
        g,
        "agent:create-session",
        json!(["synthetic", "local-mock"]),
    )
    .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(
        send(&h, g, &s, "disabled", "local-mock-a").unwrap_err(),
        "modelUnavailable"
    );
    assert!(h.mock_records().is_empty());
    h.shutdown().unwrap();
    drop(h);
    let file = root.path().join("formal-platform-v1/snapshot.json");
    let original = std::fs::read(&file).unwrap();
    let mut value: Value = serde_json::from_slice(&original).unwrap();
    for bad in [
        json!({"version":2,"channels":[]}),
        json!({"version":1,"channels":[]}),
        json!({"version":1,"channels":[],"unknown":true}),
    ] {
        value["channelOverlay"] = bad;
        let bytes = serde_json::to_vec(&value).unwrap();
        std::fs::write(&file, &bytes).unwrap();
        assert!(
            FormalHost::open(&root, HostEnvironment::new("darwin", false, false).unwrap()).is_err()
        );
        assert_eq!(std::fs::read(&file).unwrap(), bytes)
    }
    std::fs::write(&file, original).unwrap();
}

#[test]
fn empty_selection_still_rejects_unsupported_effort_without_commit() {
    let (_root, h, g) = setup("empty-effort");
    update(&h, &g, json!({"enabled":false}), "disable", 0).unwrap();
    let request = json!({"command":"invoke","generation":g,"channel":"settings:update","args":[{"agentEffort":"unknown"}],"mutation":{"mutationId":"invalid-effort","expectedRevision":1}});
    assert_eq!(call(&h, request).unwrap_err(), "unsupportedEffort");
    let boot = call(&h, json!({"command":"bootstrap"})).unwrap();
    assert_eq!(boot["platformSnapshot"]["revision"], 1);
    assert_eq!(boot["platformSnapshot"]["settings"]["agentEffort"], "high");
}

#[test]
fn global_and_project_drafts_are_disjoint_and_wrong_project_send_never_reaches_mock() {
    let (root, mut host, generation) = setup("project-drafts");
    let invoke = |channel, args| invoke(&host, &generation, channel, args);
    let a = invoke("agent:create-workspace", json!(["Alpine"])).unwrap();
    let b = invoke("agent:create-workspace", json!(["Coastal"])).unwrap();
    let draft = |workspace: &Value| {
        invoke(
            "agent:get-or-create-draft-session",
            json!(["local-mock", workspace]),
        )
        .unwrap()
    };
    let a_draft = draft(&a["id"]);
    let b_draft = draft(&b["id"]);
    let global = draft(&Value::Null);
    assert_eq!(a_draft["workspaceId"], a["id"]);
    assert_eq!(b_draft["workspaceId"], b["id"]);
    assert!(global["workspaceId"].is_null());
    assert_ne!(a_draft["id"], b_draft["id"]);
    assert_ne!(a_draft["id"], global["id"]);
    assert_eq!(draft(&a["id"])["id"], a_draft["id"]);
    let wrong = invoke(
        "agent:send-message",
        json!([{"sessionId":a_draft["id"],"workspaceId":b["id"],"channelId":"local-mock","modelId":"local-mock-a","userMessage":"wrong project"}]),
    );
    assert_eq!(wrong.unwrap_err(), "workspaceMismatch");
    assert!(host.mock_records().is_empty());
    host.shutdown().unwrap();
    std::fs::remove_dir_all(root.path()).unwrap();
}
