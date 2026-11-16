//! 正式平台门面的行为契约；所有文件均为新建合成根。
use serde_json::{json, Value};
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};
use tinker_rust_foundation::formal_platform::{
    local_mock_profiles, FormalPlatform, HostEnvironment, PlatformRequest, TrustedRoot,
};
static NEXT: AtomicU64 = AtomicU64::new(0);
fn path() -> PathBuf {
    fs::canonicalize(std::env::temp_dir())
        .unwrap()
        .join(format!(
            "tinker-tauri-formal-preview-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ))
}
fn setup() -> (TrustedRoot, FormalPlatform) {
    let root = TrustedRoot::create_temporary(path()).unwrap();
    let service = open(&root);
    (root, service)
}
fn open(root: &TrustedRoot) -> FormalPlatform {
    FormalPlatform::open(
        root,
        &local_mock_profiles("http://127.0.0.1:32123/v1/chat/completions").unwrap(),
        HostEnvironment::new("darwin", true, false).unwrap(),
    )
    .unwrap()
}
fn req(channel: &str, args: Value, mutation: Option<(&str, u64)>) -> PlatformRequest {
    serde_json::from_value(json!({"version":1,"channel":channel,"args":args,"mutation":mutation.map(|(id,r)|json!({"mutationId":id,"expectedRevision":r}))})).unwrap()
}
fn read(p: &FormalPlatform, channel: &str, args: Value) -> Value {
    p.invoke(req(channel, args, None)).unwrap().value
}
fn update(p: &FormalPlatform, id: &str, revision: u64, patch: Value) -> Value {
    p.invoke(req("settings:update", json!([patch]), Some((id, revision))))
        .unwrap()
        .value
}
#[test]
fn settings_profile_workspace_and_last_tab_patch_survive_restart() {
    let (root, p) = setup();
    assert_eq!(p.bootstrap().unwrap().revision, 0);
    let workspaces = read(&p, "agent:list-workspaces", json!([]));
    assert_ne!(workspaces[0]["id"], workspaces[0]["slug"]);
    update(
        &p,
        "preferences",
        0,
        json!({"theme":"light","language":"zh","agentModelId":"local-mock-b","agentEffort":"medium"}),
    );
    p.invoke(req(
        "user-profile:update",
        json!([{"userName":"测试用户","avatar":"🌱"}]),
        Some(("profile", 1)),
    ))
    .unwrap();
    assert_eq!(
        p.invoke(req(
            "agent:set-reasoning-effort",
            json!([workspaces[0]["slug"], "low"]),
            Some(("effort", 2))
        ))
        .unwrap()
        .value,
        Value::Null
    );
    let tabs = json!({"tabs":[{"id":"tab-last","type":"agent","sessionId":"session-a","title":"最后标签","workspaceId":workspaces[0]["id"]}],"activeTabId":"tab-last","activeTabIdByWorkspace":{workspaces[0]["id"].as_str().unwrap():"tab-last"}});
    update(
        &p,
        "last-tabs",
        3,
        json!({"tabState":tabs,"sidebarProjectFilesExpandedByWorkspace":{workspaces[0]["id"].as_str().unwrap():true}}),
    );
    drop(p);
    let p = open(&root);
    let snapshot = serde_json::to_value(p.bootstrap().unwrap()).unwrap();
    assert_eq!(snapshot["revision"], 4);
    assert_eq!(snapshot["settings"]["tabState"], tabs);
    assert_eq!(snapshot["settings"]["language"], "zh");
    assert_eq!(snapshot["theme"], json!({"mode":"light","isDark":false}));
    assert_eq!(
        snapshot["chrome"],
        json!({"platform":"darwin","fullscreen":false})
    );
    assert_eq!(snapshot["userProfile"]["userName"], "测试用户");
    assert_eq!(
        read(
            &p,
            "agent:get-reasoning-effort",
            json!([workspaces[0]["slug"]])
        ),
        "low"
    );
    let disk = fs::read_to_string(root.path().join("formal-platform-v1/snapshot.json")).unwrap();
    assert!(
        !disk.contains("32123")
            && !disk.contains("endpoint")
            && !disk.contains("synthetic-local-mock-key")
    );
}
#[test]
fn closing_last_tab_preserves_workspace_memory_after_restart() {
    assert_closed_tab_memory_survives_restart(false);
}
#[test]
fn closing_nonactive_tab_preserves_workspace_memory_after_restart() {
    assert_closed_tab_memory_survives_restart(true);
}
fn assert_closed_tab_memory_survives_restart(keep_active_tab: bool) {
    let (root, p) = setup();
    let workspace_id = "local-mock-workspace-id";
    let closed_id = if keep_active_tab {
        "c".repeat(128)
    } else {
        "tab-last".into()
    };
    let closed_tab = json!({"id":closed_id,"type":"agent","sessionId":"session-closed","title":"关闭标签","workspaceId":workspace_id});
    let remaining = if keep_active_tab {
        vec![
            json!({"id":"tab-keep","type":"agent","sessionId":"session-keep","title":"保留标签","workspaceId":workspace_id}),
        ]
    } else {
        vec![]
    };
    let active_id = if keep_active_tab {
        json!("tab-keep")
    } else {
        Value::Null
    };
    let mut initial_tabs = remaining.clone();
    initial_tabs.push(closed_tab);
    update(
        &p,
        "before-close",
        0,
        json!({"tabState":{"tabs":initial_tabs,"activeTabId":if keep_active_tab { active_id.clone() } else { json!(closed_id) },"activeTabIdByWorkspace":{workspace_id:closed_id}}}),
    );
    let tab_state = json!({"tabs":remaining,"activeTabId":active_id,"activeTabIdByWorkspace":{workspace_id:closed_id}});
    let reply = p
        .invoke(req(
            "settings:update",
            json!([{"tabState":tab_state}]),
            Some(("after-close", 1)),
        ))
        .unwrap();
    assert_eq!(reply.revision, 2);
    assert_eq!(reply.value["tabState"], tab_state);
    assert_eq!(
        serde_json::to_value(reply.snapshot.unwrap()).unwrap()["settings"]["tabState"],
        tab_state
    );
    assert_eq!(read(&p, "settings:get", json!([]))["tabState"], tab_state);
    drop(p);
    let p = open(&root);
    let snapshot = serde_json::to_value(p.bootstrap().unwrap()).unwrap();
    assert_eq!(snapshot["revision"], 2);
    assert_eq!(snapshot["settings"]["tabState"], tab_state);
    assert_eq!(read(&p, "settings:get", json!([]))["tabState"], tab_state);
}
#[test]
fn workspace_tab_memory_rejects_malformed_ids_unknown_workspaces_and_excess_entries() {
    let (root, p) = setup();
    let initial = serde_json::to_value(p.bootstrap().unwrap()).unwrap();
    let mut invalid_memory = vec![
        json!({"unknown-workspace":"tab-closed"}),
        json!({"local-mock-workspace-id":"tab-closed","unknown-workspace":"tab-other"}),
    ];
    for id in [
        "".into(),
        "c".repeat(129),
        "../tab".into(),
        "tab/closed".into(),
        "标签".into(),
        "tab\nclosed".into(),
    ] {
        invalid_memory.push(json!({"local-mock-workspace-id":id}));
    }
    for memory in invalid_memory {
        assert_eq!(
            p.invoke(req(
                "settings:update",
                json!([{"tabState":{"tabs":[],"activeTabId":null,"activeTabIdByWorkspace":memory}}]),
                Some(("invalid-memory", 0)),
            ))
            .unwrap_err()
            .0,
            "invalidParams"
        );
    }
    assert_eq!(
        p.invoke(req(
            "settings:update",
            json!([{"tabState":{"tabs":[],"activeTabId":"tab-closed","activeTabIdByWorkspace":{"local-mock-workspace-id":"tab-closed"}}}]),
            Some(("invalid-active", 0)),
        ))
        .unwrap_err()
        .0,
        "invalidParams"
    );
    assert_eq!(
        serde_json::to_value(p.bootstrap().unwrap()).unwrap(),
        initial
    );
    drop(p);
    assert_eq!(
        serde_json::to_value(open(&root).bootstrap().unwrap()).unwrap(),
        initial
    );
}
#[test]
fn revision_and_mutation_identity_are_durable_and_conflicts_recover() {
    let (root, p) = setup();
    let request = req(
        "settings:update",
        json!([{"language":"zh"}]),
        Some(("same", 0)),
    );
    let first = p.invoke(request.clone()).unwrap();
    assert_eq!(p.invoke(request.clone()).unwrap().revision, first.revision);
    assert_eq!(
        p.invoke(req(
            "settings:update",
            json!([{"language":"en"}]),
            Some(("same", 0))
        ))
        .unwrap_err()
        .0,
        "mutationConflict"
    );
    assert_eq!(
        p.invoke(req(
            "settings:update",
            json!([{"theme":"dark"}]),
            Some(("stale", 0))
        ))
        .unwrap_err()
        .0,
        "revisionConflict"
    );
    update(&p, "next", 1, json!({"theme":"dark"}));
    drop(p);
    let p = open(&root);
    let replay = p.invoke(request).unwrap();
    assert_eq!(replay.revision, 2); // 返回当前事实，旧ack不得让缓存倒退。
    assert_eq!(replay.value["language"], "zh");
    assert_eq!(p.bootstrap().unwrap().revision, 2);
}
#[test]
fn rejects_unknown_channels_fields_model_bindings_paths_and_forged_host_facts() {
    let (_root, p) = setup();
    assert_eq!(
        p.invoke(req("fs:write", json!(["/tmp/escape"]), None))
            .unwrap_err()
            .0,
        "unsupported"
    );
    for patch in [
        json!({"endpoint":"http://evil"}),
        json!({"zoteroDataDir":"/Users/real"}),
        json!({"theme":"evil"}),
        json!({"agentChannelId":"foreign"}),
        json!({"agentModelId":"foreign"}),
        json!({"chrome":{"fullscreen":true}}),
        json!({"theme":"dark","unknown":true}),
        json!({"language":null}),
        json!({"agentEffort":"none"}),
        json!({"telemetryConsent":{"posthogEnabled":true,"agentEvolutionEnabled":false}}),
    ] {
        assert!(p
            .invoke(req("settings:update", json!([patch]), Some(("bad", 0))))
            .is_err());
    }
    assert!(p
        .invoke(req("agent:get-reasoning-effort", json!(["../real"]), None))
        .is_err());
    assert!(p
        .invoke(req(
            "agent:get-reasoning-effort",
            json!(["local-mock-workspace-id"]),
            None
        ))
        .is_err());
    assert!(p.invoke(req("settings:get", json!([{}]), None)).is_err());
    assert!(p
        .invoke(req("settings:update", json!([{"theme":"dark"}]), None))
        .is_err());
    assert!(p
        .invoke(req(
            "user-profile:update",
            json!([{"avatar":"file:///private/secret"}]),
            Some(("bad", 0))
        ))
        .is_err());
    assert_eq!(p.bootstrap().unwrap().revision, 0);
}
#[test]
fn writer_lock_and_write_failure_never_publish_uncommitted_cache() {
    let (root, p) = setup();
    assert!(FormalPlatform::open(
        &root,
        &local_mock_profiles("http://127.0.0.1:12345/v1/chat/completions").unwrap(),
        HostEnvironment::new("darwin", false, false).unwrap()
    )
    .is_err());
    let pending = root.path().join("formal-platform-v1/snapshot.pending");
    fs::create_dir(&pending).unwrap();
    assert!(p
        .invoke(req(
            "settings:update",
            json!([{"language":"zh"}]),
            Some(("retry", 0))
        ))
        .is_err());
    assert_eq!(read(&p, "settings:get", json!([]))["language"], "en");
    assert_eq!(p.bootstrap().unwrap().revision, 0);
    fs::remove_dir(&pending).unwrap();
    update(&p, "retry", 0, json!({"language":"zh"}));
    drop(p);
    assert_eq!(open(&root).bootstrap().unwrap().revision, 1);
}
#[test]
fn spotlight_transitions_are_guarded_and_persisted() {
    let (root, p) = setup();
    assert_eq!(
        read(&p, "onboarding-spotlight:bootstrap", json!([]))["currentStep"],
        "configure-llm"
    );
    let r = p
        .invoke(req(
            "onboarding-spotlight:advance",
            json!([{"from":"configure-llm","fromSubStage":0}]),
            Some(("advance", 0)),
        ))
        .unwrap();
    assert_eq!(r.value["currentSubStage"], 1);
    let r = p
        .invoke(req(
            "onboarding-spotlight:advance",
            json!([{"from":"configure-llm","fromSubStage":0}]),
            Some(("stale-step", 1)),
        ))
        .unwrap();
    assert_eq!(r.value["currentSubStage"], 1);
    p.invoke(req(
        "concept-spotlight:start",
        json!([{"tour":"paperNotes"}]),
        Some(("tour", 2)),
    ))
    .unwrap();
    p.invoke(req(
        "concept-spotlight:complete",
        json!([{"tour":"paperNotes"}]),
        Some(("complete", 3)),
    ))
    .unwrap();
    drop(p);
    let p = open(&root);
    assert_eq!(
        read(&p, "onboarding-spotlight:get", json!([]))["currentSubStage"],
        1
    );
    let tour = read(&p, "concept-spotlight:get-state", json!([]));
    assert_eq!(tour["paperNotes"]["status"], "completed");
    assert!(tour["paperNotes"]["finishedAt"].as_u64().unwrap() > 0);
}
#[test]
fn strict_root_marker_and_schema_fail_closed_without_overwrite() {
    let absent = path();
    fs::create_dir(&absent).unwrap();
    assert!(TrustedRoot::create_temporary(&absent).is_err());
    assert!(TrustedRoot::open_temporary(&absent).is_err());
    let (root, p) = setup();
    drop(p);
    let snapshot = root.path().join("formal-platform-v1/snapshot.json");
    let valid = fs::read(&snapshot).unwrap();
    for broken in [
        b"{broken".to_vec(),
        b"{\"version\":99}".to_vec(),
        {
            let mut v: Value = serde_json::from_slice(&valid).unwrap();
            v["extra"] = json!(true);
            serde_json::to_vec(&v).unwrap()
        },
        vec![b' '; 1024 * 1024 + 1],
    ] {
        fs::write(&snapshot, &broken).unwrap();
        assert!(FormalPlatform::open(
            &root,
            &local_mock_profiles("http://127.0.0.1:12345/v1/chat/completions").unwrap(),
            HostEnvironment::new("darwin", false, false).unwrap()
        )
        .is_err());
        assert_eq!(fs::read(&snapshot).unwrap(), broken);
    }
    fs::write(&snapshot, valid).unwrap();
    let marker = root.path().join("preview.json");
    fs::write(
        marker,
        json!({"kind":"tinker-rust-preview","version":1,"root":root.path()}).to_string(),
    )
    .unwrap();
    assert!(TrustedRoot::open_temporary(root.path()).is_err());
}
#[cfg(unix)]
#[test]
fn links_and_public_permissions_are_rejected() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    let (root, p) = setup();
    drop(p);
    let snapshot = root.path().join("formal-platform-v1/snapshot.json");
    let saved = root.path().join("saved.json");
    fs::rename(&snapshot, &saved).unwrap();
    symlink(&saved, &snapshot).unwrap();
    assert!(FormalPlatform::open(
        &root,
        &local_mock_profiles("http://127.0.0.1:12345/v1/chat/completions").unwrap(),
        HostEnvironment::new("darwin", false, false).unwrap()
    )
    .is_err());
    fs::remove_file(&snapshot).unwrap();
    fs::hard_link(&saved, &snapshot).unwrap();
    assert!(FormalPlatform::open(
        &root,
        &local_mock_profiles("http://127.0.0.1:12345/v1/chat/completions").unwrap(),
        HostEnvironment::new("darwin", false, false).unwrap()
    )
    .is_err());
    fs::remove_file(&snapshot).unwrap();
    fs::rename(&saved, &snapshot).unwrap();
    fs::set_permissions(&snapshot, fs::Permissions::from_mode(0o644)).unwrap();
    assert!(FormalPlatform::open(
        &root,
        &local_mock_profiles("http://127.0.0.1:12345/v1/chat/completions").unwrap(),
        HostEnvironment::new("darwin", false, false).unwrap()
    )
    .is_err());
}
#[test]
fn launch_profiles_only_accept_numeric_loopback_and_use_clear_synthetic_names() {
    for endpoint in [
        "https://example.com",
        "http://localhost:1234",
        "http://127.0.0.1:1234/?key=secret",
        "http://user:pass@127.0.0.1:1234",
    ] {
        assert!(local_mock_profiles(endpoint).is_err());
    }
    let p = local_mock_profiles("http://127.0.0.1:1234/v1/chat/completions").unwrap();
    assert!(p[0].label.contains("Local Mock"));
    assert!(p[0].models.iter().all(|m| m.label.contains("Local Mock")));
}
#[test]
fn concurrent_mutations_with_same_revision_have_one_durable_winner() {
    let (root, p) = setup();
    let p = std::sync::Arc::new(p);
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));
    let handles: Vec<_> = [("one", "zh"), ("two", "en")]
        .into_iter()
        .map(|(id, language)| {
            let p = p.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                p.invoke(req(
                    "settings:update",
                    json!([{"language":language}]),
                    Some((id, 0)),
                ))
            })
        })
        .collect();
    barrier.wait();
    let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
    assert!(results
        .iter()
        .any(|r| r.as_ref().err().is_some_and(|e| e.0 == "revisionConflict")));
    drop(p);
    assert_eq!(open(&root).bootstrap().unwrap().revision, 1);
}
#[test]
fn app_data_root_is_stable_private_and_cannot_claim_unmarked_directories() {
    use tinker_rust_foundation::formal_platform::{APPLICATION_ID, SYNTHETIC_PROFILE};
    let base = path();
    fs::create_dir(&base).unwrap();
    let parent = base.join(APPLICATION_ID);
    fs::create_dir(&parent).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&parent, fs::Permissions::from_mode(0o700)).unwrap();
    }
    let root = TrustedRoot::create_app_data(&parent).unwrap();
    assert_eq!(root.path(), parent.join(SYNTHETIC_PROFILE));
    let p = open(&root);
    update(&p, "appdata", 0, json!({"language":"zh"}));
    drop(p);
    let reopened = TrustedRoot::open_app_data(&parent).unwrap();
    assert_eq!(open(&reopened).bootstrap().unwrap().settings.language, "zh");
    assert!(TrustedRoot::create_app_data(&parent).is_err());
    assert!(TrustedRoot::open_app_data(&base).is_err());
}
#[test]
fn corrupt_receipt_arguments_are_rejected_on_restart() {
    let (root, p) = setup();
    update(&p, "receipt", 0, json!({"language":"zh"}));
    drop(p);
    let file = root.path().join("formal-platform-v1/snapshot.json");
    let mut state: Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
    state["receipts"]["receipt"]["request"]["args"] = json!([{"endpoint":"http://evil"}]);
    fs::write(file, serde_json::to_vec(&state).unwrap()).unwrap();
    assert!(FormalPlatform::open(
        &root,
        &local_mock_profiles("http://127.0.0.1:12345/v1/chat/completions").unwrap(),
        HostEnvironment::new("darwin", false, false).unwrap()
    )
    .is_err());
}
#[test]
fn profile_model_pairs_are_validated_against_host_registry() {
    let root = TrustedRoot::create_temporary(path()).unwrap();
    let mut profiles = local_mock_profiles("http://127.0.0.1:12345/v1/chat/completions").unwrap();
    let mut second = local_mock_profiles("http://127.0.0.1:23456/v1/chat/completions")
        .unwrap()
        .remove(0);
    second.profile_id = "different-profile".into();
    second.models.truncate(1);
    second.models[0].model_id = "different-model".into();
    profiles.push(second);
    let p = FormalPlatform::open(
        &root,
        &profiles,
        HostEnvironment::new("linux", false, false).unwrap(),
    )
    .unwrap();
    assert_eq!(
        p.invoke(req(
            "settings:update",
            json!([{"agentModelId":"different-model"}]),
            Some(("wrong-pair", 0))
        ))
        .unwrap_err()
        .0,
        "modelNotFound"
    );
    update(
        &p,
        "right-pair",
        0,
        json!({"agentChannelId":"different-profile","agentModelId":"different-model"}),
    );
    assert_eq!(
        read(&p, "settings:get", json!([]))["agentChannelId"],
        "different-profile"
    );
    assert_eq!(
        p.invoke(req(
            "agent:set-reasoning-effort",
            json!(["local-mock-workspace", "max"]),
            Some(("unsupported-effort", 1))
        ))
        .unwrap_err()
        .0,
        "unsupportedEffort"
    );
    drop(p);
    assert_eq!(
        FormalPlatform::open(
            &root,
            &profiles,
            HostEnvironment::new("linux", false, false).unwrap()
        )
        .unwrap()
        .bootstrap()
        .unwrap()
        .revision,
        1
    );
}
#[test]
fn platform_and_desktop_runtime_share_one_marked_root_without_competing_locks() {
    let (root, p) = setup();
    let runtime = tinker_rust_foundation::desktop_runtime::DesktopRuntime::open(
        root.path(),
        local_mock_profiles("http://127.0.0.1:12345/v1/chat/completions").unwrap(),
    )
    .unwrap();
    update(&p, "coexist", 0, json!({"language":"zh"}));
    drop(runtime);
    drop(p);
    assert_eq!(open(&root).bootstrap().unwrap().revision, 1);
}
#[test]
fn stale_private_pending_file_is_recovered_without_losing_committed_state() {
    let (root, p) = setup();
    update(&p, "before-crash", 0, json!({"theme":"dark"}));
    drop(p);
    let pending = root.path().join("formal-platform-v1/snapshot.pending");
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    use std::io::Write;
    options
        .open(&pending)
        .unwrap()
        .write_all(b"partial interrupted write")
        .unwrap();
    let p = open(&root);
    assert_eq!(p.bootstrap().unwrap().revision, 1);
    assert!(!pending.exists());
    update(&p, "after-crash", 1, json!({"language":"zh"}));
}
#[test]
fn wire_bounds_and_host_theme_updates_keep_renderer_authority_narrow() {
    let (_root, p) = setup();
    assert!(serde_json::from_value::<PlatformRequest>(
        json!({"version":1,"channel":"settings:get","args":[],"root":"/Users/real"})
    )
    .is_err());
    assert!(p
        .invoke(req(
            "settings:update",
            json!([{"tabState":{"tabs":[],"activeTabId":null,"file":"/Users/real"}}]),
            Some(("invalid-tab", 0))
        ))
        .is_err());
    assert!(p
        .invoke(req(
            "user-profile:update",
            json!([{"userName":"x".repeat(128*1024)}]),
            Some(("large", 0))
        ))
        .is_err());
    assert_eq!(read(&p, "theme:resolve", json!([]))["isDark"], true);
    p.set_host_environment(HostEnvironment::new("darwin", false, true).unwrap())
        .unwrap();
    assert_eq!(read(&p, "theme:resolve", json!([]))["isDark"], false);
    assert_eq!(
        read(&p, "window:chrome-state", json!([]))["fullscreen"],
        true
    );
    assert_eq!(p.bootstrap().unwrap().revision, 0);
    assert_eq!(
        p.invoke(req(
            "settings:update-sync",
            json!([{"theme":"dark"}]),
            Some(("sync-write", 0))
        ))
        .unwrap()
        .value,
        true
    );
}

