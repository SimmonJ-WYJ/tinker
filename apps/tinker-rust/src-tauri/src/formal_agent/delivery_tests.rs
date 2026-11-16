//! 真实core/HTTP终态，确定性限制每轮仅消费一个事件，轮间重复poll模拟持续慢消费者。
use super::*;
use crate::formal_mock::OwnedMock;
use crate::formal_platform::HostEnvironment;
use std::{
    io::Write,
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc,
    },
    thread,
};

static NEXT: AtomicU64 = AtomicU64::new(0);
fn setup() -> (Actor, Receiver<EventEnvelope>, OwnedMock, String) {
    let path = std::fs::canonicalize(std::env::temp_dir())
        .unwrap()
        .join(format!(
            "tinker-tauri-formal-preview-test-delivery-{}-{}",
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
    let runtime = Arc::new(DesktopRuntime::open(root.path(), profiles).unwrap());
    let (out, events) = mpsc::sync_channel(1);
    let mut actor = Actor::new(runtime, platform, root, out);
    actor.generation = "document-1".into();
    actor.generation_seq = 1;
    actor.attached = true;
    let sid = actor.core("sessions.create", json!({"profileId":"local-mock","title":"合成测试","workspaceId":null,"reuseDraft":false})).unwrap()["sessionId"].as_str().unwrap().to_owned();
    (actor, events, mock, sid)
}
fn send(actor: &mut Actor, sid: &str, request: &str, text: &str) -> Receiver<Result<Value>> {
    let (reply, result) = mpsc::sync_channel(1);
    assert!(actor.invoke("agent:send-message", vec![json!({"sessionId":sid,"requestId":request,"startedAt":1234,"channelId":"local-mock","modelId":"local-mock-a","userMessage":text})], None, &reply).unwrap().is_none());
    result
}
fn settle(actor: &mut Actor, result: &Receiver<Result<Value>>) -> Result<Value> {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        actor.poll();
        if let Ok(result) = result.try_recv() {
            return result;
        }
        assert!(Instant::now() < deadline, "SEND不可被满outbox阻塞");
        thread::sleep(Duration::from_millis(5));
    }
}
fn slow_drain(
    actor: &mut Actor,
    events: &Receiver<EventEnvelope>,
    sid: &str,
) -> Vec<EventEnvelope> {
    let mut delivered = Vec::new();
    // 一次只释放一个slot；在下次消费前执行多次actor tick，没有依赖sleep的竞态。
    for _ in 0..12 {
        for _ in 0..4 {
            actor.poll();
        }
        if let Ok(event) = events.try_recv() {
            assert_eq!(event.generation, actor.generation);
            assert!(delivered
                .last()
                .is_none_or(
                    |previous: &EventEnvelope| previous.delivery_sequence < event.delivery_sequence
                ));
            let complete = event.channel == "agent:stream:complete";
            delivered.push(event);
            if complete {
                assert!(!actor.entries.contains_key(sid));
                assert_eq!(
                    actor.terminal_receipts[sid].sequence,
                    delivered.last().unwrap().delivery_sequence
                );
                actor.poll();
                assert!(events.try_recv().is_err(), "完成后不可无限重复终态");
                return delivered;
            }
        }
    }
    panic!(
        "持续每次只消费一个事件时必须到达COMPLETE，实际通道: {:?}",
        delivered.iter().map(|e| &e.channel).collect::<Vec<_>>()
    );
}
fn assert_terminal(events: &[EventEnvelope], expected_text: &str, error: Option<&str>) {
    let snapshots: Vec<_> = events
        .iter()
        .filter(|e| e.payload["payload"]["event"]["type"] == "text_snapshot")
        .collect();
    assert_eq!(snapshots.len(), 1, "快照已入队后不可因后续终态背压重新投递");
    assert_eq!(
        snapshots[0].payload["payload"]["event"]["text"],
        expected_text
    );
    let errors: Vec<_> = events
        .iter()
        .filter(|e| e.channel == "agent:stream:error")
        .collect();
    assert_eq!(errors.len(), usize::from(error.is_some()));
    if let Some(error) = error {
        assert_eq!(errors[0].payload["error"], error);
    }
    assert_eq!(
        events
            .iter()
            .filter(|e| e.payload["payload"]["message"]["type"] == "assistant")
            .count(),
        1
    );
    assert_eq!(events.last().unwrap().channel, "agent:stream:complete");
}
#[test]
fn sustained_slow_consumer_success_reaches_complete() {
    let (mut actor, events, mock, sid) = setup();
    let pending = send(&mut actor, &sid, "success", "hello");
    settle(&mut actor, &pending).unwrap();
    let history = actor.history(&sid).unwrap();
    let delivered = slow_drain(&mut actor, &events, &sid);
    assert_terminal(
        &delivered,
        history["messages"][1]["content"].as_str().unwrap(),
        None,
    );
    assert_eq!(
        delivered.last().unwrap().payload["messages"],
        history["messages"]
    );
    assert_eq!(mock.records().len(), 1);
}
#[test]
fn sustained_slow_consumer_provider_failure_reaches_complete() {
    let (mut actor, events, _mock, sid) = setup();
    let pending = send(&mut actor, &sid, "failure", "[partial-error]");
    assert_eq!(
        settle(&mut actor, &pending).unwrap_err().0,
        "responseFailed"
    );
    let history = actor.history(&sid).unwrap();
    let delivered = slow_drain(&mut actor, &events, &sid);
    assert_terminal(
        &delivered,
        history["messages"][1]["content"].as_str().unwrap(),
        Some("responseFailed"),
    );
}
fn projection_failure() -> (Actor, Receiver<EventEnvelope>, OwnedMock, String) {
    let (mut actor, events, mock, sid) = setup();
    actor.core("chat.send", json!({"sessionId":sid,"requestId":"ancestor","startedAt":1234,"profileId":"local-mock","modelId":"local-mock-a","userMessage":"hello","effort":null})).unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let page = actor
            .core(
                "chat.events",
                json!({"sessionId":sid,"requestId":"ancestor","afterSequence":0,"limit":128}),
            )
            .unwrap();
        if !projection::active(&page["turn"]) {
            break;
        }
        assert!(Instant::now() < deadline);
        thread::sleep(Duration::from_millis(5));
    }
    let pending = send(&mut actor, &sid, "projection-fault", "[slow] hello");
    let file = actor
        .root
        .path()
        .join("desktop-runtime-v1")
        .join(&sid)
        .join("runs-v1/ancestor.jsonl");
    std::fs::OpenOptions::new()
        .append(true)
        .open(file)
        .unwrap()
        .write_all(b"injected-corruption\n")
        .unwrap();
    actor
        .core(
            "chat.cancel",
            json!({"sessionId":sid,"requestId":"projection-fault"}),
        )
        .unwrap();
    assert_eq!(
        settle(&mut actor, &pending).unwrap_err().0,
        "runtimeUnavailable"
    );
    (actor, events, mock, sid)
}
#[test]
fn sustained_slow_consumer_projection_failure_reaches_complete() {
    let (mut actor, events, _mock, sid) = projection_failure();
    let delivered = slow_drain(&mut actor, &events, &sid);
    let errors: Vec<_> = delivered
        .iter()
        .filter(|e| e.channel == "agent:stream:error")
        .collect();
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].payload["error"], "runtimeUnavailable");
    assert_eq!(
        delivered.last().unwrap().payload["resultSubtype"],
        "error_during_execution"
    );
    assert!(!actor.draining);
}

