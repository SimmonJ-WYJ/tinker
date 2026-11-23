//! 导入历史必须进入实际下一个HTTP请求，不得只在原生列表中显示。
use super::*;
use crate::electron_import::{SourceMessage, SourceSession};
use std::{
    fs,
    io::{Read, Write},
    net::TcpListener,
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, Instant},
};
static NEXT: AtomicU64 = AtomicU64::new(0);
pub(super) struct Temp(pub(super) std::path::PathBuf);
impl Temp {
    pub(super) fn new() -> Self {
        let p = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "synthetic-desktop-import-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&p).unwrap();
        Self(p)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
pub(super) fn source() -> SourceSession {
    SourceSession {
        source_session_id: "synthetic-electron-session".into(),
        title: "Synthetic imported conversation".into(),
        created_at: 100,
        updated_at: 200,
        archived: false,
        pinned: true,
        messages: vec![
            SourceMessage {
                id: "source-user-stable".into(),
                role: "user".into(),
                text: "旧问题中文".into(),
                created_at: 101,
                attachment_ids: vec![],
            },
            SourceMessage {
                id: "source-assistant-stable".into(),
                role: "assistant".into(),
                text: "旧回答✨".into(),
                created_at: 102,
                attachment_ids: vec![],
            },
        ],
        attachments: vec![],
    }
}
pub(super) fn profiles(endpoint: &str) -> Vec<TrustedProfile> {
    vec![TrustedProfile {
        profile_id: "synthetic-local".into(),
        label: "Synthetic mock".into(),
        config_revision: "r1".into(),
        models: vec![Model {
            model_id: "synthetic-model".into(),
            label: "Mock".into(),
            supported_efforts: vec![],
        }],
        endpoint: endpoint.into(),
        key: "synthetic-import-key".into(),
        protocol: crate::chat_http::HttpProtocol::OpenaiChat,
    }]
}
pub(super) fn call(runtime: &DesktopRuntime, method: &str, params: Value) -> Value {
    let r = runtime
        .dispatch(json!({"version":1,"id":"synthetic-wire","method":method,"params":params}))
        .unwrap();
    assert!(r.error.is_none(), "{:?}", r.error);
    r.result.unwrap()
}
fn send(runtime: &DesktopRuntime, sid: &str, rid: &str, input: &str) {
    call(
        runtime,
        "chat.send",
        json!({"sessionId":sid,"requestId":rid,"profileId":"synthetic-local","modelId":"synthetic-model","userMessage":input,"startedAt":300,"effort":null}),
    );
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let page = call(
            runtime,
            "chat.events",
            json!({"sessionId":sid,"requestId":rid,"afterSequence":0,"limit":64}),
        );
        if page["turn"]["status"] == "completed" {
            break;
        }
        assert!(Instant::now() < deadline, "{page}");
        std::thread::sleep(Duration::from_millis(5));
    }
}
#[test]
fn import_is_durable_idempotent_and_seeds_real_http_before_native_turns() {
    let t = Temp::new();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/chat", listener.local_addr().unwrap());
    let server = std::thread::spawn(move || {
        for current in ["新问题一", "新问题二"] {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut bytes = Vec::new();
            loop {
                let mut buf = [0u8; 4096];
                let n = socket.read(&mut buf).unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&buf[..n]);
                assert!(bytes.len() < 65536);
                if let Some(end) = bytes.windows(4).position(|v| v == b"\r\n\r\n") {
                    let header = String::from_utf8_lossy(&bytes[..end]);
                    let len: usize = header
                        .lines()
                        .find_map(|v| {
                            v.to_ascii_lowercase()
                                .strip_prefix("content-length: ")
                                .map(str::to_owned)
                        })
                        .unwrap()
                        .parse()
                        .unwrap();
                    if bytes.len() >= end + 4 + len {
                        let body: Value = serde_json::from_slice(&bytes[end + 4..]).unwrap();
                        let mut expected = vec![
                            json!({"role":"user","content":"旧问题中文"}),
                            json!({"role":"assistant","content":"旧回答✨"}),
                        ];
                        if current == "新问题二" {
                            expected.extend([
                                json!({"role":"user","content":"新问题一"}),
                                json!({"role":"assistant","content":"新回答"}),
                            ]);
                        }
                        expected.push(json!({"role":"user","content":current}));
                        assert_eq!(body["messages"], json!(expected));
                        break;
                    }
                }
            }
            let body =
                "data: {\"choices\":[{\"delta\":{\"content\":\"新回答\"}}]}\n\ndata: [DONE]\n\n";
            write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
        }
        listener.set_nonblocking(true).unwrap();
        std::thread::sleep(Duration::from_millis(30));
        assert!(listener.accept().is_err());
    });
    let runtime = DesktopRuntime::open(&t.0, profiles(&endpoint)).unwrap();
    call(
        &runtime,
        "sessions.create",
        json!({"title":"native stays","profileId":"synthetic-local","workspaceId":null,"reuseDraft":false}),
    );
    let receipt = runtime
        .import_electron_session(&source(), "synthetic-local", |_| Ok(vec![]))
        .unwrap();
    assert!(receipt.imported);
    let sid = receipt.session_id.clone();
    assert_eq!(
        call(&runtime, "sessions.list", json!({}))["sessions"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    let history = call(
        &runtime,
        "sessions.historyV2",
        json!({"sessionId":sid,"after":0,"limit":128}),
    );
    assert_eq!(history["turns"].as_array().unwrap().len(), 2);
    assert_eq!(
        history["turns"][0]["importedMessages"][0]["_electronSourceMessageId"],
        "source-user-stable"
    );
    assert!(
        !runtime
            .import_electron_session(&source(), "synthetic-local", |_| panic!(
                "重复导入不得重新准备附件"
            ))
            .unwrap()
            .imported
    );
    send(&runtime, &sid, "native-next-1", "新问题一");
    drop(runtime);
    let runtime = DesktopRuntime::open(&t.0, profiles(&endpoint)).unwrap();
    assert!(
        !runtime
            .import_electron_session(&source(), "synthetic-local", |_| panic!(
                "重启重复导入不得重新准备附件"
            ))
            .unwrap()
            .imported
    );
    let mut changed = source();
    changed.messages[0].text = "source changed".into();
    assert_eq!(
        runtime
            .import_electron_session(&changed, "synthetic-local", |_| Ok(vec![]))
            .err(),
        Some(DesktopError("importConflict"))
    );
    send(&runtime, &sid, "native-next-2", "新问题二");
    server.join().unwrap();
    assert_eq!(
        call(
            &runtime,
            "sessions.historyV2",
            json!({"sessionId":sid,"after":0,"limit":128})
        )["turns"]
            .as_array()
            .unwrap()
            .len(),
        4
    );
}
#[test]
fn imported_history_cannot_be_reused_as_an_empty_draft_or_resurrected_after_delete() {
    let t = Temp::new();
    let runtime = DesktopRuntime::open(&t.0, profiles("http://127.0.0.1:9/chat")).unwrap();
    let r = runtime
        .import_electron_session(&source(), "synthetic-local", |_| Ok(vec![]))
        .unwrap();
    let sid = r.session_id;
    let draft = call(
        &runtime,
        "sessions.create",
        json!({"title":"new empty draft","profileId":"synthetic-local","workspaceId":null,"reuseDraft":true}),
    );
    assert_ne!(draft["sessionId"], sid);
    call(&runtime, "sessions.delete", json!({"sessionId":sid}));
    assert_eq!(
        runtime
            .import_electron_session(&source(), "synthetic-local", |_| Ok(vec![]))
            .err(),
        Some(DesktopError("importConflict"))
    );
}
#[test]
fn import_failed_preparation_is_unpublished_and_retry_recovers_without_duplicates() {
    let t = Temp::new();
    let runtime = DesktopRuntime::open(&t.0, profiles("http://127.0.0.1:9/chat")).unwrap();
    assert_eq!(
        runtime
            .import_electron_session(&source(), "synthetic-local", |_| Err(DesktopError(
                "storeIo"
            )))
            .err(),
        Some(DesktopError("storeIo"))
    );
    assert_eq!(
        call(&runtime, "sessions.list", json!({}))["sessions"],
        json!([])
    );
    drop(runtime);
    let runtime = DesktopRuntime::open(&t.0, profiles("http://127.0.0.1:9/chat")).unwrap();
    let r = runtime
        .import_electron_session(&source(), "synthetic-local", |_| Ok(vec![]))
        .unwrap();
    assert!(r.imported);
    assert!(
        !runtime
            .import_electron_session(&source(), "synthetic-local", |_| panic!(
                "已发布不重复stage"
            ))
            .unwrap()
            .imported
    );
    let bytes = fs::read(t.0.join("desktop-runtime-v1/journal.jsonl")).unwrap();
    let records: Vec<_> = bytes
        .split(|b| *b == b'\n')
        .filter(|b| !b.is_empty())
        .map(|b| serde_json::from_slice::<Value>(b).unwrap())
        .collect();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0]["version"], 1);
    assert_eq!(records[0]["entry"]["kind"], "session");
}
#[test]
fn import_missing_seed_fails_closed_after_restart_and_does_not_mutate_native_data() {
    let t = Temp::new();
    let runtime = DesktopRuntime::open(&t.0, profiles("http://127.0.0.1:9/chat")).unwrap();
    call(
        &runtime,
        "sessions.create",
        json!({"title":"native","profileId":"synthetic-local","workspaceId":null,"reuseDraft":false}),
    );
    let sid = runtime
        .import_electron_session(&source(), "synthetic-local", |_| Ok(vec![]))
        .unwrap()
        .session_id;
    drop(runtime);
    let journal = t.0.join("desktop-runtime-v1/journal.jsonl");
    let before = fs::read(&journal).unwrap();
    fs::remove_file(
        t.0.join("desktop-runtime-v1")
            .join(&sid)
            .join("imported-session-v1.json"),
    )
    .unwrap();
    let runtime = DesktopRuntime::open(&t.0, profiles("http://127.0.0.1:9/chat")).unwrap();
    assert_eq!(
        call(&runtime, "sessions.list", json!({}))["sessions"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    let failed=runtime.dispatch(json!({"version":1,"id":"synthetic-wire","method":"sessions.historyV2","params":{"sessionId":sid,"after":0,"limit":128}})).unwrap();
    assert_eq!(failed.error.unwrap().code, "corruptImport");
    assert_eq!(
        call(
            &runtime,
            "sessions.historyV2",
            json!({"sessionId":"session-1","after":0,"limit":128})
        )["turns"],
        json!([])
    );
    assert_eq!(fs::read(journal).unwrap(), before);
}
#[test]
fn import_oversized_context_is_visible_but_next_send_rejects_before_binding_or_network() {
    let t = Temp::new();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let endpoint = format!("http://{}/chat", listener.local_addr().unwrap());
    let runtime = DesktopRuntime::open(&t.0, profiles(&endpoint)).unwrap();
    let mut src = source();
    src.messages = (0..34)
        .map(|i| SourceMessage {
            id: format!("synthetic-source-{i}"),
            role: if i % 2 == 0 { "user" } else { "assistant" }.into(),
            text: "old context".into(),
            created_at: 101,
            attachment_ids: vec![],
        })
        .collect();
    let sid = runtime
        .import_electron_session(&src, "synthetic-local", |_| Ok(vec![]))
        .unwrap()
        .session_id;
    let before = fs::read(t.0.join("desktop-runtime-v1/journal.jsonl")).unwrap();
    let r=runtime.dispatch(json!({"version":1,"id":"synthetic-wire","method":"chat.send","params":{"sessionId":sid,"requestId":"too-deep","profileId":"synthetic-local","modelId":"synthetic-model","userMessage":"new","startedAt":300,"effort":null}})).unwrap();
    assert_eq!(r.error.unwrap().code, "contextLimitExceeded");
    assert_eq!(
        fs::read(t.0.join("desktop-runtime-v1/journal.jsonl")).unwrap(),
        before
    );
    assert!(listener.accept().is_err());
    assert_eq!(
        call(
            &runtime,
            "sessions.historyV2",
            json!({"sessionId":sid,"after":0,"limit":128})
        )["turns"]
            .as_array()
            .unwrap()
            .len(),
        34
    );
}
#[test]
fn import_partial_intent_temporary_file_is_recoverable_after_process_restart() {
    let t = Temp::new();
    let runtime = DesktopRuntime::open(&t.0, profiles("http://127.0.0.1:9/chat")).unwrap();
    assert!(runtime
        .import_electron_session(&source(), "synthetic-local", |_| Err(DesktopError(
            "storeIo"
        )))
        .is_err());
    drop(runtime);
    let base = t.0.join("desktop-runtime-v1");
    let dir = fs::read_dir(&base)
        .unwrap()
        .map(|e| e.unwrap().path())
        .find(|p| {
            p.file_name()
                .unwrap()
                .to_str()
                .unwrap()
                .starts_with("electron-import-")
        })
        .unwrap();
    let path = dir.join("import-intent-v1.json");
    let bytes = fs::read(&path).unwrap();
    fs::remove_file(&path).unwrap();
    fs::write(
        dir.join(".import-intent-v1.json.tmp"),
        &bytes[..bytes.len() / 2],
    )
    .unwrap();
    let runtime = DesktopRuntime::open(&t.0, profiles("http://127.0.0.1:9/chat")).unwrap();
    assert!(
        runtime
            .import_electron_session(&source(), "synthetic-local", |_| Ok(vec![]))
            .unwrap()
            .imported
    );
}
#[test]
fn import_rejects_history_that_cannot_fit_native_open_budget_before_catalog_publish() {
    let t = Temp::new();
    let runtime = DesktopRuntime::open(&t.0, profiles("http://127.0.0.1:9/chat")).unwrap();
    let mut src = source();
    src.messages = (0..24)
        .map(|i| SourceMessage {
            id: format!("synthetic-assistant-{i}"),
            role: "assistant".into(),
            text: "a".repeat(crate::run_types::MAX_OUTPUT_BYTES),
            created_at: 101,
            attachment_ids: vec![],
        })
        .collect();
    assert_eq!(
        runtime
            .import_electron_session(&src, "synthetic-local", |_| Ok(vec![]))
            .err(),
        Some(DesktopError("importLimit"))
    );
    assert_eq!(
        call(&runtime, "sessions.list", json!({}))["sessions"],
        json!([])
    );
}
#[test]
fn import_valid_json_seed_content_corruption_is_quarantined_without_disabling_native_sessions() {
    let t = Temp::new();
    let runtime = DesktopRuntime::open(&t.0, profiles("http://127.0.0.1:9/chat")).unwrap();
    let sid = runtime
        .import_electron_session(&source(), "synthetic-local", |_| Ok(vec![]))
        .unwrap()
        .session_id;
    drop(runtime);
    let file =
        t.0.join("desktop-runtime-v1")
            .join(&sid)
            .join("imported-session-v1.json");
    let mut v: Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
    v["messages"][0]["text"] = json!("corrupted persisted text");
    fs::write(file, serde_json::to_vec(&v).unwrap()).unwrap();
    let runtime = DesktopRuntime::open(&t.0, profiles("http://127.0.0.1:9/chat")).unwrap();
    let list = call(&runtime, "sessions.list", json!({}));
    assert_eq!(list["sessions"][0]["importError"], "corruptImport");
    let r=runtime.dispatch(json!({"version":1,"id":"wire","method":"sessions.historyV2","params":{"sessionId":sid,"after":0,"limit":128}})).unwrap();
    assert_eq!(r.error.unwrap().code, "corruptImport");
}
#[test]
fn imported_message_identities_are_stable_and_disjoint_from_native_request_ids() {
    let t = Temp::new();
    let runtime = DesktopRuntime::open(&t.0, profiles("http://127.0.0.1:9/chat")).unwrap();
    let mut src = source();
    src.messages[0].id = "future-native-request-user".into();
    let sid = runtime
        .import_electron_session(&src, "synthetic-local", |_| Ok(vec![]))
        .unwrap()
        .session_id;
    let history = call(
        &runtime,
        "sessions.historyV2",
        json!({"sessionId":sid,"after":0,"limit":128}),
    );
    let message = &history["turns"][0]["importedMessages"][0];
    assert!(message["uuid"].as_str().unwrap().contains(':'));
    assert_eq!(
        message["_electronSourceMessageId"],
        "future-native-request-user"
    );
    assert_eq!(message["session_id"], sid);
    let uuid = message["uuid"].clone();
    drop(runtime);
    let runtime = DesktopRuntime::open(&t.0, profiles("http://127.0.0.1:9/chat")).unwrap();
    assert_eq!(
        call(
            &runtime,
            "sessions.historyV2",
            json!({"sessionId":sid,"after":0,"limit":128})
        )["turns"][0]["importedMessages"][0]["uuid"],
        uuid
    );
}
struct SyntheticTools;
impl crate::tool_types::ToolExecutor for SyntheticTools {
    fn workspace_revision(&self) -> &str {
        "synthetic-workspace"
    }
    fn catalog(&self) -> Vec<crate::tool_types::ToolSpec> {
        vec![]
    }
    fn execute(
        &self,
        _: &crate::tool_types::ToolCall,
        _: &std::sync::atomic::AtomicBool,
    ) -> std::result::Result<crate::tool_types::ToolResult, crate::run_types::RunError> {
        unreachable!("导入文本seed不能启动工具")
    }
}
#[test]
fn import_guard_uses_actual_request_profile_instead_of_original_session_profile() {
    let t = Temp::new();
    let mut registry = profiles("http://127.0.0.1:9/chat");
    let mut tools_profile = profiles("http://127.0.0.1:9/chat").remove(0);
    tools_profile.profile_id = "synthetic-tools".into();
    registry.push(tools_profile);
    let options = crate::tool_types::ToolRunOptions::new(
        "synthetic-workspace".into(),
        Duration::from_secs(1),
        Duration::from_secs(2),
    )
    .unwrap();
    let runtime = DesktopRuntime::open_with_tools(
        &t.0,
        registry,
        vec![TrustedToolBinding {
            profile_id: "synthetic-tools".into(),
            executor: std::sync::Arc::new(SyntheticTools),
            options,
        }],
    )
    .unwrap();
    let sid = runtime
        .import_electron_session(&source(), "synthetic-tools", |_| Ok(vec![]))
        .unwrap()
        .session_id;
    let inner = runtime.inner.lock().unwrap();
    assert!(inner
        .import_preflight(&sid, "native-request", None, "new", "synthetic-local")
        .is_ok());
    assert_eq!(
        inner.import_preflight(&sid, "native-request", None, "new", "synthetic-tools"),
        Err(DesktopError("contextUnsupported"))
    );
    assert_eq!(
        inner.import_profile_guard(&sid, "synthetic-tools"),
        Err(DesktopError("contextUnsupported"))
    );
}
