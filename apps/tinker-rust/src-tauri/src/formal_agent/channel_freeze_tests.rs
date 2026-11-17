//! 旧 receipt 和健康策略更新不能消除本实例的恢复冻结；仅重开恢复权威。
use super::*;
use crate::{formal_host::FormalHost, formal_platform::protocol::Mutation};
fn metadata(actor: &mut Actor, id: &str, revision: u64, patch: Value) -> Result<Value> {
    let (reply, _) = mpsc::sync_channel(1);
    actor
        .invoke(
            "channel:update",
            vec![json!("local-mock"), patch],
            Some(Mutation {
                mutation_id: id.into(),
                expected_revision: revision,
            }),
            &reply,
        )?
        .ok_or(DesktopError("invalidReply"))
}
fn core_input(sid: &str, id: &str) -> Value {
    json!({"sessionId":sid,"requestId":id,"startedAt":1234,"profileId":"local-mock","modelId":"local-mock-a","userMessage":"合成冻结验收","effort":null})
}
fn completed(actor: &Actor, input: Value) -> Value {
    actor.core("chat.send", input.clone()).unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let turn=actor.core("chat.eventsV2",json!({"sessionId":input["sessionId"],"requestId":input["requestId"],"afterSequence":0,"limit":1})).unwrap()["turn"].clone();
        if !projection::active(&turn) {
            assert_eq!(turn["status"], "completed");
            return turn;
        }
        assert!(Instant::now() < deadline);
        thread::sleep(Duration::from_millis(5));
    }
}
fn fresh_send(actor: &mut Actor, sid: &str, id: &str) -> Result<Option<Value>> {
    let (reply, _) = mpsc::sync_channel(1);
    actor.invoke("agent:send-message",vec![json!({"sessionId":sid,"requestId":id,"startedAt":1234,"channelId":"local-mock","modelId":"local-mock-a","userMessage":"合成新 UUID"})],None,&reply)
}
fn safe_close(actor: &mut Actor, sid: &str) {
    let (reply, _) = mpsc::sync_channel(1);
    actor
        .invoke("agent:stop", vec![json!(sid)], None, &reply)
        .unwrap();
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
}
#[test]
fn recovery_freeze_survives_old_receipt_after_uncertain_rename_and_reopens_disabled() {
    let (mut actor, _events, mock, sid) = setup();
    actor
        .runtime
        .set_availability(actor.platform.availability().unwrap())
        .unwrap();
    let accepted = core_input(&sid, "already-accepted");
    completed(&actor, accepted.clone());
    let a = metadata(&mut actor, "A", 0, json!({"name":"Alias A"})).unwrap();
    crate::formal_platform::tests::fail_after_rename(&actor.platform);
    assert_eq!(metadata(&mut actor,"B",1,json!({"models":[{"id":"local-mock-a","name":"A","enabled":false},{"id":"local-mock-b","name":"B","enabled":true}]})).unwrap_err().0,"storeIo");
    let file = actor.root.path().join("formal-platform-v1/snapshot.json");
    let uncertain = std::fs::read(&file).unwrap();
    let disk: Value = serde_json::from_slice(&uncertain).unwrap();
    assert_eq!(disk["revision"], 2);
    assert_eq!(
        disk["channelOverlay"]["channels"][0]["models"][0]["enabled"],
        false
    );
    assert_eq!(actor.platform.bootstrap().unwrap().revision, 1);
    assert_eq!(
        metadata(&mut actor, "A", 0, json!({"name":"Alias A"})).unwrap(),
        a
    );
    let count = mock.records().len();
    assert_eq!(
        fresh_send(&mut actor, &sid, "must-stay-frozen")
            .unwrap_err()
            .0,
        "recoveryRequired"
    );
    actor
        .runtime
        .set_availability(actor.platform.availability().unwrap())
        .unwrap();
    assert_eq!(
        fresh_send(&mut actor, &sid, "setter-cannot-thaw")
            .unwrap_err()
            .0,
        "recoveryRequired"
    );
    assert_eq!(
        actor.core("chat.send", accepted).unwrap()["status"],
        "completed"
    );
    assert_eq!(mock.records().len(), count);
    assert_eq!(std::fs::read(&file).unwrap(), uncertain);
    safe_close(&mut actor, &sid);
    let root = actor.root.clone();
    drop(actor);
    let mut host =
        FormalHost::open(&root, HostEnvironment::new("darwin", false, false).unwrap()).unwrap();
    let boot = host
        .command("main", json!({"command":"bootstrap"}))
        .unwrap()
        .wait(Duration::from_secs(2))
        .unwrap();
    assert_eq!(boot["platformSnapshot"]["revision"], 2);
    assert!(host.mock_records().is_empty());
    let send = json!({"command":"invoke","generation":boot["generation"],"channel":"agent:send-message","args":[{"sessionId":sid,"requestId":"reopened-disabled","startedAt":1234,"channelId":"local-mock","modelId":"local-mock-a","userMessage":"合成恢复"}]});
    assert_eq!(
        host.command("main", send)
            .unwrap()
            .wait(Duration::from_secs(2))
            .unwrap_err()
            .0,
        "modelUnavailable"
    );
    assert_eq!(std::fs::read(&file).unwrap(), uncertain);
    assert!(host.mock_records().is_empty());
    host.shutdown().unwrap();
}
#[test]
fn recovery_freeze_survives_old_receipt_after_prewrite_failure_without_rewrite() {
    let (mut actor, _events, mock, sid) = setup();
    let a = metadata(&mut actor, "A", 0, json!({"name":"Alias A"})).unwrap();
    let file = actor.root.path().join("formal-platform-v1/snapshot.json");
    std::fs::write(&file, b"{}").unwrap();
    assert_eq!(
        metadata(&mut actor, "B", 1, json!({"enabled":false}))
            .unwrap_err()
            .0,
        "storeChanged"
    );
    assert_eq!(
        metadata(&mut actor, "A", 0, json!({"name":"Alias A"})).unwrap(),
        a
    );
    actor
        .runtime
        .set_availability(actor.platform.availability().unwrap())
        .unwrap();
    assert_eq!(
        fresh_send(&mut actor, &sid, "prewrite-frozen")
            .unwrap_err()
            .0,
        "recoveryRequired"
    );
    assert!(mock.records().is_empty());
    assert_eq!(std::fs::read(file).unwrap(), b"{}");
    safe_close(&mut actor, &sid);
}
#[test]
fn recovery_freeze_cannot_be_cleared_by_setter_while_healthy_updates_work() {
    let (actor, _events, mock, sid) = setup();
    let default = core_input(&sid, "ordinary-no-policy");
    completed(&actor, default.clone());
    let policy = actor.platform.availability().unwrap();
    let mut disabled = policy.clone();
    disabled.get_mut("local-mock").unwrap().clear();
    actor.runtime.set_availability(disabled).unwrap();
    assert_eq!(
        actor
            .core("chat.send", core_input(&sid, "healthy-disabled"))
            .unwrap_err()
            .0,
        "modelUnavailable"
    );
    actor.runtime.set_availability(policy.clone()).unwrap();
    let healthy = core_input(&sid, "healthy-enabled");
    completed(&actor, healthy.clone());
    actor.runtime.freeze_availability();
    actor.runtime.set_availability(policy).unwrap();
    let count = mock.records().len();
    assert_eq!(
        actor
            .core("chat.send", core_input(&sid, "direct-frozen"))
            .unwrap_err()
            .0,
        "recoveryRequired"
    );
    assert_eq!(
        actor.core("chat.send", default).unwrap()["status"],
        "completed"
    );
    assert_eq!(
        actor.core("chat.send", healthy).unwrap()["status"],
        "completed"
    );
    assert_eq!(mock.records().len(), count);
}