#[test]
fn session_drafts_are_bounded_secret_checked_atomic_and_compatible_with_old_snapshots() {
    use tinker_rust_foundation::formal_platform::MOCK_KEY;
    let (root, p) = setup();
    let file = root.path().join("formal-platform-v1/snapshot.json");
    let before = fs::read(&file).unwrap();
    for (index, drafts) in [
        json!({"session-a":MOCK_KEY}),
        json!({"session-a":"x".repeat(65536)}),
    ]
    .into_iter()
    .enumerate()
    {
        assert!(p
            .invoke(req(
                "settings:update",
                json!([{"sessionDrafts":drafts}]),
                Some((&format!("bad-draft-{index}"), 0))
            ))
            .is_err());
        assert_eq!(fs::read(&file).unwrap(), before);
        assert_eq!(p.bootstrap().unwrap().revision, 0);
    }
    let drafts = json!({"session-a":"last native draft café 你好"});
    update(&p, "good-draft", 0, json!({"sessionDrafts":drafts}));
    drop(p);
    let p = open(&root);
    assert_eq!(
        serde_json::to_value(p.bootstrap().unwrap()).unwrap()["settings"]["sessionDrafts"],
        drafts
    );
    drop(p);
    let mut legacy: Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
    legacy["settings"]
        .as_object_mut()
        .unwrap()
        .remove("sessionDrafts");
    fs::write(&file, serde_json::to_vec(&legacy).unwrap()).unwrap();
    let p = open(&root);
    assert!(
        serde_json::to_value(p.bootstrap().unwrap()).unwrap()["settings"]
            .get("sessionDrafts")
            .is_none()
    );
}