fn command(actor: &mut Actor, command: Value) -> Value {
    let (reply, _result) = mpsc::sync_channel(1);
    actor
        .handle(serde_json::from_value(command).unwrap(), &reply)
        .unwrap()
        .unwrap()
}
fn drain_until_assistant(actor: &mut Actor, events: &Receiver<EventEnvelope>) -> u64 {
    for _ in 0..8 {
        for _ in 0..4 {
            actor.poll();
        }
        if let Ok(event) = events.try_recv() {
            if event.payload["payload"]["message"]["type"] == "assistant" {
                return event.delivery_sequence;
            }
            assert_ne!(event.channel, "agent:stream:complete");
        }
    }
    panic!("必须先得到assistant终态投影");
}
#[test]
fn partial_terminal_progress_restarts_a_complete_baseline_after_generation_attach_and_restore() {
    for reset in ["bootstrap", "attach", "restore"] {
        for text in ["hello", "[partial-error]"] {
            let (mut actor, events, mock, sid) = setup();
            let pending = send(&mut actor, &sid, "partial", text);
            let outcome = settle(&mut actor, &pending);
            assert_eq!(outcome.is_err(), text == "[partial-error]");
            let history = actor.history(&sid).unwrap();
            let observed = drain_until_assistant(&mut actor, &events);
            let previous_generation = actor.generation.clone();
            // assistant已投递，但ERROR/COMPLETE尚未入队；恢复必须重投完整基线。
            match reset {
                "bootstrap" => {
                    command(&mut actor, json!({"command":"bootstrap"}));
                    assert_ne!(actor.generation, previous_generation);
                    let generation = actor.generation.clone();
                    command(
                        &mut actor,
                        json!({"command":"attach","generation":generation,"observed":{}}),
                    );
                }
                "attach" => {
                    command(
                        &mut actor,
                        json!({"command":"detach","generation":previous_generation}),
                    );
                    command(
                        &mut actor,
                        json!({"command":"attach","generation":previous_generation,"observed":{sid.clone():observed}}),
                    );
                }
                "restore" => {
                    let bundle = command(
                        &mut actor,
                        json!({"command":"restore","generation":previous_generation,"sessionId":sid,"observedDeliverySequence":observed}),
                    );
                    assert_eq!(bundle["deliverySequence"], observed);
                    for _ in 0..4 {
                        actor.poll();
                    }
                    assert!(events.try_recv().is_err(), "屏障期间必须暂停终态");
                    command(
                        &mut actor,
                        json!({"command":"resume","generation":previous_generation,"restoreToken":bundle["restoreToken"]}),
                    );
                }
                _ => unreachable!(),
            }
            let delivered = slow_drain(&mut actor, &events, &sid);
            assert!(delivered.iter().all(|e| e.delivery_sequence > observed));
            assert_terminal(
                &delivered,
                history["messages"][1]["content"].as_str().unwrap(),
                if text == "hello" {
                    None
                } else {
                    Some("responseFailed")
                },
            );
            assert_eq!(
                delivered
                    .iter()
                    .filter(|e| e.payload["payload"]["message"]["type"] == "assistant")
                    .count(),
                1,
                "新基线不可沿用旧基线已发送的assistant阶段"
            );
            assert_eq!(mock.records().len(), 1);
        }
    }
}
#[test]
fn duplicate_send_during_terminal_backpressure_revalidates_and_settles_without_more_http() {
    let (mut actor, events, mock, sid) = setup();
    let pending = send(&mut actor, &sid, "duplicate", "hello");
    settle(&mut actor, &pending).unwrap();
    drain_until_assistant(&mut actor, &events);
    let duplicate = send(&mut actor, &sid, "duplicate", "hello");
    settle(&mut actor, &duplicate).unwrap();
    let delivered = slow_drain(&mut actor, &events, &sid);
    assert_eq!(delivered.len(), 1, "同一基线只补未发送的COMPLETE");
    assert_eq!(mock.records().len(), 1);
}

