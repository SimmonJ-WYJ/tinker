#[cfg(feature = "formal-native-qa")]
#[path = "support/http.rs"]
mod http;
// 原调用契约必须支持由用户配置的独立渠道根。
use tinker_rust_foundation::{
    formal_host::FormalHost,
    formal_platform::{HostEnvironment, TrustedRoot},
};
#[test]
fn user_channel_host_opens_without_synthetic_profiles() {
    let path = std::env::temp_dir().canonicalize().unwrap().join(format!(
        "tinker-tauri-channels-preview-host-red-{}",
        std::process::id()
    ));
    let root = TrustedRoot::create_channels_temporary(path).unwrap();
    let host =
        FormalHost::open_channels(&root, HostEnvironment::new("darwin", false, false).unwrap());
    assert!(host.is_ok(), "credentialed root must have an actual host");
}

#[cfg(feature = "formal-native-qa")]
mod owned {
    use super::http;
    use super::*;
    use serde_json::{json, Value};
    use std::{
        io::Write,
        net::TcpListener,
        sync::{
            atomic::{AtomicBool, AtomicU64, Ordering},
            Arc, Mutex,
        },
        thread,
        time::Duration,
    };
    use tinker_rust_foundation::credentialed_channels::{
        catalog::EndpointPolicy,
        vault_fake::{FakeVault, QA_SECRET_ONE, QA_SECRET_TWO},
    };
    static NEXT: AtomicU64 = AtomicU64::new(0);
    struct Fixture {
        root: TrustedRoot,
        policy: EndpointPolicy,
        base: String,
        records: Arc<Mutex<Vec<Vec<u8>>>>,
        cancel: Arc<AtomicBool>,
        worker: Option<thread::JoinHandle<()>>,
        mode: Arc<AtomicU64>,
    }
    impl Fixture {
        fn new() -> Self {
            let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            listener.set_nonblocking(true).unwrap();
            let base = format!("http://{}/v1", listener.local_addr().unwrap());
            let policy = EndpointPolicy::owned_qa(&listener, "/v1").unwrap();
            let path = std::env::temp_dir().canonicalize().unwrap().join(format!(
                "tinker-tauri-channels-preview-chain-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            let root = TrustedRoot::create_channels_temporary(path).unwrap();
            let dir = root.path().join("qa-vault");
            std::fs::create_dir(&dir).unwrap();
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).unwrap();
            let records = Arc::new(Mutex::new(Vec::new()));
            let out = records.clone();
            let cancel = Arc::new(AtomicBool::new(false));
            let stop = cancel.clone();
            let mode = Arc::new(AtomicU64::new(0));
            let response_mode = mode.clone();
            let worker = thread::spawn(move || {
                while !stop.load(Ordering::Acquire) {
                    match listener.accept() {
                        Ok((mut stream, _)) => {
                            stream.set_nonblocking(false).unwrap();
                            let bytes = http::read_request(&mut stream);
                            let request = String::from_utf8(bytes.clone()).unwrap();
                            out.lock().unwrap().push(bytes);
                            if request.starts_with("GET /v1/models ") {
                                match response_mode.load(Ordering::Acquire) {
                                    1 => {
                                        let _=write!(stream,"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/v1/models\r\nContent-Length: 0\r\n\r\n");
                                        continue;
                                    }
                                    2 => thread::sleep(Duration::from_millis(2200)),
                                    _ => {}
                                }
                                let body = r#"{"data":[{"id":"model","display_name":"Model"}]}"#;
                                let _=write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());
                                continue;
                            }
                            if request.contains("failure") {
                                let _=write!(stream,"HTTP/1.1 503 Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                                continue;
                            }
                            let anthropic = request.starts_with("POST /v1/messages ");
                            let body = if anthropic {
                                "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"msg-1\",\"type\":\"message\",\"role\":\"assistant\",\"content\":[],\"model\":\"model\",\"stop_reason\":null}}\n\nevent: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\nevent: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"owned answer\"}}\n\nevent: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":0}\n\nevent: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"}}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"
                            } else {
                                "data: {\"choices\":[{\"delta\":{\"content\":\"owned answer\"},\"finish_reason\":null}]}\n\ndata: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n"
                            };
                            let echo;
                            let body = if request.contains("disconnect") {
                                "data: {\"choices\":[{\"delta\":{\"content\":\"owned partial\"},\"finish_reason\":null}]}\n\n"
                            } else if request.contains("echo-other") {
                                echo="data: {\"choices\":[{\"delta\":{\"content\":\"安全🙂 tinker-qa-\"},\"finish_reason\":null}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"finite-key-two\"},\"finish_reason\":null}]}\n\ndata: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n".to_string();
                                echo.as_str()
                            } else {
                                body
                            };
                            let _=write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());
                        }
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                            thread::sleep(Duration::from_millis(2))
                        }
                        Err(_) => break,
                    }
                }
            });
            Self {
                root,
                policy,
                base,
                records,
                cancel,
                worker: Some(worker),
                mode,
            }
        }
        fn open(&self) -> FormalHost {
            FormalHost::open_channels_qa(
                &self.root,
                HostEnvironment::new("darwin", false, false).unwrap(),
                self.policy.clone(),
                FakeVault::open(self.root.path().join("qa-vault")).unwrap(),
            )
            .unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            self.cancel.store(true, Ordering::Release);
            if let Some(w) = self.worker.take() {
                let result = w.join();
                if !std::thread::panicking() {
                    result.unwrap();
                }
            }
        }
    }
    fn call(h: &FormalHost, v: Value) -> Result<Value, String> {
        h.command("main", v)
            .map_err(|e| e.0.to_string())?
            .wait(Duration::from_secs(8))
            .map_err(|e| e.0.to_string())
    }
    fn boot(h: &FormalHost) -> String {
        call(h, json!({"command":"bootstrap"})).unwrap()["generation"]
            .as_str()
            .unwrap()
            .into()
    }
    fn invoke(h: &FormalHost, g: &str, c: &str, args: Value) -> Result<Value, String> {
        call(
            h,
            json!({"command":"invoke","generation":g,"channel":c,"args":args}),
        )
        .map(|v| v["value"].clone())
    }
    fn request(f: &Fixture, protocol: &str, revision: u64, id: &str) -> Value {
        json!({"version":1,"channel":if revision==0{"channel:create"}else{"channel:update"},"args":[{"channel":{"id":"user-channel","name":"Owned channel","protocol":protocol,"baseUrl":f.base,"enabled":true,"models":[{"modelId":"model","label":"Model","enabled":true}]},"credential":"keep"}],"mutation":{"mutationId":id,"expectedRevision":revision}})
    }
    fn commit(h: &FormalHost, g: &str, r: Value) -> Result<Value, String> {
        call(
            h,
            json!({"command":"invoke","generation":g,"channel":r["channel"],"args":r["args"],"mutation":r["mutation"]}),
        )
    }
    fn save(f: &Fixture, h: &FormalHost, g: &str, protocol: &str) -> Value {
        let staged = invoke(
            h,
            g,
            "channel:stage",
            json!([{"request":request(f,protocol,0,"save"),"secret":QA_SECRET_ONE}]),
        )
        .unwrap();
        commit(h, g, staged).unwrap()
    }
    fn send(h: &FormalHost, g: &str, sid: &str, id: &str, text: &str) -> Result<Value, String> {
        invoke(
            h,
            g,
            "agent:send-message",
            json!([{"sessionId":sid,"requestId":id,"startedAt":1234,"channelId":"user-channel","modelId":"model","userMessage":text,"effort":""}]),
        )
    }
    #[test]
    fn original_invoke_saved_channel_streams_both_codecs_and_reopens_without_request() {
        for protocol in ["openai-chat", "anthropic-messages"] {
            let f = Fixture::new();
            let mut h = f.open();
            let g = boot(&h);
            assert_eq!(
                invoke(&h, &g, "channel:list", json!([])).unwrap(),
                json!([])
            );
            let draft = invoke(&h, &g, "agent:get-or-create-draft-session", json!([])).unwrap();
            assert!(draft["id"].is_string());
            assert_eq!(save(&f, &h, &g, protocol)["revision"], 1);
            let sid = invoke(
                &h,
                &g,
                "agent:create-session",
                json!(["Owned", "user-channel"]),
            )
            .unwrap()["id"]
                .as_str()
                .unwrap()
                .to_string();
            send(&h, &g, &sid, "one", "hello").unwrap();
            send(&h, &g, &sid, "two", "continue").unwrap();
            let records = f.records.lock().unwrap();
            assert_eq!(records.len(), 2);
            let last = String::from_utf8(records[1].clone()).unwrap();
            assert!(last.contains("owned answer"));
            assert!(last.contains(QA_SECRET_ONE));
            drop(records);
            let before = invoke(&h, &g, "agent:get-messages", json!([sid])).unwrap();
            assert!(before.to_string().contains("owned answer"));
            h.shutdown().unwrap();
            drop(h);
            let h = f.open();
            let g = boot(&h);
            assert_eq!(f.records.lock().unwrap().len(), 2);
            assert_eq!(
                invoke(&h, &g, "agent:get-messages", json!([sid])).unwrap(),
                before
            );
            send(&h, &g, &sid, "two", "continue").unwrap();
            assert_eq!(f.records.lock().unwrap().len(), 2);
            send(&h, &g, &sid, "three", "after reopen").unwrap();
            assert_eq!(f.records.lock().unwrap().len(), 3);
            assert!(!std::fs::read_to_string(
                f.root.path().join("formal-platform-v1/snapshot.json")
            )
            .unwrap()
            .contains(QA_SECRET_ONE));
        }
    }
    #[test]
    fn explicit_catalog_is_authenticated_get_and_typed_probe_does_not_stage() {
        let f = Fixture::new();
        let h = f.open();
        let g = boot(&h);
        save(&f, &h, &g, "openai-chat");
        let vault: Vec<_> = std::fs::read_dir(f.root.path().join("qa-vault"))
            .unwrap()
            .map(|e| std::fs::read(e.unwrap().path()).unwrap())
            .collect();
        assert_eq!(
            invoke(&h, &g, "channel:test", json!(["user-channel"])).unwrap()["success"],
            true
        );
        let result = invoke(
            &h,
            &g,
            "channel:fetch-models",
            json!([{"provider":"custom-openai","baseUrl":f.base,"apiKey":QA_SECRET_TWO}]),
        )
        .unwrap();
        assert_eq!(result["models"][0]["id"], "model");
        let after: Vec<_> = std::fs::read_dir(f.root.path().join("qa-vault"))
            .unwrap()
            .map(|e| std::fs::read(e.unwrap().path()).unwrap())
            .collect();
        assert_eq!(after, vault);
        assert!(f
            .records
            .lock()
            .unwrap()
            .iter()
            .all(|r| r.starts_with(b"GET /v1/models ")));
    }
    #[test]
    fn stored_key_echo_keep_and_settings_rejected_without_persistence() {
        let f = Fixture::new();
        let h = f.open();
        let g = boot(&h);
        save(&f, &h, &g, "openai-chat");
        let file = f.root.path().join("formal-platform-v1/snapshot.json");
        let bytes = std::fs::read(&file).unwrap();
        let mut r = request(&f, "openai-chat", 1, "echo");
        r["args"][0]["channel"]["name"] = json!(QA_SECRET_ONE);
        assert!(commit(&h, &g, r).is_err());
        let r = json!({"version":1,"channel":"user-profile:update","args":[{"userName":QA_SECRET_ONE}],"mutation":{"mutationId":"settings-echo","expectedRevision":1}});
        assert!(commit(&h, &g, r).is_err());
        assert_eq!(std::fs::read(file).unwrap(), bytes);
        let sid = invoke(
            &h,
            &g,
            "agent:create-session",
            json!(["Owned", "user-channel"]),
        )
        .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_string();
        let journal = f.root.path().join("desktop-runtime-v1/journal.jsonl");
        let before = std::fs::read(&journal).unwrap();
        assert!(send(&h, &g, &sid, "echo", QA_SECRET_ONE).is_err());
        assert_eq!(std::fs::read(journal).unwrap(), before);
    }
    #[test]
    fn tampered_catalog_and_receipt_cannot_retarget_stored_credential() {
        let f = Fixture::new();
        let other = Fixture::new();
        let mut h = f.open();
        let g = boot(&h);
        save(&f, &h, &g, "openai-chat");
        h.shutdown().unwrap();
        drop(h);
        let file = f.root.path().join("formal-platform-v1/snapshot.json");
        let mut state: Value = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
        state["credentialCatalog"]["revisions"]["revision-save"]["channel"]["baseUrl"] =
            json!(other.base);
        state["receipts"]["save"]["request"]["args"][0]["channel"]["baseUrl"] = json!(other.base);
        std::fs::write(&file, serde_json::to_vec(&state).unwrap()).unwrap();
        let h = FormalHost::open_channels_qa(
            &f.root,
            HostEnvironment::new("darwin", false, false).unwrap(),
            other.policy.clone(),
            FakeVault::open(f.root.path().join("qa-vault")).unwrap(),
        )
        .unwrap();
        let g = boot(&h);
        assert_eq!(
            invoke(&h, &g, "channel:test", json!(["user-channel"])).unwrap_err(),
            "credentialBindingMismatch"
        );
        assert!(other.records.lock().unwrap().is_empty());
        assert!(f.records.lock().unwrap().is_empty());
    }

    #[test]
    fn owned_native_qa_rebinds_port_and_refuses_collision() {
        let f = Fixture::new();
        let mut h = FormalHost::open_channels_owned_qa(
            &f.root,
            HostEnvironment::new("darwin", false, false).unwrap(),
        )
        .unwrap();
        let g = boot(&h);
        let binding: Value =
            serde_json::from_slice(&std::fs::read(f.root.path().join("qa-endpoint.json")).unwrap())
                .unwrap();
        let port = binding["port"].as_u64().unwrap() as u16;
        let mut r = request(&f, "openai-chat", 0, "native-save");
        r["args"][0]["channel"]["baseUrl"] = json!(format!("http://127.0.0.1:{port}/v1"));
        r["args"][0]["channel"]["models"][0]["modelId"] = json!("owned-text");
        let staged = invoke(
            &h,
            &g,
            "channel:stage",
            json!([{"request":r,"secret":QA_SECRET_ONE}]),
        )
        .unwrap();
        commit(&h, &g, staged).unwrap();
        h.shutdown().unwrap();
        drop(h);
        let listener = TcpListener::bind(("127.0.0.1", port)).unwrap();
        assert!(FormalHost::open_channels_owned_qa(
            &f.root,
            HostEnvironment::new("darwin", false, false).unwrap()
        )
        .is_err());
        drop(listener);
        let h = FormalHost::open_channels_owned_qa(
            &f.root,
            HostEnvironment::new("darwin", false, false).unwrap(),
        )
        .unwrap();
        let g = boot(&h);
        assert_eq!(
            invoke(&h, &g, "channel:test", json!(["user-channel"])).unwrap()["success"],
            true
        );
        let same: Value =
            serde_json::from_slice(&std::fs::read(f.root.path().join("qa-endpoint.json")).unwrap())
                .unwrap();
        assert_eq!(same, binding);
    }
    #[test]
    fn delete_keeps_accepted_receipts_and_missing_key_preserves_history() {
        let f = Fixture::new();
        let h = f.open();
        let g = boot(&h);
        save(&f, &h, &g, "openai-chat");
        let sid = invoke(
            &h,
            &g,
            "agent:create-session",
            json!(["Owned", "user-channel"]),
        )
        .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_string();
        send(&h, &g, &sid, "accepted", "hello").unwrap();
        let mut disabled = request(&f, "openai-chat", 1, "disable");
        disabled["args"][0]["channel"]["enabled"] = json!(false);
        commit(&h, &g, disabled).unwrap();
        send(&h, &g, &sid, "accepted", "hello").unwrap();
        assert_eq!(
            send(&h, &g, &sid, "fresh", "hello").unwrap_err(),
            "modelUnavailable"
        );
        let deleted = json!({"channel":"channel:delete","args":["user-channel"],"mutation":{"mutationId":"delete","expectedRevision":2}});
        commit(&h, &g, deleted).unwrap();
        send(&h, &g, &sid, "accepted", "hello").unwrap();
        assert_eq!(f.records.lock().unwrap().len(), 1);
        assert!(invoke(&h, &g, "agent:get-messages", json!([sid]))
            .unwrap()
            .to_string()
            .contains("owned answer"));
    }

    #[test]
    fn known_other_staged_key_cannot_escape_split_unicode_output() {
        let f = Fixture::new();
        let h = f.open();
        let g = boot(&h);
        save(&f, &h, &g, "openai-chat");
        let staged = invoke(
            &h,
            &g,
            "channel:stage",
            json!([{"request":request(&f,"openai-chat",1,"rotation"),"secret":QA_SECRET_TWO}]),
        )
        .unwrap();
        assert!(staged["args"][0]["credential"].is_object());
        let sid = invoke(
            &h,
            &g,
            "agent:create-session",
            json!(["Owned", "user-channel"]),
        )
        .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_string();
        assert!(send(&h, &g, &sid, "echo-other", "echo-other").is_err());
        let history = invoke(&h, &g, "agent:get-messages", json!([sid])).unwrap();
        assert!(!history.to_string().contains(QA_SECRET_TWO));
    }
    #[test]
    fn missing_current_vault_item_keeps_history_and_does_not_bind() {
        let f = Fixture::new();
        let mut h = f.open();
        let g = boot(&h);
        save(&f, &h, &g, "openai-chat");
        let sid = invoke(
            &h,
            &g,
            "agent:create-session",
            json!(["Owned", "user-channel"]),
        )
        .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_string();
        send(&h, &g, &sid, "accepted", "hello").unwrap();
        h.shutdown().unwrap();
        drop(h);
        for e in std::fs::read_dir(f.root.path().join("qa-vault")).unwrap() {
            std::fs::remove_file(e.unwrap().path()).unwrap();
        }
        let h = f.open();
        let g = boot(&h);
        assert!(invoke(&h, &g, "agent:get-messages", json!([sid]))
            .unwrap()
            .to_string()
            .contains("owned answer"));
        send(&h, &g, &sid, "accepted", "hello").unwrap();
        let journal = f.root.path().join("desktop-runtime-v1/journal.jsonl");
        let before = std::fs::read(&journal).unwrap();
        assert_eq!(
            send(&h, &g, &sid, "missing", "preserve me").unwrap_err(),
            "credentialMissing"
        );
        assert_eq!(std::fs::read(journal).unwrap(), before);
        assert_eq!(f.records.lock().unwrap().len(), 1);
    }

    #[test]
    fn errors_partial_history_and_probe_cancel_are_bounded() {
        let f = Fixture::new();
        let h = f.open();
        let g = boot(&h);
        save(&f, &h, &g, "openai-chat");
        let sid = invoke(
            &h,
            &g,
            "agent:create-session",
            json!(["Owned", "user-channel"]),
        )
        .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_string();
        assert!(send(&h, &g, &sid, "failure", "failure").is_err());
        assert!(send(&h, &g, &sid, "disconnect", "disconnect").is_err());
        assert!(invoke(&h, &g, "agent:get-messages", json!([sid]))
            .unwrap()
            .to_string()
            .contains("owned partial"));
        f.mode.store(1, Ordering::Release);
        assert!(invoke(&h, &g, "channel:test", json!(["user-channel"])).is_err());
        f.mode.store(2, Ordering::Release);
        let before = f.records.lock().unwrap().len();
        let pending=h.command("main",json!({"command":"invoke","generation":g,"channel":"channel:test","args":["user-channel"]})).unwrap();
        let start = std::time::Instant::now();
        while f.records.lock().unwrap().len() == before {
            assert!(start.elapsed() < Duration::from_secs(2));
            thread::sleep(Duration::from_millis(2));
        }
        let stop = std::time::Instant::now();
        invoke(&h, &g, "agent:stop", json!([sid])).unwrap();
        assert!(stop.elapsed() < Duration::from_millis(500));
        assert_eq!(
            pending.wait(Duration::from_secs(1)).unwrap_err().0,
            "staleGeneration"
        );
    }
    #[test]
    fn pending_stream_survives_disable_and_delete_and_stop_keeps_partial() {
        let f = Fixture::new();
        let h = FormalHost::open_channels_owned_qa(
            &f.root,
            HostEnvironment::new("darwin", false, false).unwrap(),
        )
        .unwrap();
        let g = boot(&h);
        let binding: Value =
            serde_json::from_slice(&std::fs::read(f.root.path().join("qa-endpoint.json")).unwrap())
                .unwrap();
        let mut r = request(&f, "openai-chat", 0, "slow-save");
        r["args"][0]["channel"]["baseUrl"] =
            json!(format!("http://127.0.0.1:{}/v1", binding["port"]));
        r["args"][0]["channel"]["models"][0]["modelId"] = json!("owned-text");
        let staged = invoke(
            &h,
            &g,
            "channel:stage",
            json!([{"request":r,"secret":QA_SECRET_ONE}]),
        )
        .unwrap();
        commit(&h, &g, staged).unwrap();
        let sid = invoke(
            &h,
            &g,
            "agent:create-session",
            json!(["Owned", "user-channel"]),
        )
        .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_string();
        call(&h, json!({"command":"attach","generation":g,"observed":{}})).unwrap();
        let pending=h.command("main",json!({"command":"invoke","generation":g,"channel":"agent:send-message","args":[{"sessionId":sid,"requestId":"slow","startedAt":1234,"channelId":"user-channel","modelId":"owned-text","userMessage":"[qa:slow]","effort":""}]})).unwrap();
        let start = std::time::Instant::now();
        loop {
            if h.next_event(Duration::from_millis(10))
                .is_some_and(|e| e.payload.to_string().contains("Owned QA"))
            {
                break;
            }
            if let Some(result) = pending.try_result() {
                panic!("运行提前结束: {result:?}");
            }
            assert!(start.elapsed() < Duration::from_secs(3));
        }
        r["channel"] = json!("channel:update");
        r["mutation"] = json!({"mutationId":"disable-slow","expectedRevision":1});
        r["args"][0]["channel"]["enabled"] = json!(false);
        commit(&h, &g, r).unwrap();
        commit(&h,&g,json!({"channel":"channel:delete","args":["user-channel"],"mutation":{"mutationId":"delete-slow","expectedRevision":2}})).unwrap();
        assert!(
            pending.try_result().is_none(),
            "已接受的执行不能被渠道删除取消"
        );
        invoke(&h, &g, "agent:stop", json!([sid])).unwrap();
        pending.wait(Duration::from_secs(2)).unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        loop {
            if let Some(event) = h.next_event(Duration::from_millis(10)) {
                if event.channel == "agent:stream:complete" {
                    assert_eq!(event.payload["stoppedByUser"], true);
                    break;
                }
            }
            assert!(std::time::Instant::now() < deadline);
        }
        let history = invoke(&h, &g, "agent:get-messages", json!([sid]))
            .unwrap()
            .to_string();
        assert!(history.contains("Owned QA"));
        assert!(!history.contains("completed."));
    }
}

#[cfg(feature = "formal-native-qa")]
#[test]
fn direct_foreign_and_qa_vault_helper_invocation_is_rejected() {
    for binary in [
        env!("CARGO_BIN_EXE_tinker-channels-preview"),
        env!("CARGO_BIN_EXE_tinker-channels-native-qa"),
    ] {
        let result = std::process::Command::new(binary)
            .args(["--tinker-channels-helper", "vault"])
            .env_clear()
            .stdin(std::process::Stdio::null())
            .output()
            .unwrap();
        assert_eq!(result.status.code(), Some(64));
        assert!(result.stdout.is_empty());
        assert!(result.stderr.is_empty());
    }
}
