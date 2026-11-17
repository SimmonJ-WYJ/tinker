use serde_json::{json, Value};
use tinker_rust_foundation::desktop_runtime::DesktopRuntime;
#[path = "support/desktop.rs"]
mod support;
use support::*;
fn queue_runtime(f: &Fixture) -> DesktopRuntime {
    DesktopRuntime::open_with_queueing(&f.0, profiles(), vec![]).unwrap()
}
fn begin(r: &DesktopRuntime, sid: &str) -> Value {
    call(r, "chat.beginChain", send_params(sid))
}
#[test]
fn queue_acceptance_retry_and_restart_never_replays() {
    let f = Fixture::new();
    let r = queue_runtime(&f);
    let sid = create(&r, false)["result"]["sessionId"]
        .as_str()
        .unwrap()
        .to_owned();
    let a = begin(&r, &sid);
    assert!(a["error"].is_null(), "{a}");
    let p =
        json!({"sessionId":sid,"chainId":"request","uuid":"b","userMessage":"B","interrupt":false});
    let b = call(&r, "chat.queue", p.clone());
    assert!(b["error"].is_null(), "{b}");
    assert_eq!(call(&r, "chat.queue", p.clone()), b);
    drop(r);
    let r = queue_runtime(&f);
    assert_eq!(call(&r, "chat.queue", p), b);
    let state = call(
        &r,
        "chat.queueState",
        json!({"sessionId":sid,"chainId":"request","uuid":"b"}),
    );
    assert_eq!(state["result"]["closureReason"], "recovered");
    assert_eq!(state["result"]["messages"][0]["uuid"], "b");
    assert_eq!(state["result"]["messages"][0]["disposition"], "abandoned");
}
#[test]
fn early_stop_and_stale_chain_do_not_start_or_cancel_new_chain() {
    let f = Fixture::new();
    let r = queue_runtime(&f);
    let sid = create(&r, false)["result"]["sessionId"]
        .as_str()
        .unwrap()
        .to_owned();
    let stop = call(
        &r,
        "chat.stopChain",
        json!({"sessionId":sid,"chainId":"request","reason":"stop"}),
    );
    assert!(stop["error"].is_null(), "{stop}");
    assert_eq!(begin(&r, &sid)["error"]["code"], "chainClosed");
}
#[test]
fn ordinary_constructor_rejects_queue_and_strict_dtos() {
    let f = Fixture::new();
    let r = DesktopRuntime::open(&f.0, profiles()).unwrap();
    assert_eq!(
        call(&r, "chat.queueState", json!({}))["error"]["code"],
        "unknownMethod"
    );
}