#[test]
fn near_limit_draft_autosaves_compact_receipts_preserving_retry_conflict_and_legacy_reopen() {
    let (root, p) = setup();
    let mut requests = Vec::new();
    for index in 0..32 {
        let text = format!("draft-{index} {}", "x".repeat(59000));
        let request = req(
            "settings:update",
            json!([{"language":"en","sessionDrafts":{"session-a":text,"session-b":"second nested key"}}]),
            Some((&format!("autosave-{index}"), index)),
        );
        let reply = p.invoke(request.clone()).unwrap();
        assert_eq!(reply.revision, index + 1);
        requests.push(request);
    }
    fn reversed_json(value: &Value) -> String {
        match value {
            Value::Object(fields) => format!(
                "{{{}}}",
                fields
                    .iter()
                    .rev()
                    .map(|(key, value)| format!(
                        "{}:{}",
                        serde_json::to_string(key).unwrap(),
                        reversed_json(value)
                    ))
                    .collect::<Vec<_>>()
                    .join(",")
            ),
            Value::Array(items) => format!(
                "[{}]",
                items
                    .iter()
                    .map(reversed_json)
                    .collect::<Vec<_>>()
                    .join(",")
            ),
            _ => serde_json::to_string(value).unwrap(),
        }
    }
    let reordered: PlatformRequest =
        serde_json::from_str(&reversed_json(&serde_json::to_value(&requests[0]).unwrap())).unwrap();
    assert_eq!(reordered, requests[0]);
    assert_eq!(p.invoke(reordered).unwrap().revision, 32);
    assert_eq!(p.invoke(requests[0].clone()).unwrap().revision, 32);
    let mut conflict = requests[0].clone();
    conflict.args[0]["sessionDrafts"]["session-a"] = json!("different draft same mutation");
    assert_eq!(
        p.invoke(conflict.clone()).unwrap_err().0,
        "mutationConflict"
    );
    drop(p);
    let file = root.path().join("formal-platform-v1/snapshot.json");
    assert!(fs::metadata(&file).unwrap().len() < 300000);
    // 旧完整receipt同样可读、可重试；下一次提交将它转换为摘要receipt。
    let mut legacy: Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
    legacy["receipts"]["autosave-0"]
        .as_object_mut()
        .unwrap()
        .remove("requestDigest");
    legacy["receipts"]["autosave-0"]["request"] = serde_json::to_value(&requests[0]).unwrap();
    fs::write(&file, serde_json::to_vec(&legacy).unwrap()).unwrap();
    let p = open(&root);
    assert_eq!(p.invoke(requests[0].clone()).unwrap().revision, 32);
    assert_eq!(p.invoke(conflict).unwrap_err().0, "mutationConflict");
    let last = req(
        "settings:update",
        json!([{"sessionDrafts":{"session-a":"final close draft café 你好"}}]),
        Some(("close-latest", 32)),
    );
    assert_eq!(p.invoke(last.clone()).unwrap().revision, 33);
    assert_eq!(p.invoke(last).unwrap().revision, 33);
    drop(p);
    let p = open(&root);
    assert_eq!(
        serde_json::to_value(p.bootstrap().unwrap()).unwrap()["settings"]["sessionDrafts"]
            ["session-a"],
        "final close draft café 你好"
    );
    let bytes = fs::read_to_string(file).unwrap();
    assert!(!bytes.contains("draft-0 "));
    assert!(bytes.len() < 300000);
}
