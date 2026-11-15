use serde_json::json;
use tinker_rust_foundation::desktop_runtime::DesktopRuntime;
#[path = "support/desktop.rs"]
mod support;
use support::*;
#[test]
fn v2_text_history_and_pending_are_explicit_and_strict() {
    let f = Fixture::new();
    let r = DesktopRuntime::open(&f.0, profiles()).unwrap();
    let sid = create(&r, false)["result"]["sessionId"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(
        call(
            &r,
            "sessions.historyV2",
            json!({"sessionId":sid,"after":0,"limit":1})
        )["result"]["turns"],
        json!([])
    );
    assert_eq!(
        call(&r, "chat.pendingPermissions", json!({"sessionId":null}))["result"],
        json!({"permissions":[]})
    );
    assert_eq!(
        call(
            &r,
            "chat.permissionRespond",
            json!({"sessionId":sid,"runId":"request","permissionId":"p-request-0","behavior":"allow","alwaysAllow":true})
        )["error"]["code"],
        "unsupported"
    );
}

#[test]
fn trusted_tools_wait_allow_restore_and_reject_text_parent_before_bind() {
    use std::{
        sync::Arc,
        time::{Duration, Instant},
    };
    use tinker_rust_foundation::{
        desktop_runtime::TrustedToolBinding,
        formal_mock::OwnedMock,
        formal_platform::TrustedRoot,
        synthetic_workspace::SyntheticWorkspace,
        tool_types::{ToolExecutor, ToolRunOptions},
    };
    let path = std::env::temp_dir().canonicalize().unwrap().join(format!(
        "tinker-tauri-tools-preview-runtime-{}",
        std::process::id()
    ));
    let root = TrustedRoot::create_tools_temporary(&path).unwrap();
    let mut mock = OwnedMock::start_tools().unwrap();
    let executor = Arc::new(SyntheticWorkspace::create(&root).unwrap());
    let binding = TrustedToolBinding {
        profile_id: "local-tools-mock".into(),
        options: ToolRunOptions::new(
            executor.workspace_revision().into(),
            Duration::from_secs(60),
            Duration::from_secs(120),
        )
        .unwrap(),
        executor,
    };
    let mut ps = mock.profiles().unwrap();
    ps.extend(profiles());
    let r = DesktopRuntime::open_with_tools(root.path(), ps, vec![binding]).unwrap();
    let sid = call(&r,"sessions.create",json!({"title":"tools","profileId":"local-tools-mock","workspaceId":null,"reuseDraft":false}))["result"]["sessionId"].as_str().unwrap().to_owned();
    let mut p = send_params(&sid);
    p["profileId"] = json!("local-tools-mock");
    p["modelId"] = json!("local-tools-mock");
    assert!(call(&r, "chat.send", p.clone())["error"].is_null());
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut receipts = vec![];
    loop {
        let page = call(
            &r,
            "chat.eventsV2",
            json!({"sessionId":sid,"requestId":"request","afterSequence":0,"limit":256}),
        );
        assert!(page["error"].is_null(), "{page}");
        let turn = &page["result"]["turn"];
        if turn["status"] == "completed" {
            assert!(turn["assistantMessage"].as_str().unwrap().contains("café"));
            break;
        }
        if let Some(pid) = turn["toolState"]["pending"]["permissionId"].as_str() {
            let response = json!({"sessionId":sid,"runId":"request","permissionId":pid,"behavior":"allow","alwaysAllow":false});
            let receipt = call(&r, "chat.permissionRespond", response.clone());
            assert!(receipt["error"].is_null(), "{receipt}");
            assert_eq!(
                call(&r, "chat.permissionRespond", response.clone()),
                receipt
            );
            receipts.push(response);
        }
        assert!(Instant::now() < deadline, "{page}");
        std::thread::sleep(Duration::from_millis(5));
    }
    assert_eq!(mock.records().len(), 3);
    assert!(call(&r, "chat.send", p)["error"].is_null());
    assert_eq!(mock.records().len(), 3);
    assert_eq!(
        call(
            &r,
            "sessions.history",
            json!({"sessionId":sid,"after":0,"limit":128})
        )["error"]["code"],
        "unsupportedVersion"
    );
    let mut text = send_params(&sid);
    text["requestId"] = json!("text-child");
    assert_eq!(
        call(&r, "chat.send", text)["error"]["code"],
        "contextUnsupported"
    );
    assert_eq!(
        call(
            &r,
            "sessions.historyV2",
            json!({"sessionId":sid,"after":0,"limit":128})
        )["result"]["turns"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert!(call(&r, "chat.permissionRespond", receipts[0].clone())["error"].is_null());
    let mut follow = send_params(&sid);
    follow["requestId"] = json!("followup");
    follow["profileId"] = json!("local-tools-mock");
    follow["modelId"] = json!("local-tools-mock");
    assert!(call(&r, "chat.send", follow)["error"].is_null());
    loop {
        let page = call(
            &r,
            "chat.eventsV2",
            json!({"sessionId":sid,"requestId":"followup","afterSequence":0,"limit":256}),
        );
        let turn = &page["result"]["turn"];
        if turn["status"] == "completed" {
            break;
        }
        if let Some(pid) = turn["toolState"]["pending"]["permissionId"].as_str() {
            assert!(call(&r,"chat.permissionRespond",json!({"sessionId":sid,"runId":"followup","permissionId":pid,"behavior":"allow","alwaysAllow":false}))["error"].is_null());
        }
        assert!(Instant::now() < deadline, "{page}");
        std::thread::sleep(Duration::from_millis(5));
    }
    assert_eq!(mock.records().len(), 6);
    assert_eq!(mock.records()[3].user_messages, 2);
    assert_eq!(mock.records()[3].assistant_messages, 3);
    assert!(call(&r, "chat.permissionRespond", receipts[0].clone())["error"].is_null());
    drop(r);
    mock.shutdown();
    std::fs::remove_dir_all(path).unwrap();
}

#[test]
fn denied_expired_cancelled_deleted_and_restart_never_execute() {
    use std::{
        sync::{
            atomic::{AtomicBool, AtomicUsize, Ordering},
            Arc,
        },
        time::{Duration, Instant},
    };
    use tinker_rust_foundation::{
        desktop_runtime::TrustedToolBinding, formal_mock::OwnedMock, formal_platform::TrustedRoot,
        run_types::RunError, synthetic_workspace::SyntheticWorkspace, tool_types::*,
    };
    struct Count {
        inner: SyntheticWorkspace,
        calls: AtomicUsize,
    }
    impl ToolExecutor for Count {
        fn workspace_revision(&self) -> &str {
            self.inner.workspace_revision()
        }
        fn catalog(&self) -> Vec<ToolSpec> {
            self.inner.catalog()
        }
        fn execute(&self, c: &ToolCall, x: &AtomicBool) -> Result<ToolResult, RunError> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.inner.execute(c, x)
        }
    }
    for mode in ["deny", "expire", "cancel", "delete", "restart", "preflight"] {
        let path = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "tinker-tauri-tools-preview-{mode}-{}",
            std::process::id()
        ));
        let root = TrustedRoot::create_tools_temporary(&path).unwrap();
        let mut mock = OwnedMock::start_tools().unwrap();
        let executor = Arc::new(Count {
            inner: SyntheticWorkspace::create(&root).unwrap(),
            calls: AtomicUsize::new(0),
        });
        let bindings = || {
            vec![TrustedToolBinding {
                profile_id: "local-tools-mock".into(),
                executor: executor.clone(),
                options: ToolRunOptions::new(
                    executor.workspace_revision().into(),
                    Duration::from_millis(if mode == "expire" { 100 } else { 60000 }),
                    Duration::from_secs(120),
                )
                .unwrap(),
            }]
        };
        let r = DesktopRuntime::open_with_tools(root.path(), mock.profiles().unwrap(), bindings())
            .unwrap();
        let sid=call(&r,"sessions.create",json!({"title":"tools","profileId":"local-tools-mock","workspaceId":null,"reuseDraft":false}))["result"]["sessionId"].as_str().unwrap().to_owned();
        let mut p = send_params(&sid);
        p["profileId"] = json!("local-tools-mock");
        p["modelId"] = json!("local-tools-mock");
        assert!(call(&r, "chat.send", p)["error"].is_null());
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let v = call(&r, "chat.pendingPermissions", json!({"sessionId":sid}));
            if v["result"]["permissions"].as_array().unwrap().len() == 1 {
                break;
            }
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(2));
        }
        let reply = json!({"sessionId":sid,"runId":"request","permissionId":"p-request-0","behavior":"allow","alwaysAllow":false});
        let mut wrong = reply.clone();
        wrong["runId"] = json!("wrong");
        assert_eq!(
            call(&r, "chat.permissionRespond", wrong)["error"]["code"],
            "requestNotFound"
        );
        if mode == "deny" {
            let mut deny = reply.clone();
            deny["behavior"] = json!("deny");
            assert!(call(&r, "chat.permissionRespond", deny)["error"].is_null());
        }
        if mode == "cancel" {
            assert!(call(
                &r,
                "chat.cancel",
                json!({"sessionId":sid,"requestId":"request"})
            )["error"]
                .is_null());
        }
        if mode == "delete" {
            assert!(call(&r, "sessions.delete", json!({"sessionId":sid}))["error"].is_null());
        }
        if matches!(mode, "deny" | "expire") {
            loop {
                let v = call(
                    &r,
                    "chat.eventsV2",
                    json!({"sessionId":sid,"requestId":"request","afterSequence":0,"limit":256}),
                );
                if v["result"]["turn"]["status"] == "completed" {
                    break;
                }
                assert!(Instant::now() < deadline, "{v}");
                std::thread::sleep(Duration::from_millis(2));
            }
        }
        let logfile = path
            .join("desktop-runtime-v1")
            .join(&sid)
            .join("runs-v1/tools-v3/request.jsonl");
        let waiting = std::fs::read(&logfile).unwrap();
        if mode == "preflight" {
            let sid2=call(&r,"sessions.create",json!({"title":"tools","profileId":"local-tools-mock","workspaceId":null,"reuseDraft":false}))["result"]["sessionId"].as_str().unwrap().to_owned();
            let mut p2 = send_params(&sid2);
            p2["requestId"] = json!("other");
            p2["profileId"] = json!("local-tools-mock");
            p2["modelId"] = json!("local-tools-mock");
            call(&r, "chat.send", p2);
            loop {
                let v = call(&r, "chat.pendingPermissions", json!({"sessionId":sid2}));
                if v["result"]["permissions"].as_array().unwrap().len() == 1 {
                    break;
                }
                assert!(Instant::now() < deadline);
                std::thread::sleep(Duration::from_millis(2));
            }
            drop(r);
            // 模拟持久崩溃：首 session 等待日志完整，第二 session 末行 torn。
            std::fs::write(&logfile, &waiting).unwrap();
            let second = path
                .join("desktop-runtime-v1")
                .join(sid2)
                .join("runs-v1/tools-v3/other.jsonl");
            use std::io::Write;
            std::fs::OpenOptions::new()
                .append(true)
                .open(second)
                .unwrap()
                .write_all(b"{\"version\":")
                .unwrap();
            assert!(DesktopRuntime::open_with_tools(
                root.path(),
                mock.profiles().unwrap(),
                bindings()
            )
            .is_err());
            assert_eq!(
                std::fs::read(&logfile).unwrap(),
                waiting,
                "preflight must cover all sessions before recovery"
            );
        } else {
            if !matches!(mode, "restart") {
                assert!(!call(&r, "chat.permissionRespond", reply.clone())["error"].is_null());
            }
            drop(r);
            if mode == "restart" {
                std::fs::write(&logfile, &waiting).unwrap();
            }
            let count = mock.records().len();
            let r =
                DesktopRuntime::open_with_tools(root.path(), mock.profiles().unwrap(), bindings())
                    .unwrap();
            assert!(!call(&r, "chat.permissionRespond", reply)["error"].is_null());
            assert_eq!(
                call(&r, "chat.pendingPermissions", json!({"sessionId":null}))["result"]
                    ["permissions"],
                json!([])
            );
            assert_eq!(mock.records().len(), count);
            drop(r);
        }
        assert_eq!(executor.calls.load(Ordering::SeqCst), 0, "{mode}");
        mock.shutdown();
        std::fs::remove_dir_all(path).unwrap();
    }
}

#[test]
fn text_send_and_cancel_keep_legacy_turn_shape() {
    let f = Fixture::new();
    let r = DesktopRuntime::open(&f.0, profiles()).unwrap();
    let sid = create(&r, false)["result"]["sessionId"]
        .as_str()
        .unwrap()
        .to_owned();
    let sent = call(&r, "chat.send", send_params(&sid));
    assert!(sent["result"].get("toolState").is_none());
    let cancelled = call(
        &r,
        "chat.cancel",
        json!({"sessionId":sid,"requestId":"request"}),
    );
    assert!(cancelled["result"].get("toolState").is_none());
}
