//! 恢复屏障测试专用HTTP夹具；首delta后显式release，不依赖300次落盘吞吐。
#[path = "http.rs"]
mod http;
use serde_json::{json, Value};
use std::{
    io::Write,
    net::TcpListener,
    sync::{mpsc, Arc},
    thread,
    time::{Duration, Instant},
};
use tinker_rust_foundation::{
    desktop_runtime::DesktopRuntime,
    formal_agent::{FormalAgentHost, PendingReply},
    formal_platform::{local_mock_profiles, FormalPlatform, HostEnvironment, TrustedRoot},
};
pub struct Held {
    release: Option<mpsc::SyncSender<()>>,
    worker: Option<thread::JoinHandle<()>>,
}
impl Held {
    pub fn release(&mut self) {
        if let Some(tx) = self.release.take() {
            let _ = tx.send(());
        }
    }
}
impl Drop for Held {
    fn drop(&mut self) {
        self.release();
        if let Some(worker) = self.worker.take() {
            worker.join().unwrap();
        }
    }
}
pub fn setup() -> (TrustedRoot, FormalAgentHost, Held) {
    let root =
        TrustedRoot::create_temporary(std::env::temp_dir().canonicalize().unwrap().join(format!(
            "tinker-tauri-formal-preview-controlled-{}",
            std::process::id()
        )))
        .unwrap();
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    listener.set_nonblocking(true).unwrap();
    let endpoint = format!(
        "http://{}/v1/chat/completions",
        listener.local_addr().unwrap()
    );
    let (tx, rx) = mpsc::sync_channel(1);
    let worker = thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(3);
        let mut stream = loop {
            match listener.accept() {
                Ok((s, _)) => break s,
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    if Instant::now() > deadline {
                        return;
                    }
                    thread::sleep(Duration::from_millis(2));
                }
                Err(e) => panic!("owned listener: {e}"),
            }
        };
        stream.set_nonblocking(false).unwrap();
        stream
            .set_write_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let request = http::read_request(&mut stream);
        assert!(request.starts_with(b"POST /v1/chat/completions "));
        write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: {}\n\n",json!({"choices":[{"delta":{"content":"before restore 🌱 "},"finish_reason":null}]})).unwrap();
        stream.flush().unwrap();
        if rx.recv_timeout(Duration::from_secs(3)).is_err() {
            return;
        }
        let _ = write!(
            stream,
            "data: {}\n\ndata: {}\n\ndata: [DONE]\n\n",
            json!({"choices":[{"delta":{"content":"after restore"},"finish_reason":null}]}),
            json!({"choices":[{"delta":{},"finish_reason":"stop"}]})
        );
        let _ = stream.flush();
    });
    let profiles = local_mock_profiles(&endpoint).unwrap();
    let platform = FormalPlatform::open(
        &root,
        &profiles,
        HostEnvironment::new("darwin", false, false).unwrap(),
    )
    .unwrap();
    let runtime = Arc::new(DesktopRuntime::open(root.path(), profiles).unwrap());
    let host = FormalAgentHost::new(runtime, platform, root.clone()).unwrap();
    (
        root,
        host,
        Held {
            release: Some(tx),
            worker: Some(worker),
        },
    )
}
pub fn call(h: &FormalAgentHost, v: Value) -> Value {
    h.command("main", v)
        .unwrap()
        .wait(Duration::from_secs(10))
        .unwrap()
}
pub fn bootstrap(h: &FormalAgentHost) -> String {
    call(h, json!({"command":"bootstrap"}))["generation"]
        .as_str()
        .unwrap()
        .into()
}
pub fn invoke(h: &FormalAgentHost, g: &str, c: &str, a: Value) -> Value {
    call(
        h,
        json!({"command":"invoke","generation":g,"channel":c,"args":a}),
    )["value"]
        .clone()
}
pub fn create(h: &FormalAgentHost, g: &str) -> String {
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
pub fn send(h: &FormalAgentHost, g: &str, s: &str, id: &str, text: &str) -> PendingReply {
    h.command("main",json!({"command":"invoke","generation":g,"channel":"agent:send-message","args":[{"sessionId":s,"requestId":id,"startedAt":1234,"channelId":"local-mock","modelId":"local-mock-a","workspaceId":"local-mock-workspace-id","userMessage":text}]})).unwrap()
}
