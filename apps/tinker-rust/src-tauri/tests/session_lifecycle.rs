use tinker_rust_foundation::session_lifecycle::{LifecycleError, RunEvent, RunState, RunStatus};
fn state(status: &str) -> RunState {
    serde_json::from_value(serde_json::json!({"schemaVersion":1,"runId":"run-1","status":status}))
        .unwrap()
}
#[test]
fn queued_running_waiting_and_completion_form_an_explicit_lifecycle() {
    let mut run = RunState::queued("run-1").unwrap();
    assert_eq!(run.status(), RunStatus::Queued);
    for (event, status) in [
        (RunEvent::Start, RunStatus::Running),
        (RunEvent::WaitForInput, RunStatus::WaitingInput),
        (RunEvent::Continue, RunStatus::Running),
        (RunEvent::Complete, RunStatus::Completed),
    ] {
        run.apply("run-1", event).unwrap();
        assert_eq!(run.status(), status);
    }
}
#[test]
fn stale_run_and_terminal_events_never_modify_state() {
    let mut run = state("running");
    let before = run.clone();
    assert_eq!(
        run.apply("another", RunEvent::Complete),
        Err(LifecycleError::RunMismatch)
    );
    assert_eq!(run, before);
    run.apply("run-1", RunEvent::Cancel).unwrap();
    let cancelled = run.clone();
    assert_eq!(
        run.apply("run-1", RunEvent::Start),
        Err(LifecycleError::InvalidTransition)
    );
    assert_eq!(run, cancelled);
}
#[test]
fn recovery_marks_only_inflight_states_interrupted_and_never_restarts_work() {
    for status in [
        "queued",
        "running",
        "waitingInput",
        "completed",
        "failed",
        "cancelled",
        "interrupted",
    ] {
        let mut run = state(status);
        run.restore();
        let expected = if ["running", "waitingInput"].contains(&status) {
            RunStatus::Interrupted
        } else {
            state(status).status()
        };
        assert_eq!(run.status(), expected);
        let restored = run.clone();
        run.restore();
        assert_eq!(run, restored);
    }
}
#[test]
fn snapshot_roundtrips_version_and_rejects_unsupported_or_unsafe_values() {
    let run = RunState::queued("run-1").unwrap();
    let json = serde_json::to_value(&run).unwrap();
    assert_eq!(
        json,
        serde_json::json!({"schemaVersion":1,"runId":"run-1","status":"queued"})
    );
    assert_eq!(serde_json::from_value::<RunState>(json).unwrap(), run);
    for bad in [
        serde_json::json!({"schemaVersion":2,"runId":"run-1","status":"running"}),
        serde_json::json!({"schemaVersion":1,"runId":"../escape","status":"queued"}),
        serde_json::json!({"schemaVersion":1,"runId":"run-1","status":"unknown"}),
        serde_json::json!({"schemaVersion":1,"runId":"run-1","status":"running","future":true}),
    ] {
        assert!(serde_json::from_value::<RunState>(bad).is_err());
    }
    for id in ["", "..", "../escape", "run with space"] {
        assert_eq!(RunState::queued(id), Err(LifecycleError::InvalidRunId));
    }
    assert_eq!(
        RunState::queued(&"r".repeat(129)),
        Err(LifecycleError::InvalidRunId)
    );
}
#[test]
fn every_state_event_pair_obeys_the_transition_table_and_errors_preserve_state() {
    let statuses = [
        "queued",
        "running",
        "waitingInput",
        "completed",
        "failed",
        "cancelled",
        "interrupted",
    ];
    let events = [
        RunEvent::Start,
        RunEvent::WaitForInput,
        RunEvent::Continue,
        RunEvent::Complete,
        RunEvent::Fail,
        RunEvent::Cancel,
        RunEvent::Interrupt,
    ];
    for status in statuses {
        for event in events {
            let mut run = state(status);
            let before = run.clone();
            let expected = match (status, event) {
                ("queued", RunEvent::Start) => Some(RunStatus::Running),
                ("queued", RunEvent::Cancel) => Some(RunStatus::Cancelled),
                ("queued", RunEvent::Interrupt) => Some(RunStatus::Interrupted),
                ("running", RunEvent::WaitForInput) => Some(RunStatus::WaitingInput),
                ("waitingInput", RunEvent::Continue) => Some(RunStatus::Running),
                ("running", RunEvent::Complete) => Some(RunStatus::Completed),
                ("running" | "waitingInput", RunEvent::Fail) => Some(RunStatus::Failed),
                ("running" | "waitingInput", RunEvent::Cancel) => Some(RunStatus::Cancelled),
                ("running" | "waitingInput", RunEvent::Interrupt) => Some(RunStatus::Interrupted),
                _ => None,
            };
            let result = run.apply("run-1", event);
            if let Some(expected) = expected {
                assert_eq!(result, Ok(()));
                assert_eq!(run.status(), expected);
            } else {
                assert_eq!(result, Err(LifecycleError::InvalidTransition));
                assert_eq!(run, before);
            }
        }
    }
}
