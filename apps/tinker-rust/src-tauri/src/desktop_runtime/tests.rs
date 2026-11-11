//! 可控目录同步故障；不暴露renderer测试开关。
use super::*;
use std::{
    fs,
    net::TcpListener,
    sync::atomic::{AtomicU64, Ordering},
};
static NEXT: AtomicU64 = AtomicU64::new(0);
#[test]
fn directory_sync_failure_never_commits_session_or_calls_provider() {
    for fail_at in 0..4 {
        let root = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "desktop-sync-fault-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let profiles = || {
            vec![TrustedProfile {
                profile_id: "local".into(),
                label: "Fixture".into(),
                config_revision: "r1".into(),
                models: vec![Model {
                    model_id: "model".into(),
                    label: "Model".into(),
                    supported_efforts: Vec::new(),
                }],
                endpoint: format!("http://{}/chat", listener.local_addr().unwrap()),
                key: "fake-secret".into(),
                protocol: crate::chat_http::HttpProtocol::OpenaiChat,
            }]
        };
        let runtime = DesktopRuntime::open(&root, profiles()).unwrap();
        let calls = std::cell::Cell::new(0);
        let result = runtime.inner.lock().unwrap().create_with_sync(
            Create {
                title: "x".into(),
                profile_id: "local".into(),
                workspace_id: None,
                reuse_draft: false,
            },
            |path| {
                let n = calls.get();
                calls.set(n + 1);
                if n == fail_at {
                    Err(DesktopError("storeIo"))
                } else {
                    store::sync_directory(path)
                }
            },
        );
        assert_eq!(result, Err(DesktopError("storeIo")));
        let send=runtime.dispatch(json!({"version":1,"id":"wire","method":"chat.send","params":{"sessionId":"session-1","requestId":"request","profileId":"local","modelId":"model","userMessage":"synthetic","startedAt":123,"effort":null}})).unwrap();
        assert_eq!(send.error.unwrap().code, "sessionNotFound");
        assert!(listener.accept().is_err());
        assert_eq!(
            fs::read(root.join("desktop-runtime-v1/journal.jsonl")).unwrap(),
            b""
        );
        drop(runtime);
        let runtime = DesktopRuntime::open(&root, profiles()).unwrap();
        let created=runtime.dispatch(json!({"version":1,"id":"create","method":"sessions.create","params":{"title":"after-restart","profileId":"local","workspaceId":null,"reuseDraft":false}})).unwrap();
        assert!(created.result.is_some());
        drop(runtime);
        fs::remove_dir_all(root).unwrap();
    }
}
#[test]
fn event_snapshot_advancing_after_empty_read_keeps_poll_cursor() {
    let turn = Turn {
        session_id: "session".into(),
        request_id: "request".into(),
        run_id: "request".into(),
        user_message_id: "u".into(),
        assistant_message_id: "a".into(),
        profile_id: "local".into(),
        model_id: "model".into(),
        config_revision: "r1".into(),
        effort: None,
        started_at: 123,
        user_message: "hello".into(),
        assistant_message: "new delta".into(),
        status: crate::session_lifecycle::RunStatus::Running,
        sequence: 2,
        error_code: None,
    };
    let page = execution::finish_page(turn, Vec::new(), 1, false, 1).unwrap();
    assert_eq!(page["nextAfterSequence"], 1);
    assert_eq!(page["hasMore"], true);
}
#[test]
fn startup_root_sync_failure_retries_root_and_parent_before_namespace() {
    for fail_at in 0..2 {
        let root = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "desktop-root-sync-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        let parent = root.parent().unwrap().to_path_buf();
        let calls = std::cell::RefCell::new(Vec::new());
        let first = store::Journal::open_with_sync(&root, |path| {
            let index = calls.borrow().len();
            calls.borrow_mut().push(path.to_path_buf());
            if index == fail_at {
                Err(DesktopError("storeIo"))
            } else {
                store::sync_directory(path)
            }
        });
        assert!(matches!(first, Err(DesktopError("storeIo"))));
        assert!(!root.join("desktop-runtime-v1").exists());
        calls.borrow_mut().clear();
        let (journal, _) = store::Journal::open_with_sync(&root, |path| {
            calls.borrow_mut().push(path.to_path_buf());
            store::sync_directory(path)
        })
        .unwrap();
        assert_eq!(*calls.borrow(), vec![root.clone(), parent.clone()]);
        drop(journal);
        // 已有namespace的下一次启动也必须确认相同两级，不依赖missing列表。
        calls.borrow_mut().clear();
        let (journal, _) = store::Journal::open_with_sync(&root, |path| {
            calls.borrow_mut().push(path.to_path_buf());
            store::sync_directory(path)
        })
        .unwrap();
        assert_eq!(*calls.borrow(), vec![root.clone(), parent]);
        drop(journal);
        fs::remove_dir_all(root).unwrap();
    }
}
