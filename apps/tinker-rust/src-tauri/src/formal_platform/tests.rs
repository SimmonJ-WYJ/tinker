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
