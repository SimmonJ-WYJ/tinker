//! 工具日志的纯合成行为与崩溃边界。
use crate::{
    run_store::RunStore, run_types::*, session_lifecycle::RunStatus, tool_journal::*, tool_types::*,
};
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};
static NEXT: AtomicU64 = AtomicU64::new(0);
struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!(
            "tinker-tools-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&p).unwrap();
        Self(p)
    }
    fn log(&self, id: &str) -> PathBuf {
        self.0.join("runs-v1/tools-v3").join(format!("{id}.jsonl"))
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn create(s: &RunStore, id: &str, order: u64) -> StoredToolRun {
    s.create_tool_run(ToolRunHeader {
        storage_version: 3,
        policy_version: 1,
        run_id: id.into(),
        input: "question".into(),
        created_order: order,
        parent: None,
        workspace_revision: "synthetic-v1".into(),
    })
    .unwrap()
}
fn add(s: &RunStore, r: &mut StoredToolRun, e: ToolRecordKind) {
    s.append_tool_record(r, e).unwrap();
}
fn call(round: u8) -> ToolCall {
    ToolCall {
        round,
        call_id: format!("call-{round}"),
        name: if round == 0 {
            ToolName::WorkspaceList
        } else {
            ToolName::WorkspaceRead
        },
        arguments: ToolArguments {
            path: "a.txt".into(),
        },
    }
}
fn pending(s: &RunStore, r: &mut StoredToolRun, round: u8) {
    if round == 0 {
        add(s, r, ToolRecordKind::Started);
    }
    add(s, r, ToolRecordKind::RoundStarted { round });
    add(
        s,
        r,
        ToolRecordKind::TextDelta {
            round,
            text: format!("round{round}"),
        },
    );
    add(
        s,
        r,
        ToolRecordKind::RoundFinished {
            round,
            call: Some(call(round)),
        },
    );
    add(
        s,
        r,
        ToolRecordKind::PermissionRequested {
            ticket: PermissionTicket {
                permission_id: format!("p-{}-{round}", r.header.run_id),
                run_id: r.header.run_id.clone(),
                call: call(round),
                workspace_revision: r.header.workspace_revision.clone(),
                expires_at_ms: 123,
            },
        },
    );
}
fn resolve(s: &RunStore, r: &mut StoredToolRun, decision: PermissionDecision) {
    add(
        s,
        r,
        ToolRecordKind::PermissionResolved {
            receipt: PermissionReceipt {
                permission_id: r.snapshot.pending.as_ref().unwrap().permission_id.clone(),
                decision,
                sequence: r.snapshot.sequence + 1,
            },
        },
    );
}
fn result(round: u8, outcome: ToolOutcome) -> ToolResult {
    ToolResult {
        call_id: format!("call-{round}"),
        outcome,
        content: "synthetic result".into(),
    }
}
fn result_at_encoded_limit(mut result: ToolResult, fragment: &str) -> ToolResult {
    result.content.clear();
    let available = MAX_TOOL_RESULT_BYTES - serde_json::to_vec(&result).unwrap().len();
    let fragment_bytes = serde_json::to_vec(fragment).unwrap().len() - 2;
    result.content = fragment.repeat(available / fragment_bytes);
    result
        .content
        .push_str(&"x".repeat(available % fragment_bytes));
    assert_eq!(
        serde_json::to_vec(&result).unwrap().len(),
        MAX_TOOL_RESULT_BYTES
    );
    result
}
fn complete(s: &RunStore, r: &mut StoredToolRun, round: u8) {
    add(s, r, ToolRecordKind::RoundStarted { round });
    add(
        s,
        r,
        ToolRecordKind::TextDelta {
            round,
            text: "answer".into(),
        },
    );
    add(s, r, ToolRecordKind::RoundFinished { round, call: None });
    add(
        s,
        r,
        ToolRecordKind::Terminated {
            status: RunStatus::Completed,
            error_code: None,
            closed_call: None,
        },
    );
}
#[test]
fn tool_journal_two_rounds_reopen_and_context() {
    let t = Temp::new();
    let s = RunStore::open(&t.0).unwrap();
    let mut r = create(&s, "one", 1);
    for round in 0..2 {
        pending(&s, &mut r, round);
        resolve(&s, &mut r, PermissionDecision::Granted);
        add(
            &s,
            &mut r,
            ToolRecordKind::ToolStarted {
                call_id: format!("call-{round}"),
            },
        );
        add(
            &s,
            &mut r,
            ToolRecordKind::ToolFinished {
                result: result(round, ToolOutcome::Succeeded),
            },
        );
    }
    complete(&s, &mut r, 2);
    assert_eq!(r.snapshot.output, "round0round1answer");
    assert_eq!(r.snapshot.transcript.messages.len(), 6);
    assert_eq!(s.load_tool_run("one").unwrap().snapshot, r.snapshot);
    assert_eq!(s.load("one").unwrap_err(), RunError::UnsupportedVersion);
    let parent = crate::run_context::ParentRunRef {
        run_id: "one".into(),
        sequence: r.snapshot.sequence,
    };
    assert_eq!(
        s.tool_context_for(Some(&parent), 2, "next")
            .unwrap()
            .messages
            .len(),
        7
    );
    assert_eq!(
        s.continuation_context("one", "next").unwrap_err(),
        RunError::ContextUnsupported
    );
    assert_eq!(
        s.context_for(&parent, 2, "next").unwrap_err(),
        RunError::ContextUnsupported
    );
    drop(s);
    assert_eq!(
        crate::run_controller::RunController::open(&t.0).unwrap_err(),
        RunError::UnsupportedVersion
    );
    let s = RunStore::open(&t.0).unwrap();
    assert_eq!(s.load_tool_run("one").unwrap().snapshot, r.snapshot);
}
#[test]
fn tool_journal_invalid_transitions_leave_committed_state() {
    let t = Temp::new();
    let s = RunStore::open(&t.0).unwrap();
    let mut r = create(&s, "one", 1);
    pending(&s, &mut r, 0);
    resolve(&s, &mut r, PermissionDecision::Granted);
    let conflict = ToolRecordKind::PermissionResolved {
        receipt: PermissionReceipt {
            permission_id: "p-one-0".into(),
            decision: PermissionDecision::Denied,
            sequence: r.snapshot.sequence + 1,
        },
    };
    let before = r.snapshot.clone();
    assert!(s.append_tool_record(&mut r, conflict).is_err());
    assert_eq!(r.snapshot, before);
    add(
        &s,
        &mut r,
        ToolRecordKind::ToolStarted {
            call_id: "call-0".into(),
        },
    );
    for event in [
        ToolRecordKind::ToolStarted {
            call_id: "call-0".into(),
        },
        ToolRecordKind::ToolFinished {
            result: ToolResult {
                call_id: "wrong".into(),
                ..result(0, ToolOutcome::Succeeded)
            },
        },
        ToolRecordKind::Terminated {
            status: RunStatus::Completed,
            error_code: None,
            closed_call: None,
        },
    ] {
        assert!(s.append_tool_record(&mut r, event).is_err());
    }
    add(
        &s,
        &mut r,
        ToolRecordKind::ToolFinished {
            result: result(0, ToolOutcome::Succeeded),
        },
    );
    complete(&s, &mut r, 1);
    assert!(s
        .append_tool_record(
            &mut r,
            ToolRecordKind::TextDelta {
                round: 1,
                text: "late".into()
            }
        )
        .is_err());
}
#[test]
fn tool_journal_interrupted_closes_pending_granted_started() {
    for phase in 0..3 {
        let t = Temp::new();
        let s = RunStore::open(&t.0).unwrap();
        let mut r = create(&s, "one", 1);
        pending(&s, &mut r, 0);
        if phase > 0 {
            resolve(&s, &mut r, PermissionDecision::Granted);
        }
        if phase > 1 {
            add(
                &s,
                &mut r,
                ToolRecordKind::ToolStarted {
                    call_id: "call-0".into(),
                },
            );
        }
        add(
            &s,
            &mut r,
            ToolRecordKind::Terminated {
                status: RunStatus::Interrupted,
                error_code: Some("interrupted".into()),
                closed_call: Some(result(0, ToolOutcome::Interrupted)),
            },
        );
        assert!(r.snapshot.pending.is_none());
        assert_eq!(
            r.snapshot.transcript.messages.last(),
            Some(&TranscriptMessage::Tool {
                result: result(0, ToolOutcome::Interrupted)
            })
        );
        assert_eq!(s.load_tool_run("one").unwrap().snapshot, r.snapshot);
    }
}
#[test]
fn tool_journal_truncation_corruption_and_no_default_directory() {
    use std::io::Write;
    let t = Temp::new();
    let s = RunStore::open(&t.0).unwrap();
    assert!(!t.log("one").parent().unwrap().exists());
    let mut r = create(&s, "one", 1);
    add(&s, &mut r, ToolRecordKind::Started);
    fs::OpenOptions::new()
        .append(true)
        .open(t.log("one"))
        .unwrap()
        .write_all(b"{\"version\":")
        .unwrap();
    assert!(s.load_tool_run("one").unwrap().snapshot.recovery_required);
    fs::OpenOptions::new()
        .append(true)
        .open(t.log("one"))
        .unwrap()
        .write_all(b"1}\n")
        .unwrap();
    assert_eq!(s.load_tool_run("one").unwrap_err(), RunError::CorruptLog);
}
#[test]
fn tool_journal_strict_types_provider_defaults_and_limits() {
    use crate::run_provider::{OfflineFixture, RunProvider};
    use std::time::Duration;
    assert!(serde_json::from_str::<ToolArguments>(r#"{"path":"a","extra":1}"#).is_err());
    assert!(
        serde_json::from_str::<TranscriptMessage>(r#"{"kind":"user","text":"x","extra":1}"#)
            .is_err()
    );
    assert!(ToolRunOptions::new("rev".into(), Duration::ZERO, Duration::from_secs(1)).is_err());
    let p = OfflineFixture::new(OfflineScenario::Success);
    assert_eq!(
        p.execute_tool_round(
            &ToolContext { messages: vec![] },
            &[],
            &std::sync::atomic::AtomicBool::new(false),
            Duration::from_secs(1),
            &mut |_| Ok(())
        )
        .unwrap_err(),
        RunError::ContextUnsupported
    );
    assert!(ToolContext {
        messages: vec![TranscriptMessage::User {
            text: "x".repeat(513 * 1024)
        }]
    }
    .validate()
    .is_err());
}
#[test]
fn tool_journal_denial_has_result_without_execution() {
    let t = Temp::new();
    let s = RunStore::open(&t.0).unwrap();
    let mut r = create(&s, "one", 1);
    pending(&s, &mut r, 0);
    resolve(&s, &mut r, PermissionDecision::Denied);
    assert!(s
        .append_tool_record(
            &mut r,
            ToolRecordKind::ToolStarted {
                call_id: "call-0".into()
            }
        )
        .is_err());
    add(
        &s,
        &mut r,
        ToolRecordKind::ToolFinished {
            result: result(0, ToolOutcome::Denied),
        },
    );
    complete(&s, &mut r, 1);
}
#[test]
fn tool_journal_cross_version_parent_and_global_preflight() {
    use crate::run_context::ParentRunRef;
    let t = Temp::new();
    let s = RunStore::open(&t.0).unwrap();
    let mut legacy = s
        .create("legacy", "old".into(), OfflineScenario::Success)
        .unwrap();
    for k in [RunRecordKind::Started, RunRecordKind::Completed] {
        s.append(&mut legacy, k, None, None).unwrap();
    }
    let parent = ParentRunRef {
        run_id: "legacy".into(),
        sequence: legacy.snapshot.sequence,
    };
    let mut header = ToolRunHeader {
        storage_version: 3,
        policy_version: 1,
        run_id: "child".into(),
        input: "new".into(),
        created_order: 2,
        parent: Some(parent.clone()),
        workspace_revision: "rev".into(),
    };
    let mut child = s.create_tool_run(header.clone()).unwrap();
    add(&s, &mut child, ToolRecordKind::Started);
    complete(&s, &mut child, 0);
    let parent_child = ParentRunRef {
        run_id: "child".into(),
        sequence: child.snapshot.sequence,
    };
    let c = s.tool_context_for(Some(&parent_child), 3, "third").unwrap();
    assert_eq!(c.messages.len(), 5);
    assert_eq!(
        s.tool_context_for(Some(&parent_child), 2, "third")
            .unwrap_err(),
        RunError::CorruptLog
    );
    let wrong = ParentRunRef {
        sequence: 999,
        ..parent_child
    };
    assert_eq!(
        s.tool_context_for(Some(&wrong), 3, "third").unwrap_err(),
        RunError::CorruptLog
    );
    header.run_id = "grandchild".into();
    header.created_order = 3;
    header.parent = Some(ParentRunRef {
        run_id: "child".into(),
        sequence: child.snapshot.sequence,
    });
    s.create_tool_run(header).unwrap();
    let mut duplicate = child.header.clone();
    duplicate.run_id = "legacy".into();
    fs::write(
        t.log("legacy"),
        format!("{}\n", serde_json::to_string(&duplicate).unwrap()),
    )
    .unwrap();
    assert_eq!(s.ids().unwrap_err(), RunError::CorruptLog);
}
#[test]
fn tool_journal_nullable_fields_are_required() {
    for value in [
        serde_json::json!({"kind":"assistant","round":0,"text":"x"}),
        serde_json::json!({"kind":"assistant","round":0,"text":"x","call":null,"extra":1}),
    ] {
        assert!(serde_json::from_value::<TranscriptMessage>(value).is_err());
    }
    assert!(serde_json::from_value::<ToolRecordKind>(
        serde_json::json!({"kind":"roundFinished","round":0})
    )
    .is_err());
    assert!(serde_json::from_value::<ToolRecordKind>(
        serde_json::json!({"kind":"terminated","status":"failed"})
    )
    .is_err());
}
#[test]
fn tool_journal_encoded_result_budget_and_reserved_terminal_slots() {
    let t = Temp::new();
    let s = RunStore::open(&t.0).unwrap();
    let mut r = create(&s, "one", 1);
    pending(&s, &mut r, 0);
    resolve(&s, &mut r, PermissionDecision::Granted);
    add(
        &s,
        &mut r,
        ToolRecordKind::ToolStarted {
            call_id: "call-0".into(),
        },
    );
    let mut too_large = result(0, ToolOutcome::Succeeded);
    too_large.content = "\u{0001}".repeat(4096);
    assert_eq!(
        s.append_tool_record(&mut r, ToolRecordKind::ToolFinished { result: too_large }),
        Err(RunError::RunLimitExceeded)
    );
    let mut escaped = result(0, ToolOutcome::Succeeded);
    escaped.content = "\u{0001}".repeat(2500);
    let before = r.snapshot.clone();
    let before_bytes = fs::read(t.log("one")).unwrap();
    assert_eq!(
        s.append_tool_record(&mut r, ToolRecordKind::ToolFinished { result: escaped }),
        Err(RunError::ToolLimit)
    );
    assert_eq!(r.snapshot, before);
    assert_eq!(fs::read(t.log("one")).unwrap(), before_bytes);
    let bounded = result_at_encoded_limit(result(0, ToolOutcome::Succeeded), "\u{0001}");
    add(&s, &mut r, ToolRecordKind::ToolFinished { result: bounded });
    add(
        &s,
        &mut r,
        ToolRecordKind::Terminated {
            status: RunStatus::Failed,
            error_code: Some("toolLimit".into()),
            closed_call: None,
        },
    );
}
#[test]
fn tool_journal_sync_failure_retains_committed_snapshot() {
    let t = Temp::new();
    let s = RunStore::open(&t.0).unwrap();
    let mut r = create(&s, "one", 1);
    let before = r.snapshot.clone();
    s.fail_tool_sync.store(true, Ordering::Relaxed);
    assert_eq!(
        s.append_tool_record(&mut r, ToolRecordKind::Started),
        Err(RunError::StoreIo)
    );
    assert_eq!(r.snapshot.sequence, before.sequence);
    assert_eq!(r.snapshot.status, before.status);
    assert!(r.snapshot.recovery_required);
    assert_eq!(
        s.append_tool_record(&mut r, ToolRecordKind::Started),
        Err(RunError::RecoveryRequired)
    );
}
#[test]
fn tool_journal_full_preflight_precedes_legacy_recovery() {
    let t = Temp::new();
    let s = RunStore::open(&t.0).unwrap();
    let mut text = s
        .create("legacy", "old".into(), OfflineScenario::Success)
        .unwrap();
    s.append(&mut text, RunRecordKind::Started, None, None)
        .unwrap();
    let _r = create(&s, "tool", 2);
    fs::OpenOptions::new()
        .append(true)
        .open(t.log("tool"))
        .unwrap();
    use std::io::Write;
    fs::OpenOptions::new()
        .append(true)
        .open(t.log("tool"))
        .unwrap()
        .write_all(b"{}\n")
        .unwrap();
    let path = t.0.join("runs-v1/legacy.jsonl");
    let bytes = fs::read(&path).unwrap();
    drop(s);
    assert_eq!(
        crate::run_controller::RunController::open(&t.0).unwrap_err(),
        RunError::CorruptLog
    );
    assert_eq!(fs::read(path).unwrap(), bytes);
}
#[test]
fn tool_journal_tool_started_guarantees_result_and_terminal_at_event_boundary() {
    let t = Temp::new();
    let s = RunStore::open(&t.0).unwrap();
    let mut r = create(&s, "one", 1);
    pending(&s, &mut r, 0);
    resolve(&s, &mut r, PermissionDecision::Granted);
    let mut events = r.events.clone();
    let filler = ToolRecord {
        version: 1,
        run_id: "one".into(),
        sequence: 0,
        event: ToolRecordKind::TextDelta {
            round: 0,
            text: String::new(),
        },
    };
    events.splice(
        3..3,
        std::iter::repeat_n(filler, MAX_EVENTS - 3 - events.len()),
    );
    let mut bytes = serde_json::to_vec(&r.header).unwrap();
    bytes.push(b'\n');
    for (i, mut e) in events.into_iter().enumerate() {
        e.sequence = i as u64 + 1;
        if let ToolRecordKind::PermissionResolved { receipt } = &mut e.event {
            receipt.sequence = e.sequence;
        }
        bytes.extend(serde_json::to_vec(&e).unwrap());
        bytes.push(b'\n');
    }
    fs::write(t.log("one"), bytes).unwrap();
    let mut r = s.load_tool_run("one").unwrap();
    assert_eq!(r.events.len(), MAX_EVENTS - 3);
    add(
        &s,
        &mut r,
        ToolRecordKind::ToolStarted {
            call_id: "call-0".into(),
        },
    );
    add(
        &s,
        &mut r,
        ToolRecordKind::ToolFinished {
            result: result(0, ToolOutcome::Succeeded),
        },
    );
    add(
        &s,
        &mut r,
        ToolRecordKind::Terminated {
            status: RunStatus::Failed,
            error_code: Some("toolLimit".into()),
            closed_call: None,
        },
    );
    assert_eq!(r.events.len(), MAX_EVENTS);
    assert_eq!(s.load_tool_run("one").unwrap().snapshot, r.snapshot);
}
#[test]
fn tool_journal_future_versions_and_unknown_fields_fail_closed() {
    let t = Temp::new();
    let s = RunStore::open(&t.0).unwrap();
    let _r = create(&s, "one", 1);
    let original = fs::read(t.log("one")).unwrap();
    let mut header: serde_json::Value = serde_json::from_slice(&original).unwrap();
    header["storageVersion"] = serde_json::json!(99);
    header["futureField"] = serde_json::json!(true);
    fs::write(t.log("one"), format!("{}\n", header)).unwrap();
    assert_eq!(
        s.load_tool_run("one").unwrap_err(),
        RunError::UnsupportedVersion
    );
    fs::write(t.log("one"), &original).unwrap();
    use std::io::Write;
    fs::OpenOptions::new()
        .append(true)
        .open(t.log("one"))
        .unwrap()
        .write_all(b"{\"version\":99,\"future\":true}\n")
        .unwrap();
    assert_eq!(
        s.load_tool_run("one").unwrap_err(),
        RunError::UnsupportedVersion
    );
}
#[test]
fn tool_journal_provider_arguments_reject_untrusted_candidates() {
    for raw in [
        ProviderToolCall {
            id: "bad id".into(),
            name: "workspace_list".into(),
            arguments: r#"{"path":"a"}"#.into(),
        },
        ProviderToolCall {
            id: "id".into(),
            name: "shell".into(),
            arguments: r#"{"path":"a"}"#.into(),
        },
        ProviderToolCall {
            id: "id".into(),
            name: "workspace_read".into(),
            arguments: r#"{"path":"a","unknown":1}"#.into(),
        },
        ProviderToolCall {
            id: "id".into(),
            name: "workspace_read".into(),
            arguments: serde_json::json!({"path":"x".repeat(129)}).to_string(),
        },
    ] {
        assert!(ToolCall::from_provider(0, raw).is_err());
    }
}
#[test]
fn tool_journal_unit_events_reject_extra_fields() {
    assert!(serde_json::from_value::<ToolRecordKind>(
        serde_json::json!({"kind":"started","extra":true})
    )
    .is_err());
    assert!(serde_json::from_value::<ToolRoundOutput>(
        serde_json::json!({"kind":"stop","extra":true})
    )
    .is_err());
}
#[test]
fn tool_journal_four_calls_then_fifth_round_must_stop() {
    let t = Temp::new();
    let s = RunStore::open(&t.0).unwrap();
    let mut r = create(&s, "one", 1);
    for round in 0..4 {
        pending(&s, &mut r, round);
        resolve(&s, &mut r, PermissionDecision::Expired);
        add(
            &s,
            &mut r,
            ToolRecordKind::ToolFinished {
                result: result(round, ToolOutcome::Expired),
            },
        );
    }
    add(&s, &mut r, ToolRecordKind::RoundStarted { round: 4 });
    assert!(s
        .append_tool_record(
            &mut r,
            ToolRecordKind::RoundFinished {
                round: 4,
                call: Some(call(4))
            }
        )
        .is_err());
    add(
        &s,
        &mut r,
        ToolRecordKind::RoundFinished {
            round: 4,
            call: None,
        },
    );
    add(
        &s,
        &mut r,
        ToolRecordKind::Terminated {
            status: RunStatus::Completed,
            error_code: None,
            closed_call: None,
        },
    );
}
#[path = "tool_journal_context_tests.rs"]
mod context_tests;

#[test]
fn encoded_delta_and_context_rejection_preserves_log_and_readable_terminal() {
    for large_input in [false, true] {
        let temp = Temp::new();
        let store = RunStore::open(&temp.0).unwrap();
        let mut run = store
            .create_tool_run(ToolRunHeader {
                storage_version: 3,
                policy_version: 1,
                run_id: "encoded".into(),
                input: if large_input {
                    "\u{1}".repeat(10000)
                } else {
                    "question".into()
                },
                created_order: 1,
                parent: None,
                workspace_revision: "synthetic-v1".into(),
            })
            .unwrap();
        add(&store, &mut run, ToolRecordKind::Started);
        add(&store, &mut run, ToolRecordKind::RoundStarted { round: 0 });
        let mut rejected = false;
        for _ in 0..130 {
            let before = fs::read(temp.log("encoded")).unwrap();
            let snapshot = run.snapshot.clone();
            match store.append_tool_record(
                &mut run,
                ToolRecordKind::TextDelta {
                    round: 0,
                    text: "\u{1}".repeat(2000),
                },
            ) {
                Ok(()) => {}
                Err(error) => {
                    assert!(matches!(
                        error,
                        RunError::RunLimitExceeded | RunError::ContextLimitExceeded
                    ));
                    assert_eq!(fs::read(temp.log("encoded")).unwrap(), before);
                    assert_eq!(run.snapshot, snapshot);
                    rejected = true;
                    break;
                }
            }
        }
        assert!(rejected);
        assert!(!run.snapshot.output.is_empty());
        assert!(serde_json::to_vec(&run.snapshot.output).unwrap().len() <= MAX_OUTPUT_BYTES);
        assert!(serde_json::to_vec(&run.snapshot).unwrap().len() <= MAX_TOOL_SNAPSHOT_BYTES);
        add(
            &store,
            &mut run,
            ToolRecordKind::Terminated {
                status: RunStatus::Failed,
                error_code: Some("runLimitExceeded".into()),
                closed_call: None,
            },
        );
        let reopened = store.load_tool_run("encoded").unwrap();
        assert_eq!(reopened.snapshot, run.snapshot);
        assert_eq!(reopened.snapshot.status, RunStatus::Failed);
    }
}

#[test]
fn tools_header_rejects_raw_small_but_encoded_oversized_input_without_creating_files() {
    let temp = Temp::new();
    let store = RunStore::open(&temp.0).unwrap();
    assert!(store
        .create_tool_run(ToolRunHeader {
            storage_version: 3,
            policy_version: 1,
            run_id: "bad-input".into(),
            input: "\u{1}".repeat(60000),
            created_order: 1,
            parent: None,
            workspace_revision: "synthetic-v1".into()
        })
        .is_err());
    assert!(!temp.log("bad-input").exists());
    assert!(!temp.0.join("runs-v1/tools-v3").exists());
}
