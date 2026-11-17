//! 在真实 Begin 接受后破坏合成祖先日志，验证投影故障不能遗漏生命周期归属。
use super::*;
use crate::{formal_mock::OwnedMock, formal_platform::HostEnvironment};
use std::{
    io::Write,
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc,
    },
    thread,
};
static NEXT: AtomicU64 = AtomicU64::new(0);
fn setup() -> (Actor, OwnedMock, String) {
    let path = std::env::temp_dir().canonicalize().unwrap().join(format!(
        "tinker-tauri-formal-preview-queue-fault-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let root = TrustedRoot::create_temporary(path).unwrap();
    let mock = OwnedMock::start().unwrap();
    let profiles = mock.profiles().unwrap();
    let platform = FormalPlatform::open(
        &root,
        &profiles,
        HostEnvironment::new("darwin", false, false).unwrap(),
    )
    .unwrap();
    let runtime =
        Arc::new(DesktopRuntime::open_with_queueing(root.path(), profiles, vec![]).unwrap());
    let (out, _events) = mpsc::sync_channel(1);
    let mut actor = Actor::new(runtime, platform, root, out);
    actor.queueing = true;
    actor.generation = "document-1".into();
    let sid=actor.core("sessions.create",json!({"profileId":"local-mock","title":"合成故障","workspaceId":null,"reuseDraft":false})).unwrap()["sessionId"].as_str().unwrap().into();
    (actor, mock, sid)
}
fn input(sid: &str, id: &str) -> Value {
    json!({"sessionId":sid,"requestId":id,"startedAt":1234,"profileId":"local-mock","modelId":"local-mock-a","userMessage":"[slow] owned queue","effort":null})
}
fn corrupt_ancestor(actor: &Actor) {
    let sessions = actor.core("sessions.list", json!({})).unwrap();
    let sid = sessions["sessions"][0]["sessionId"].as_str().unwrap();
    let file = actor
        .root
        .path()
        .join("desktop-runtime-v1")
        .join(sid)
        .join("runs-v1/ancestor.jsonl");
    std::fs::OpenOptions::new()
        .append(true)
        .open(file)
        .unwrap()
        .write_all(b"injected-corruption\n")
        .unwrap();
}
#[test]
fn post_acceptance_history_failure_durably_closes_exact_chain_and_bars_children() {
    let (mut actor, mock, sid) = setup();
    let mut ancestor = input(&sid, "ancestor");
    ancestor["userMessage"] = json!("hello");
    actor.core("chat.send", ancestor).unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let turn = actor
            .core(
                "chat.eventsV2",
                json!({"sessionId":sid,"requestId":"ancestor","afterSequence":0,"limit":1}),
            )
            .unwrap();
        if !projection::active(&turn["turn"]) {
            break;
        }
        assert!(Instant::now() < deadline);
        thread::sleep(Duration::from_millis(5));
    }
    actor.queue_after_begin = Some(corrupt_ancestor);
    assert!(actor.begin_queue(input(&sid, "accepted")).is_err());
    let state = actor
        .core(
            "chat.queueState",
            json!({"sessionId":sid,"chainId":"accepted"}),
        )
        .unwrap();
    assert_eq!(state["activeExecution"]["requestId"], "accepted");
    assert_eq!(
        state["closureReason"], "failure",
        "投影失败不能留下无人管理的运行链"
    );
    assert_eq!(state["activeExecution"]["status"], "cancelled");
    assert_eq!(actor.core("chat.queue",json!({"sessionId":sid,"chainId":"accepted","uuid":"child","userMessage":"不得开始","interrupt":false})).unwrap_err().0,"chainClosed");
    actor.cancel_all().unwrap();
    assert!(mock.records().len() <= 2, "不能执行排队子消息");
    let (reply, _rx) = mpsc::sync_channel(1);
    let ticket = actor
        .handle(
            Command::BeginClose {
                generation: actor.generation.clone(),
            },
            &reply,
        )
        .unwrap()
        .unwrap();
    actor
        .handle(
            Command::CloseReady {
                generation: actor.generation.clone(),
                close_token: ticket["closeToken"].as_str().unwrap().into(),
                committed_revision: ticket["baselineRevision"].as_u64().unwrap(),
            },
            &reply,
        )
        .unwrap();
    actor.cancel_all().unwrap();
    assert!(actor.draining);
}
#[test]
fn unaccepted_begin_removes_only_its_reservation_and_preserves_existing_owner() {
    let (mut actor, _mock, sid) = setup();
    actor.begin_queue(input(&sid, "current")).unwrap();
    let mut invalid = input(&sid, "rejected");
    invalid["modelId"] = json!("absent");
    assert!(actor.begin_queue(invalid).is_err());
    assert!(!actor.queue_entries.contains_key("rejected"));
    assert!(actor.queue_entries.contains_key("current"));
    let state = actor
        .core(
            "chat.queueState",
            json!({"sessionId":sid,"chainId":"current"}),
        )
        .unwrap();
    assert!(state["closureReason"].is_null());
    actor.cancel_all().unwrap();
}

fn fail_cancel_after_begin(actor: &Actor) {
    corrupt_ancestor(actor);
    let entry = actor.queue_entries.get("uncertain").unwrap();
    let sid = entry.state["sessionId"].as_str().unwrap();
    let file = actor
        .root
        .path()
        .join("desktop-runtime-v1")
        .join(sid)
        .join("runs-v1/context-v2/uncertain.jsonl");
    std::fs::rename(&file, file.with_extension("saved")).unwrap();
    std::fs::create_dir(file).unwrap();
}
#[test]
fn post_acceptance_uncertain_cancel_retains_owner_and_cannot_acknowledge_safe_close() {
    let (mut actor, mock, sid) = setup();
    let mut ancestor = input(&sid, "ancestor");
    ancestor["userMessage"] = json!("hello");
    actor.core("chat.send", ancestor).unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let turn = actor
            .core(
                "chat.eventsV2",
                json!({"sessionId":sid,"requestId":"ancestor","afterSequence":0,"limit":1}),
            )
            .unwrap();
        if !projection::active(&turn["turn"]) {
            break;
        }
        assert!(Instant::now() < deadline);
        thread::sleep(Duration::from_millis(5));
    }
    actor.queue_after_begin = Some(fail_cancel_after_begin);
    let failure = actor.begin_queue(input(&sid, "uncertain")).unwrap_err();
    assert!(
        actor.queue_entries.contains_key("uncertain"),
        "保留归属失败: {}",
        failure.0
    );
    assert_eq!(
        actor.queue_entries["uncertain"].state["activeExecution"]["requestId"],
        "uncertain"
    );
    assert!(
        actor.draining,
        "取消未证明安全时退出接收循环，保留归属直到 runtime join"
    );
    assert!(
        actor.cancel_all().is_err(),
        "不能向 CloseReady 伪造安全完成"
    );
    assert!(actor.core("chat.queue",json!({"sessionId":sid,"chainId":"uncertain","uuid":"child","userMessage":"不得开始","interrupt":false})).is_err());
    assert!(mock.records().len() <= 2);
}