#[test]
fn projection_fault_partial_delivery_resync_replays_snapshot_error_and_complete() {
    for reset in ["bootstrap", "attach"] {
        let (mut actor, events, _mock, sid) = projection_failure();
        let mut error_sequence = None;
        for _ in 0..8 {
            for _ in 0..4 {
                actor.poll();
            }
            if let Ok(event) = events.try_recv() {
                if event.channel == "agent:stream:error" {
                    error_sequence = Some(event.delivery_sequence);
                    break;
                }
                assert_ne!(event.channel, "agent:stream:complete");
            }
        }
        let error_sequence = error_sequence.expect("故障必须投递固定错误码");
        assert!(
            !actor.terminal_receipts.contains_key(&sid),
            "ERROR不能被当作COMPLETE收据"
        );
        let expected = projection::snapshot(&actor.entries[&sid].turn);
        if reset == "bootstrap" {
            command(&mut actor, json!({"command":"bootstrap"}));
        } else {
            let generation = actor.generation.clone();
            command(
                &mut actor,
                json!({"command":"detach","generation":generation}),
            );
        }
        let generation = actor.generation.clone();
        command(
            &mut actor,
            json!({"command":"attach","generation":generation,"observed":{sid.clone():error_sequence}}),
        );
        let delivered = slow_drain(&mut actor, &events, &sid);
        assert_eq!(delivered.len(), 3);
        assert_eq!(delivered[0].payload, expected);
        assert_eq!(delivered[1].channel, "agent:stream:error");
        assert_eq!(delivered[1].payload["error"], "runtimeUnavailable");
        assert!(delivered
            .iter()
            .all(|event| event.delivery_sequence > error_sequence));
    }
}

