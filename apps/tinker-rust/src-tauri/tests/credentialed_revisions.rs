use serde_json::json;
use tinker_rust_foundation::desktop_runtime::DesktopRuntime;
#[allow(dead_code)]
#[path = "support/desktop.rs"]
mod support;
use support::*;
#[test]
fn empty_managed_catalog_opens_and_allows_an_unconfigured_draft_only() {
    let f = Fixture::new();
    let r = DesktopRuntime::open_managed(&f.0).expect("empty managed catalog must boot");
    assert_eq!(
        call(&r, "profiles.list", json!({}))["result"]["profiles"],
        json!([])
    );
    let draft = call(
        &r,
        "sessions.create",
        json!({"title":"Draft","profileId":"unconfigured","workspaceId":null,"reuseDraft":true}),
    );
    assert!(draft["error"].is_null(), "{draft}");
    let mut p = send_params(draft["result"]["sessionId"].as_str().unwrap());
    p["profileId"] = json!("unconfigured");
    assert_eq!(call(&r, "chat.send", p)["error"]["code"], "profileNotFound");
    assert_eq!(create(&r, false)["error"]["code"], "profileNotFound");
    assert!(DesktopRuntime::open(&Fixture::new().0, vec![]).is_err());
}

use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tinker_rust_foundation::{
    chat_http::HttpProtocol,
    desktop_runtime::{
        protocol::Result,
        revisions::{ManagedProfile, ManagedProviderFactory, PreparedProfiles},
        Model,
    },
    run_provider::RunProvider,
    run_types::RunError,
};
struct Provider {
    revision: &'static str,
    calls: Arc<Mutex<Vec<String>>>,
    release: Arc<AtomicBool>,
}
impl RunProvider for Provider {
    fn validate_tool_metadata(
        &self,
        value: &serde_json::Value,
    ) -> std::result::Result<(), RunError> {
        if value.to_string().contains("DO-NOT-PERSIST") {
            Err(RunError::ToolFailed)
        } else {
            Ok(())
        }
    }
    fn execute(
        &self,
        _: &str,
        cancel: &AtomicBool,
        emit: &mut dyn FnMut(&str) -> std::result::Result<(), RunError>,
    ) -> std::result::Result<(), RunError> {
        self.calls.lock().unwrap().push(self.revision.into());
        while !self.release.load(Ordering::Acquire) && !cancel.load(Ordering::Acquire) {
            std::thread::sleep(Duration::from_millis(2));
        }
        if !cancel.load(Ordering::Acquire) {
            emit("synthetic response")?;
        }
        Ok(())
    }
    fn execute_context(
        &self,
        _: &tinker_rust_foundation::run_context::RunContext,
        cancel: &AtomicBool,
        emit: &mut dyn FnMut(&str) -> std::result::Result<(), RunError>,
    ) -> std::result::Result<(), RunError> {
        self.execute("", cancel, emit)
    }
}
impl ManagedProviderFactory for Provider {
    fn provider(&self, _: &str, _: Option<&str>) -> Result<Arc<dyn RunProvider>> {
        Ok(Arc::new(Self {
            revision: self.revision,
            calls: self.calls.clone(),
            release: self.release.clone(),
        }))
    }
}
fn revision(
    rev: &'static str,
    calls: &Arc<Mutex<Vec<String>>>,
    release: &Arc<AtomicBool>,
    with_factory: bool,
) -> ManagedProfile {
    ManagedProfile {
        profile_id: "local".into(),
        label: "Synthetic".into(),
        config_revision: rev.into(),
        models: vec![Model {
            model_id: "model".into(),
            label: "Model".into(),
            supported_efforts: vec![],
        }],
        protocol: HttpProtocol::OpenaiChat,
        authority: format!("nonsecret-{rev}"),
        factory: with_factory.then(|| {
            Arc::new(Provider {
                revision: rev,
                calls: calls.clone(),
                release: release.clone(),
            }) as Arc<dyn ManagedProviderFactory>
        }),
    }
}
fn install(r: &DesktopRuntime, revs: Vec<ManagedProfile>, current: Option<&str>) {
    r.install_managed(
        PreparedProfiles::new(
            revs,
            current
                .map(|v| BTreeMap::from([("local".into(), v.into())]))
                .unwrap_or_default(),
            current
                .map(|_| BTreeMap::from([("local".into(), BTreeSet::from(["model".into()]))]))
                .unwrap_or_default(),
        )
        .unwrap(),
    )
    .unwrap();
}
fn wait_calls(calls: &Arc<Mutex<Vec<String>>>, n: usize) {
    let start = Instant::now();
    while calls.lock().unwrap().len() < n {
        assert!(start.elapsed() < Duration::from_secs(3));
        std::thread::sleep(Duration::from_millis(2));
    }
}
fn terminal(r: &DesktopRuntime, sid: &str, id: &str) {
    let start = Instant::now();
    loop {
        let p = call(
            r,
            "chat.events",
            json!({"sessionId":sid,"requestId":id,"afterSequence":0,"limit":100}),
        );
        if p["result"]["turn"]["status"] == "completed"
            || p["result"]["snapshot"]["status"] == "completed"
        {
            return;
        }
        assert!(start.elapsed() < Duration::from_secs(3), "{p}");
        std::thread::sleep(Duration::from_millis(2));
    }
}
#[test]
fn accepted_queue_keeps_revision_across_rotation_and_receipts_survive_delete() {
    let f = Fixture::new();
    let r = DesktopRuntime::open_managed(&f.0).unwrap();
    let calls = Arc::new(Mutex::new(Vec::new()));
    let release = Arc::new(AtomicBool::new(false));
    install(&r, vec![revision("r1", &calls, &release, true)], Some("r1"));
    let created = create(&r, false);
    assert!(created["error"].is_null(), "{created}");
    let sid = created["result"]["sessionId"].as_str().unwrap();
    let a = send_params(sid);
    let start = call(&r, "chat.beginChain", a.clone());
    assert!(start["error"].is_null(), "{start}");
    wait_calls(&calls, 1);
    let b =
        json!({"sessionId":sid,"chainId":"request","uuid":"b","userMessage":"B","interrupt":false});
    let receipt = call(&r, "chat.queue", b.clone());
    assert!(receipt["error"].is_null(), "{receipt}");
    install(
        &r,
        vec![
            revision("r1", &calls, &release, false),
            revision("r2", &calls, &release, true),
        ],
        Some("r2"),
    );
    release.store(true, Ordering::Release);
    terminal(&r, sid, "request");
    let state = call(
        &r,
        "chat.queueState",
        json!({"sessionId":sid,"chainId":"request"}),
    );
    let advance = call(
        &r,
        "chat.advanceQueue",
        json!({"sessionId":sid,"chainId":"request","expectedQueueRevision":state["result"]["revision"],"expectedActiveRequestId":"request"}),
    );
    assert!(advance["error"].is_null(), "{advance}");
    wait_calls(&calls, 2);
    terminal(&r, sid, "b");
    assert_eq!(*calls.lock().unwrap(), vec!["r1", "r1"]);
    assert!(call(
        &r,
        "chat.stopChain",
        json!({"sessionId":sid,"chainId":"request","reason":"stop"})
    )["error"]
        .is_null());
    let mut c = send_params(sid);
    c["requestId"] = json!("c");
    assert!(call(&r, "chat.send", c.clone())["error"].is_null());
    wait_calls(&calls, 3);
    terminal(&r, sid, "c");
    assert_eq!(*calls.lock().unwrap(), vec!["r1", "r1", "r2"]);
    install(
        &r,
        vec![
            revision("r1", &calls, &release, false),
            revision("r2", &calls, &release, false),
        ],
        None,
    );
    assert_eq!(call(&r, "chat.queue", b.clone()), receipt);
    assert!(call(&r, "chat.beginChain", a.clone())["error"].is_null());
    assert!(call(&r, "chat.send", c.clone())["error"].is_null());
    let mut fresh = c.clone();
    fresh["requestId"] = json!("d");
    assert_eq!(
        call(&r, "chat.send", fresh)["error"]["code"],
        "profileNotFound"
    );
    drop(r);
    let r = DesktopRuntime::open_managed_with_profiles(
        &f.0,
        PreparedProfiles::new(
            vec![
                revision("r1", &calls, &release, false),
                revision("r2", &calls, &release, false),
            ],
            BTreeMap::new(),
            BTreeMap::new(),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(call(&r, "chat.queue", b), receipt);
    assert!(call(&r, "chat.beginChain", a)["error"].is_null());
    assert!(call(&r, "chat.send", c)["error"].is_null());
    assert_eq!(calls.lock().unwrap().len(), 3);
}
#[test]
fn managed_missing_revision_metadata_is_rejected_before_recovery() {
    let f = Fixture::new();
    let r = DesktopRuntime::open_managed(&f.0).unwrap();
    let calls = Arc::new(Mutex::new(Vec::new()));
    let release = Arc::new(AtomicBool::new(false));
    install(&r, vec![revision("r1", &calls, &release, true)], Some("r1"));
    let created = create(&r, false);
    let sid = created["result"]["sessionId"].as_str().unwrap();
    assert!(call(&r, "chat.beginChain", send_params(sid))["error"].is_null());
    wait_calls(&calls, 1);
    drop(r);
    let journal = f.0.join("desktop-runtime-v1/journal.jsonl");
    let before = std::fs::read(&journal).unwrap();
    assert!(
        DesktopRuntime::open_managed(&f.0).is_err(),
        "missing catalog metadata must fail before recovery writes"
    );
    assert_eq!(std::fs::read(journal).unwrap(), before);
}
#[test]
fn runtime_install_conflict_freezes_fresh_work_without_hiding_history() {
    let f = Fixture::new();
    let r = DesktopRuntime::open_managed(&f.0).unwrap();
    let calls = Arc::new(Mutex::new(Vec::new()));
    let release = Arc::new(AtomicBool::new(true));
    install(&r, vec![revision("r1", &calls, &release, true)], Some("r1"));
    let created = create(&r, false);
    let sid = created["result"]["sessionId"].as_str().unwrap();
    let a = send_params(sid);
    assert!(call(&r, "chat.send", a.clone())["error"].is_null());
    terminal(&r, sid, "request");
    let mut changed = revision("r1", &calls, &release, false);
    changed.authority = "different-connection".into();
    let prepared = PreparedProfiles::new(
        vec![changed],
        BTreeMap::from([("local".into(), "r1".into())]),
        BTreeMap::from([("local".into(), BTreeSet::from(["model".into()]))]),
    )
    .unwrap();
    assert!(r.install_managed(prepared).is_err());
    assert!(call(&r, "chat.send", a)["error"].is_null());
    let mut next = send_params(sid);
    next["requestId"] = json!("new");
    assert_eq!(
        call(&r, "chat.send", next)["error"]["code"],
        "recoveryRequired"
    );
    assert!(r
        .install_managed(PreparedProfiles::new(vec![], BTreeMap::new(), BTreeMap::new()).unwrap())
        .is_err());
}

#[test]
fn managed_plain_send_validates_credential_echo_before_binding() {
    let f = Fixture::new();
    let r = DesktopRuntime::open_managed(&f.0).unwrap();
    let calls = Arc::new(Mutex::new(Vec::new()));
    let release = Arc::new(AtomicBool::new(true));
    install(&r, vec![revision("r1", &calls, &release, true)], Some("r1"));
    let created = create(&r, false);
    let sid = created["result"]["sessionId"].as_str().unwrap();
    let mut request = send_params(sid);
    request["userMessage"] = json!("DO-NOT-PERSIST");
    let before = std::fs::read(f.0.join("desktop-runtime-v1/journal.jsonl")).unwrap();
    assert_eq!(
        call(&r, "chat.send", request)["error"]["code"],
        "toolFailed"
    );
    assert_eq!(
        std::fs::read(f.0.join("desktop-runtime-v1/journal.jsonl")).unwrap(),
        before
    );
    assert!(calls.lock().unwrap().is_empty());
}
#[test]
fn missing_current_credential_is_recoverable_and_never_executes() {
    let f = Fixture::new();
    let r = DesktopRuntime::open_managed(&f.0).unwrap();
    let calls = Arc::new(Mutex::new(Vec::new()));
    let release = Arc::new(AtomicBool::new(true));
    install(
        &r,
        vec![revision("r1", &calls, &release, false)],
        Some("r1"),
    );
    let created = create(&r, false);
    let sid = created["result"]["sessionId"].as_str().unwrap();
    assert_eq!(
        call(&r, "chat.send", send_params(sid))["error"]["code"],
        "credentialUnavailable"
    );
    assert!(calls.lock().unwrap().is_empty());
    assert!(call(
        &r,
        "sessions.history",
        json!({"sessionId":sid,"after":0,"limit":20})
    )["error"]
        .is_null());
}