fn ready() -> (Fixture, DesktopRuntime, String) {
    let f = Fixture::new();
    let r = queue_runtime(&f);
    let sid = create(&r, false)["result"]["sessionId"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(begin(&r, &sid)["error"].is_null());
    (f, r, sid)
}
fn input(sid: &str, u: &str, text: &str) -> Value {
    json!({"sessionId":sid,"chainId":"request","uuid":u,"userMessage":text,"interrupt":false})
}
#[test]
fn queued_secret_is_rejected_before_journal() {
    let (f, r, sid) = ready();
    let path = f.0.join("desktop-runtime-v1/journal.jsonl");
    let before = std::fs::read(&path).unwrap();
    let q = call(&r, "chat.queue", input(&sid, "secret", "fake-secret"));
    assert_eq!(q["error"]["code"], "toolFailed", "{q}");
    assert_eq!(std::fs::read(path).unwrap(), before);
}
#[test]
fn queue_limits_use_encoded_payload_and_acceptance_quota() {
    let (_f, r, sid) = ready();
    for n in 0..16 {
        let q = call(&r, "chat.queue", input(&sid, &format!("q{n}"), "queued"));
        assert!(q["error"].is_null(), "{q}");
    }
    assert_eq!(
        call(&r, "chat.queue", input(&sid, "extra", "queued"))["error"]["code"],
        "queueLimit"
    );
    let (_f, r, sid) = ready();
    let text = "\\".repeat(65536);
    for n in 0..3 {
        assert!(call(&r, "chat.queue", input(&sid, &format!("q{n}"), &text))["error"].is_null());
    }
    assert_eq!(
        call(&r, "chat.queue", input(&sid, "q3", &text))["error"]["code"],
        "queuePayloadLimit"
    );
}
#[test]
fn queue_unknown_fields_null_uuid_and_conflicting_retry_fail() {
    let (_f, r, sid) = ready();
    let p = input(&sid, "b", "B");
    assert!(call(&r, "chat.queue", p.clone())["error"].is_null());
    for (field, v) in [
        ("userMessage", json!("different")),
        ("interrupt", json!(true)),
        ("chainId", json!("other")),
    ] {
        let mut q = p.clone();
        q[field] = v;
        assert_eq!(
            call(&r, "chat.queue", q)["error"]["code"],
            "requestConflict"
        );
    }
    let mut q = p;
    q["profileId"] = json!("local");
    assert_eq!(call(&r, "chat.queue", q)["error"]["code"], "invalidParams");
    assert_eq!(
        call(
            &r,
            "chat.queueState",
            json!({"sessionId":sid,"chainId":"request","uuid":null})
        )["error"]["code"],
        "invalidParams"
    );
}
#[test]
fn stop_abandons_pending_and_old_stop_cannot_touch_new_chain() {
    let (_f, r, sid) = ready();
    assert!(call(&r, "chat.queue", input(&sid, "b", "B"))["error"].is_null());
    let stop = json!({"sessionId":sid,"chainId":"request","reason":"stop"});
    let closed = call(&r, "chat.stopChain", stop.clone());
    assert_eq!(closed["result"]["messages"][0]["disposition"], "abandoned");
    let mut p = send_params(&sid);
    p["requestId"] = json!("new");
    assert!(call(&r, "chat.beginChain", p)["error"].is_null());
    assert_eq!(
        call(&r, "chat.stopChain", stop)["result"]["closureReason"],
        "stop"
    );
    assert_eq!(
        call(
            &r,
            "chat.queueState",
            json!({"sessionId":sid,"chainId":"new"})
        )["result"]["closureReason"],
        Value::Null
    );
}
#[test]
fn live_chain_excludes_ordinary_send_and_begin_after_terminal() {
    let (_f, r, sid) = ready();
    std::thread::sleep(std::time::Duration::from_millis(100));
    let mut p = send_params(&sid);
    p["requestId"] = json!("bypass");
    for method in ["chat.send", "chat.beginChain"] {
        assert_eq!(call(&r, method, p.clone())["error"]["code"], "runBusy");
    }
}
#[test]
fn stale_advance_and_uncertain_journal_freeze_without_binding() {
    use std::io::Write;
    let (f, r, sid) = ready();
    assert!(call(&r, "chat.queue", input(&sid, "b", "B"))["error"].is_null());
    assert_eq!(
        call(
            &r,
            "chat.advanceQueue",
            json!({"sessionId":sid,"chainId":"request","expectedActiveRequestId":"wrong","expectedQueueRevision":2})
        )["error"]["code"],
        "staleQueue"
    );
    let path = f.0.join("desktop-runtime-v1/journal.jsonl");
    std::fs::OpenOptions::new()
        .append(true)
        .open(path)
        .unwrap()
        .write_all(b" ")
        .unwrap();
    assert_eq!(
        call(&r, "chat.queue", input(&sid, "c", "C"))["error"]["code"],
        "corruptJournal"
    );
    assert_eq!(
        call(
            &r,
            "chat.stopChain",
            json!({"sessionId":sid,"chainId":"request","reason":"stop"})
        )["error"]["code"],
        "recoveryRequired"
    );
}
#[test]
fn legacy_and_future_readers_fail_before_recovery_mutation() {
    let (f, r, sid) = ready();
    assert!(call(&r, "chat.queue", input(&sid, "b", "B"))["error"].is_null());
    drop(r);
    let path = f.0.join("desktop-runtime-v1/journal.jsonl");
    let before = std::fs::read(&path).unwrap();
    assert!(matches!(DesktopRuntime::open(&f.0,profiles()),Err(e)if e.0=="unsupportedVersion"));
    assert_eq!(std::fs::read(&path).unwrap(), before);
    let mut lines: Vec<Value> = String::from_utf8(before)
        .unwrap()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    lines.last_mut().unwrap()["version"] = json!(99);
    let future = lines.iter().map(|l| format!("{l}\n")).collect::<String>();
    std::fs::write(&path, &future).unwrap();
    assert!(
        matches!(DesktopRuntime::open_with_queueing(&f.0,profiles(),vec![]),Err(e)if e.0=="unsupportedVersion")
    );
    assert_eq!(std::fs::read_to_string(path).unwrap(), future);
}

#[test]
fn stop_collision_does_not_corrupt_journal() {
    let f = Fixture::new();
    let r = queue_runtime(&f);
    let sid = create(&r, false)["result"]["sessionId"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(call(&r, "chat.send", send_params(&sid))["error"].is_null());
    let path = f.0.join("desktop-runtime-v1/journal.jsonl");
    let before = std::fs::read(&path).unwrap();
    assert_eq!(
        call(
            &r,
            "chat.stopChain",
            json!({"sessionId":sid,"chainId":"request","reason":"stop"})
        )["error"]["code"],
        "requestConflict"
    );
    assert_eq!(std::fs::read(path).unwrap(), before);
}

#[test]
fn abandoned_acceptances_and_stop_tombstones_count_toward_request_quota() {
    let f = Fixture::new();
    let r = queue_runtime(&f);
    let sid = create(&r, false)["result"]["sessionId"]
        .as_str()
        .unwrap()
        .to_owned();
    for chain in 0..8 {
        let cid = format!("chain{chain}");
        let mut p = send_params(&sid);
        p["requestId"] = json!(cid);
        assert!(call(&r, "chat.beginChain", p)["error"].is_null());
        for n in 0..if chain == 7 { 8 } else { 16 } {
            let mut p = input(&sid, &format!("u{chain}-{n}"), "pending");
            p["chainId"] = json!(cid);
            let q = call(&r, "chat.queue", p);
            assert!(q["error"].is_null(), "{q}");
        }
        if chain == 7 {
            let mut p = input(&sid, "overflow", "pending");
            p["chainId"] = json!(cid);
            assert_eq!(call(&r, "chat.queue", p)["error"]["code"], "requestLimit");
        }
        assert!(call(
            &r,
            "chat.stopChain",
            json!({"sessionId":sid,"chainId":cid,"reason":"stop"})
        )["error"]
            .is_null());
    }
    assert_eq!(
        call(
            &r,
            "chat.stopChain",
            json!({"sessionId":sid,"chainId":"late","reason":"stop"})
        )["error"]["code"],
        "requestLimit"
    );
    drop(r);
    assert!(DesktopRuntime::open_with_queueing(&f.0, profiles(), vec![]).is_ok());
}
#[test]
fn malformed_queue_records_and_truncation_are_readonly() {
    let (f, r, sid) = ready();
    assert!(call(&r, "chat.queue", input(&sid, "b", "B"))["error"].is_null());
    drop(r);
    let path = f.0.join("desktop-runtime-v1/journal.jsonl");
    let valid = std::fs::read_to_string(&path).unwrap();
    for mode in 0..3 {
        let mut lines: Vec<Value> = valid
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect();
        let last = lines.last_mut().unwrap();
        if mode == 0 {
            last["entry"]["transition"]["receipt"]["revision"] = json!(100);
        } else if mode == 1 {
            last["entry"]["transition"]["extra"] = json!(true);
        }
        let mut corrupted = lines.iter().map(|v| format!("{v}\n")).collect::<String>();
        if mode == 2 {
            corrupted.pop();
        }
        std::fs::write(&path, &corrupted).unwrap();
        assert!(DesktopRuntime::open_with_queueing(&f.0, profiles(), vec![]).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), corrupted);
    }
}
#[test]
fn delete_closes_queue_and_preserves_unique_receipt_in_journal() {
    let (f, r, sid) = ready();
    let q = call(&r, "chat.queue", input(&sid, "b", "B"));
    assert!(q["error"].is_null());
    assert_eq!(
        call(&r, "sessions.delete", json!({"sessionId":sid}))["result"]["deleted"],
        true
    );
    drop(r);
    let r = queue_runtime(&f);
    assert!(call(&r, "sessions.list", json!({}))["result"]["sessions"]
        .as_array()
        .unwrap()
        .is_empty());
    let bytes = std::fs::read_to_string(f.0.join("desktop-runtime-v1/journal.jsonl")).unwrap();
    let accepted = bytes
        .lines()
        .filter(|l| l.contains("\"operation\":\"accept\""))
        .count();
    assert_eq!(accepted, 1);
}

#[test]
fn list_chains_discovers_recovered_intent_without_text_or_execution() {
    let (f, r, sid) = ready();
    assert!(call(&r, "chat.queue", input(&sid, "b", "private-pending-text"))["error"].is_null());
    let listed = call(&r, "chat.listChains", json!({"sessionId":sid}));
    assert!(listed["error"].is_null(), "{listed}");
    assert_eq!(listed["result"]["chains"][0]["chainId"], "request");
    assert_eq!(listed["result"]["chains"][0]["activeRequestId"], "request");
    assert!(!listed.to_string().contains("private-pending-text"));
    drop(r);
    let r = queue_runtime(&f);
    let listed = call(&r, "chat.listChains", json!({"sessionId":sid}));
    assert_eq!(listed["result"]["chains"][0]["closedReason"], "recovered");
    assert_eq!(
        call(&r, "chat.listChains", json!({"sessionId":sid,"extra":true}))["error"]["code"],
        "invalidParams"
    );
    let f2 = Fixture::new();
    let ordinary = DesktopRuntime::open(&f2.0, profiles()).unwrap();
    assert_eq!(
        call(&ordinary, "chat.listChains", json!({"sessionId":sid}))["error"]["code"],
        "unknownMethod"
    );
}

#[test]
fn execution_reference_keeps_snapshot_bounded_without_repeating_output() {
    let f = Fixture::new();
    let r = queue_runtime(&f);
    let sid = create(&r, false)["result"]["sessionId"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut p = send_params(&sid);
    p["userMessage"] = json!("\0".repeat(65536));
    let begun = call(&r, "chat.beginChain", p);
    assert!(begun["error"].is_null());
    assert!(begun["result"].get("activeTurn").is_none());
    assert_eq!(begun["result"]["activeExecution"]["requestId"], "request");
    assert!(begun["result"]["activeExecution"]
        .get("assistantMessage")
        .is_none());
    assert!(call(&r, "chat.queue", input(&sid, "b", &"\0".repeat(65536)))["error"].is_null());
    let snapshot = call(
        &r,
        "chat.queueState",
        json!({"sessionId":sid,"chainId":"request"}),
    );
    assert!(snapshot.to_string().len() < 2 * 1024 * 1024);
}
#[test]
fn pending_global_limit_is_independent_of_sessions() {
    let f = Fixture::new();
    let r = queue_runtime(&f);
    for n in 0..9 {
        let sid = create(&r, false)["result"]["sessionId"]
            .as_str()
            .unwrap()
            .to_owned();
        let cid = format!("global{n}");
        let mut p = send_params(&sid);
        p["requestId"] = json!(cid);
        assert!(call(&r, "chat.beginChain", p)["error"].is_null());
        for m in 0..if n == 8 { 1 } else { 16 } {
            let mut p = input(&sid, &format!("g{n}-{m}"), "pending");
            p["chainId"] = json!(cid);
            let q = call(&r, "chat.queue", p);
            if n == 8 {
                assert_eq!(q["error"]["code"], "queueLimit");
            } else {
                assert!(q["error"].is_null(), "{q}");
            }
        }
    }
}

#[test]
fn impossible_queue_transitions_fail_global_preflight_before_recovery() {
    use std::io::Write;
    for mode in 0..3 {
        let (f, r, sid) = ready();
        let q = call(&r, "chat.queue", input(&sid, "b", "B"));
        assert!(q["error"].is_null());
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            let page = call(
                &r,
                "chat.events",
                json!({"sessionId":sid,"requestId":"request","afterSequence":0,"limit":1}),
            );
            if page["result"]["turn"]["status"] == "failed" {
                break;
            }
            assert!(std::time::Instant::now() < deadline);
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        if mode == 2 {
            assert!(call(
                &r,
                "chat.stopChain",
                json!({"sessionId":sid,"chainId":"request","reason":"stop"})
            )["error"]
                .is_null());
        }
        drop(r);
        let path = f.0.join("desktop-runtime-v1/journal.jsonl");
        let text = std::fs::read_to_string(&path).unwrap();
        let seq = text.lines().count() + 1;
        let at = q["result"]["acceptedAt"].as_u64().unwrap() + 1;
        let transition = match mode {
            0 => {
                json!({"operation":"close","sessionId":sid,"chainId":"request","revision":3,"reason":"completed"})
            }
            1 => {
                json!({"operation":"bind","sessionId":sid,"chainId":"request","uuid":"b","revision":3,"acceptedAt":at,"parent":"request","redirectSequence":null})
            }
            _ => {
                let mut request = send_params(&sid);
                request["requestId"] = json!("b");
                json!({"operation":"begin","binding":{"request":request,"configRevision":"r1","acceptedAt":at,"parentRunId":null}})
            }
        };
        let event =
            json!({"version":2,"sequence":seq,"entry":{"kind":"queue","transition":transition}});
        std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap()
            .write_all(format!("{event}\n").as_bytes())
            .unwrap();
        let before = std::fs::read(&path).unwrap();
        assert!(
            DesktopRuntime::open_with_queueing(&f.0, profiles(), vec![]).is_err(),
            "accepted impossible transition {mode}"
        );
        assert_eq!(std::fs::read(path).unwrap(), before);
    }
}

#[test]
fn deleted_session_exact_retry_returns_receipt_without_revealing_history() {
    let (f, r, sid) = ready();
    let p = input(&sid, "b", "B");
    let receipt = call(&r, "chat.queue", p.clone());
    assert!(receipt["error"].is_null());
    assert!(call(&r, "sessions.delete", json!({"sessionId":sid}))["error"].is_null());
    assert_eq!(call(&r, "chat.queue", p.clone()), receipt);
    let mut conflict = p.clone();
    conflict["sessionId"] = json!("missing-session");
    assert_eq!(
        call(&r, "chat.queue", conflict)["error"]["code"],
        "requestConflict"
    );
    assert_eq!(
        call(
            &r,
            "chat.queueState",
            json!({"sessionId":sid,"chainId":"request"})
        )["error"]["code"],
        "sessionNotFound"
    );
    assert_eq!(
        call(&r, "chat.queue", input(&sid, "new", "new"))["error"]["code"],
        "sessionNotFound"
    );
    drop(r);
    let r = queue_runtime(&f);
    assert_eq!(call(&r, "chat.queue", p), receipt);
}

fn review_fixture_tree(root: &std::path::Path) -> Vec<(std::path::PathBuf, Vec<u8>)> {
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(root).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            entries.push((path.clone(), vec![]));
            entries.extend(review_fixture_tree(&path));
        } else {
            entries.push((path.clone(), std::fs::read(path).unwrap()));
        }
    }
    entries.sort();
    entries
}
fn review_append_entry(root: &std::path::Path, version: u32, entry: Value) {
    use std::io::Write;
    let path = root.join("desktop-runtime-v1/journal.jsonl");
    let sequence = std::fs::read_to_string(&path).unwrap().lines().count() + 1;
    let record = json!({"version":version,"sequence":sequence,"entry":entry});
    std::fs::OpenOptions::new()
        .append(true)
        .open(path)
        .unwrap()
        .write_all(format!("{record}\n").as_bytes())
        .unwrap();
}
fn review_leave_run_nonterminal(
    root: &std::path::Path,
    sid: &str,
    rid: &str,
) -> std::path::PathBuf {
    let path = root.join(format!("desktop-runtime-v1/{sid}/runs-v1/{rid}.jsonl"));
    let text = std::fs::read_to_string(&path).unwrap();
    let lines: Vec<_> = text.lines().take(2).collect();
    assert_eq!(lines.len(), 2);
    let started: Value = serde_json::from_str(lines[1]).unwrap();
    assert_eq!(started["kind"], "started");
    std::fs::write(&path, format!("{}\n", lines.join("\n"))).unwrap();
    path
}
#[test]
fn review_i1_plain_bind_cannot_reuse_early_stop_tombstone() {
    let f = Fixture::new();
    let r = queue_runtime(&f);
    let session = create(&r, false)["result"].clone();
    let sid = session["sessionId"].as_str().unwrap();
    assert!(call(
        &r,
        "chat.stopChain",
        json!({"sessionId":sid,"chainId":"stopped-slot","reason":"stop"})
    )["error"]
        .is_null());
    drop(r);
    let mut request = send_params(sid);
    request["requestId"] = json!("stopped-slot");
    review_append_entry(
        &f.0,
        1,
        json!({"kind":"bind","binding":{"request":request,"configRevision":"r1","acceptedAt":session["updatedAt"].as_u64().unwrap()+1,"parentRunId":null}}),
    );
    let before = review_fixture_tree(&f.0);
    let reopened = DesktopRuntime::open_with_queueing(&f.0, profiles(), vec![]);
    assert!(
        review_fixture_tree(&f.0) == before,
        "重放拒绝不能修改 journal、run 或 cache"
    );
    assert!(
        matches!(reopened,Err(e)if e.0=="corruptJournal"),
        "早期 Stop 身份不得重放为普通 Bind"
    );
}
#[test]
fn review_i2_deleted_open_chain_is_rejected_before_global_recovery() {
    let f = Fixture::new();
    let r = queue_runtime(&f);
    let other = create(&r, false)["result"]["sessionId"]
        .as_str()
        .unwrap()
        .to_owned();
    let mut request = send_params(&other);
    request["requestId"] = json!("other-running");
    assert!(call(&r, "chat.send", request)["error"].is_null());
    let queued = create(&r, false)["result"]["sessionId"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(begin(&r, &queued)["error"].is_null());
    let mut session = call(&r, "sessions.list", json!({}))["result"]["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["sessionId"] == queued)
        .unwrap()
        .clone();
    drop(r);
    review_leave_run_nonterminal(&f.0, &other, "other-running");
    review_leave_run_nonterminal(&f.0, &queued, "request");
    session["deleted"] = json!(true);
    session["updatedAt"] = json!(session["updatedAt"].as_u64().unwrap() + 1);
    review_append_entry(&f.0, 1, json!({"kind":"session","session":session}));
    let before = review_fixture_tree(&f.0);
    let reopened = DesktopRuntime::open_with_queueing(&f.0, profiles(), vec![]);
    assert!(
        review_fixture_tree(&f.0) == before,
        "全局预检失败不得向任一 session 的 run/cache 写入恢复记录"
    );
    assert!(matches!(reopened,Err(e)if e.0=="corruptJournal"));
}
#[test]
fn review_legacy_nonqueue_deletion_remains_recoverable() {
    for queue_enabled in [false, true] {
        let f = Fixture::new();
        let r = DesktopRuntime::open(&f.0, profiles()).unwrap();
        let sid = create(&r, false)["result"]["sessionId"]
            .as_str()
            .unwrap()
            .to_owned();
        assert!(call(&r, "chat.send", send_params(&sid))["error"].is_null());
        assert_eq!(
            call(&r, "sessions.delete", json!({"sessionId":sid}))["result"]["deleted"],
            true
        );
        drop(r);
        let run = review_leave_run_nonterminal(&f.0, &sid, "request");
        let journal = f.0.join("desktop-runtime-v1/journal.jsonl");
        let before = std::fs::read(&journal).unwrap();
        let r = if queue_enabled {
            DesktopRuntime::open_with_queueing(&f.0, profiles(), vec![])
        } else {
            DesktopRuntime::open(&f.0, profiles())
        }
        .unwrap();
        assert!(call(&r, "sessions.list", json!({}))["result"]["sessions"]
            .as_array()
            .unwrap()
            .is_empty());
        assert_eq!(std::fs::read(journal).unwrap(), before);
        let text = std::fs::read_to_string(run).unwrap();
        let last: Value = serde_json::from_str(text.lines().last().unwrap()).unwrap();
        assert_eq!(last["kind"], "interrupted");
    }
}
