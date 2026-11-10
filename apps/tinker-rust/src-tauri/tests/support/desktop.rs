use serde_json::{json, Value};
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};
use tinker_rust_foundation::desktop_runtime::{DesktopRuntime, TrustedProfile};
static NEXT: AtomicU64 = AtomicU64::new(0);
pub struct Fixture(pub PathBuf);
impl Fixture {
    pub fn new() -> Self {
        let p = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "desktop-service-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&p).unwrap();
        Self(p)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
pub fn profiles() -> Vec<TrustedProfile> {
    serde_json::from_value(json!([{"profileId":"local","label":"Synthetic","configRevision":"r1","models":[{"modelId":"model","label":"Model"}],"endpoint":"http://127.0.0.1:1/v1/chat/completions","key":"fake-secret"}])).unwrap()
}
pub fn call(r: &DesktopRuntime, method: &str, params: Value) -> Value {
    serde_json::to_value(
        r.dispatch(json!({"version":1,"id":"wire-1","method":method,"params":params}))
            .unwrap(),
    )
    .unwrap()
}
pub fn create(r: &DesktopRuntime, reuse: bool) -> Value {
    call(
        r,
        "sessions.create",
        json!({"title":"你好","profileId":"local","workspaceId":null,"reuseDraft":reuse}),
    )
}

pub fn send_params(session: &str) -> Value {
    json!({"sessionId":session,"requestId":"request","profileId":"local","modelId":"model","userMessage":"hello","startedAt":123,"effort":null})
}