#[test]
fn committed_cancel_failure_is_distinct_from_prepare_rejection_and_joins_actor() {
    let (mut actor, _events, _mock, sid) = setup();
    let _run = send(&mut actor, &sid, "cancel-failure", "[slow] 合成取消故障");
    // 故障注入：执行中的 owner 记录损坏；真实 core 必须拒绝不存在的 request。
    actor.entries.get_mut(&sid).unwrap().turn["requestId"] = json!("missing-request");
    let (reply, ignored) = mpsc::sync_channel(1);
    let ticket = actor
        .handle(
            Command::BeginClose {
                generation: "document-1".into(),
            },
            &reply,
        )
        .unwrap()
        .unwrap();
    drop(ignored);
    let (tx, rx) = mpsc::sync_channel(1);
    let (reply, result) = mpsc::sync_channel(1);
    tx.send(Message::Call(
        Command::CloseReady {
            generation: "document-1".into(),
            close_token: ticket["closeToken"].as_str().unwrap().into(),
            committed_revision: 0,
        },
        reply,
    ))
    .unwrap();
    let worker = thread::spawn(move || actor.run(rx));
    assert_eq!(
        result
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
            .unwrap_err()
            .0,
        "closeFailed"
    );
    worker.join().unwrap();
}

#[test]
fn deleted_delivery_retains_only_identity_not_full_history() {
    let (mut actor, _events, _mock, sid) = setup();
    let pending = send(&mut actor, &sid, "deleted", "hello");
    settle(&mut actor, &pending).unwrap();
    let (reply, _) = mpsc::sync_channel(1);
    actor
        .invoke("agent:delete-session", vec![json!(sid)], None, &reply)
        .unwrap();
    let entry = &actor.entries[&sid];
    assert!(entry.turn.get("assistantMessage").is_none());
    assert!(entry.turn.get("toolState").is_none());
    assert_eq!(
        entry.deleted_history,
        Some(json!({"messages":[],"sdkMessages":[]}))
    );
    assert!(serde_json::to_vec(&entry.turn).unwrap().len() < 8192);
}
#[test]
fn deleted_summary_budget_rejects_before_cancelling_or_tombstoning() {
    let (mut actor, _events, _mock, sid) = setup();
    let _pending = send(&mut actor, &sid, "budget", "[slow] hello");
    let turn = actor.entries[&sid].turn.clone();
    for n in 0..128 {
        let key = format!("deleted-{n}");
        actor.retain_terminal(key.clone(), turn.clone());
        actor.entries.get_mut(&key).unwrap().deleted_history =
            Some(json!({"messages":[],"sdkMessages":[]}));
    }
    let (reply, _) = mpsc::sync_channel(1);
    assert_eq!(
        actor
            .invoke("agent:delete-session", vec![json!(sid)], None, &reply)
            .unwrap_err()
            .0,
        "hostBusy"
    );
    assert!(actor.core("sessions.list", json!({})).unwrap()["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .any(|s| s["sessionId"] == sid));
    assert_ne!(
        actor
            .core(
                "chat.eventsV2",
                json!({"sessionId":sid,"requestId":"budget","afterSequence":0,"limit":1})
            )
            .unwrap()["turn"]["status"],
        "cancelled"
    );
}
