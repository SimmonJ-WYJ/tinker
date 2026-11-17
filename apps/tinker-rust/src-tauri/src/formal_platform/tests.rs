//! 门面故障注入仅在本模块测试中可达，产品IPC无故障注入入口。
use super::*;
#[test]
fn directory_sync_failure_never_acknowledges_and_requires_restart() {
    let path = std::fs::canonicalize(std::env::temp_dir())
        .unwrap()
        .join(format!(
            "tinker-tauri-formal-preview-sync-{}",
            std::process::id()
        ));
    let root = TrustedRoot::create_temporary(path).unwrap();
    let profiles = local_mock_profiles("http://127.0.0.1:23456/v1/chat/completions").unwrap();
    let environment = HostEnvironment::new("darwin", false, false).unwrap();
    let p = FormalPlatform::open(&root, &profiles, environment.clone()).unwrap();
    p.inner.lock().unwrap().store.fail_after_rename = true;
    let req:PlatformRequest=serde_json::from_value(json!({"version":1,"channel":"settings:update","args":[{"language":"zh"}],"mutation":{"mutationId":"sync-fault","expectedRevision":0}})).unwrap();
    assert_eq!(p.invoke(req.clone()).unwrap_err().0, "storeIo");
    assert_eq!(p.bootstrap().unwrap().revision, 0);
    assert_eq!(p.bootstrap().unwrap().settings.language, "en");
    assert_eq!(p.invoke(req.clone()).unwrap_err().0, "recoveryRequired");
    drop(p);
    let p = FormalPlatform::open(&root, &profiles, environment).unwrap();
    assert_eq!(p.bootstrap().unwrap().revision, 1);
    assert_eq!(p.invoke(req).unwrap().revision, 1);
}

#[test]
fn channel_uncertain_write_keeps_cache_and_recovers_once() {
    let path = std::env::temp_dir().canonicalize().unwrap().join(format!(
        "tinker-tauri-formal-preview-channel-sync-{}",
        std::process::id()
    ));
    let root = TrustedRoot::create_temporary(path).unwrap();
    let profiles = local_mock_profiles("http://127.0.0.1:23456/v1/chat/completions").unwrap();
    let env = HostEnvironment::new("darwin", false, false).unwrap();
    let p = FormalPlatform::open(&root, &profiles, env.clone()).unwrap();
    p.inner.lock().unwrap().store.fail_after_rename = true;
    let r:PlatformRequest=serde_json::from_value(json!({"version":1,"channel":"channel:update","args":["local-mock",{"enabled":false}],"mutation":{"mutationId":"channel-sync","expectedRevision":0}})).unwrap();
    assert_eq!(p.invoke(r.clone()).unwrap_err().0, "storeIo");
    assert_eq!(p.bootstrap().unwrap().revision, 0);
    assert_eq!(p.channels().unwrap()[0]["enabled"], true);
    assert_eq!(p.invoke(r.clone()).unwrap_err().0, "recoveryRequired");
    drop(p);
    let p = FormalPlatform::open(&root, &profiles, env).unwrap();
    assert_eq!(p.invoke(r).unwrap().revision, 1);
    assert_eq!(p.channels().unwrap()[0]["enabled"], false);
}
#[test]
fn channel_replay_detects_tampering_without_invalidating_compacted_drafts() {
    let path = std::env::temp_dir().canonicalize().unwrap().join(format!(
        "tinker-tauri-formal-preview-channel-replay-{}",
        std::process::id()
    ));
    let root = TrustedRoot::create_temporary(path).unwrap();
    let profiles = local_mock_profiles("http://127.0.0.1:23456/v1/chat/completions").unwrap();
    let env = HostEnvironment::new("darwin", false, false).unwrap();
    let p = FormalPlatform::open(&root, &profiles, env.clone()).unwrap();
    for (i, channel, args) in [
        (
            0,
            "settings:update",
            json!([{"sessionDrafts":{"session":"durable draft"}}]),
        ),
        (1, "channel:update", json!(["local-mock",{"name":"Alias"}])),
    ] {
        p.invoke(PlatformRequest {
            version: 1,
            channel: channel.into(),
            args: args.as_array().unwrap().clone(),
            mutation: Some(Mutation {
                mutation_id: format!("m-{i}"),
                expected_revision: i,
            }),
        })
        .unwrap();
    }
    drop(p);
    let p = FormalPlatform::open(&root, &profiles, env.clone()).unwrap();
    assert_eq!(
        p.bootstrap().unwrap().settings.session_drafts["session"],
        "durable draft"
    );
    drop(p);
    let file = root.path().join("formal-platform-v1/snapshot.json");
    let mut value: Value = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
    value["channelOverlay"]["channels"][0]["name"] = json!("Tampered");
    let bytes = serde_json::to_vec(&value).unwrap();
    std::fs::write(&file, &bytes).unwrap();
    assert!(FormalPlatform::open(&root, &profiles, env).is_err());
    assert_eq!(std::fs::read(file).unwrap(), bytes);
}
