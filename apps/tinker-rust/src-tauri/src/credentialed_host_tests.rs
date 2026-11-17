//! 锁外vault晚到结果不能越过新generation启动HTTP或写入Bind。
use super::*;
use crate::{
    credentialed_channels::{
        catalog::EndpointPolicy,
        vault::{CredentialBinding, CredentialVault, Secret, VaultScope},
        vault_fake::{FakeVault, QA_SECRET_ONE},
    },
    desktop_runtime::protocol::DesktopError,
};
use serde_json::{json, Value};
use std::{
    net::TcpListener,
    sync::atomic::{AtomicBool, Ordering},
    time::Instant,
};
struct LateVault {
    inner: FakeVault,
    started: Arc<AtomicBool>,
    release: Arc<AtomicBool>,
}
impl CredentialVault for LateVault {
    fn put(&self, _: &VaultScope, _: &str, _: &Secret) -> Result<()> {
        panic!("此测试不能写入vault")
    }
    fn acquire(&self, _: &VaultScope, _: &str) -> Result<Secret> {
        panic!("必须使用绑定读取")
    }
    fn owned_references(&self, s: &VaultScope) -> Result<Vec<String>> {
        self.inner.owned_references(s)
    }
    fn remove(&self, _: &VaultScope, _: &str) -> Result<()> {
        panic!("此测试不能删除vault")
    }
    fn acquire_bound_cancellable(
        &self,
        s: &VaultScope,
        r: &str,
        b: &CredentialBinding,
        _: &AtomicBool,
    ) -> Result<Secret> {
        self.started.store(true, Ordering::Release);
        let deadline = Instant::now() + Duration::from_secs(2);
        while !self.release.load(Ordering::Acquire) {
            if Instant::now() > deadline {
                return Err(DesktopError("vaultTimeout"));
            }
            std::thread::sleep(Duration::from_millis(2));
        }
        self.inner.acquire_bound(s, r, b)
    }
}
fn call(h: &FormalHost, v: Value) -> Value {
    h.command("main", v)
        .unwrap()
        .wait(Duration::from_secs(3))
        .unwrap()
}
#[test]
fn generation_cancels_pending_preparation_before_bind_or_http() {
    let root =
        TrustedRoot::create_channels_temporary(std::env::temp_dir().canonicalize().unwrap().join(
            format!("tinker-tauri-channels-preview-late-{}", std::process::id()),
        ))
        .unwrap();
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    listener.set_nonblocking(true).unwrap();
    let policy = EndpointPolicy::owned_qa(&listener, "/v1").unwrap();
    let path = root.path().join("qa-vault");
    std::fs::create_dir(&path).unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
    let mut h = FormalHost::open_channels_qa(
        &root,
        HostEnvironment::new("darwin", false, false).unwrap(),
        policy.clone(),
        FakeVault::open(path.clone()).unwrap(),
    )
    .unwrap();
    let g = call(&h, json!({"command":"bootstrap"}))["generation"].clone();
    let request = json!({"version":1,"channel":"channel:create","args":[{"channel":{"id":"channel","name":"Owned","protocol":"openai-chat","baseUrl":format!("http://{}/v1",listener.local_addr().unwrap()),"enabled":true,"models":[{"modelId":"model","label":"Model"}]},"credential":"keep"}],"mutation":{"mutationId":"save","expectedRevision":0}});
    let staged=call(&h,json!({"command":"invoke","generation":g,"channel":"channel:stage","args":[{"request":request,"secret":QA_SECRET_ONE}]}))["value"].clone();
    call(
        &h,
        json!({"command":"invoke","generation":g,"channel":staged["channel"],"args":staged["args"],"mutation":staged["mutation"]}),
    );
    let session=call(&h,json!({"command":"invoke","generation":g,"channel":"agent:create-session","args":["Owned","channel"]}))["value"]["id"].clone();
    h.shutdown().unwrap();
    drop(h);
    let started = Arc::new(AtomicBool::new(false));
    let release = Arc::new(AtomicBool::new(false));
    let vault = Arc::new(LateVault {
        inner: FakeVault::open(path).unwrap(),
        started: started.clone(),
        release: release.clone(),
    });
    let h = FormalHost::open_channels_with_vault(
        &root,
        HostEnvironment::new("darwin", false, false).unwrap(),
        policy,
        vault,
    )
    .unwrap();
    let g = call(&h, json!({"command":"bootstrap"}))["generation"].clone();
    let journal = root.path().join("desktop-runtime-v1/journal.jsonl");
    let before = std::fs::read(&journal).unwrap();
    let pending=h.command("main",json!({"command":"invoke","generation":g,"channel":"agent:send-message","args":[{"sessionId":session,"requestId":"late","startedAt":100,"channelId":"channel","modelId":"model","userMessage":"preserved"}]})).unwrap();
    let deadline = Instant::now() + Duration::from_secs(1);
    while !started.load(Ordering::Acquire) {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(2));
    }
    let start = Instant::now();
    call(&h, json!({"command":"bootstrap"}));
    assert!(start.elapsed() < Duration::from_millis(500));
    assert_eq!(
        pending.wait(Duration::from_secs(1)).unwrap_err().0,
        "staleGeneration"
    );
    release.store(true, Ordering::Release);
    drop(h);
    assert_eq!(std::fs::read(journal).unwrap(), before);
    assert_eq!(
        listener.accept().unwrap_err().kind(),
        std::io::ErrorKind::WouldBlock
    );
}
