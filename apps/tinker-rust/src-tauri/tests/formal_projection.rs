//! 共享夹具由原TS projectHistory生成，并由该实现自己的测试再次验证。
use serde_json::Value;
use tinker_rust_foundation::formal_agent::projection::history;
#[test]
fn same_synthetic_turn_contract_matches_existing_typescript_history_projection() {
    let cases: Value = serde_json::from_str(include_str!(
        "../../../../packages/shared/src/fixtures/desktop-turn-projection.json"
    ))
    .unwrap();
    for case in cases.as_array().unwrap() {
        assert_eq!(
            history(case["turns"].as_array().unwrap()),
            case["expected"],
            "{}",
            case["name"]
        );
    }
}

#[test]
fn tool_restore_history_and_active_snapshot_match_shared_renderer_contract() {
    let case: Value = serde_json::from_str(include_str!(
        "../../../../packages/shared/src/fixtures/tool-restore-projection.json"
    ))
    .unwrap();
    assert_eq!(history(&[case["turn"].clone()]), case["history"]);
    assert_eq!(
        tinker_rust_foundation::formal_agent::projection::active_run(&case["turn"])
            ["currentSnapshot"]["payload"]["event"],
        case["snapshot"]
    );
}

#[test]
fn every_tool_snapshot_message_has_explicit_identity_including_terminal_variants() {
    let case: Value = serde_json::from_str(include_str!(
        "../../../../packages/shared/src/fixtures/tool-restore-projection.json"
    ))
    .unwrap();
    for status in [
        "waitingInput",
        "completed",
        "cancelled",
        "failed",
        "interrupted",
    ] {
        let mut turn = case["turn"].clone();
        turn["status"] = serde_json::json!(status);
        turn["toolState"]["partialText"] = serde_json::json!("partial");
        turn["toolState"]["transcript"]["messages"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::json!({"kind":"tool","result":{"callId":"list_1","outcome":"denied","content":"Permission denied."}}));
        let snapshot = tinker_rust_foundation::formal_agent::projection::snapshot(&turn);
        let sdk = &snapshot["payload"]["event"]["sdkMessages"];
        assert_eq!(*sdk, history(&[turn.clone()])["sdkMessages"]);
        for message in sdk.as_array().unwrap() {
            assert_eq!(message["_desktopRunId"], turn["runId"]);
            assert!(!message["uuid"].as_str().unwrap().is_empty());
        }
    }
}
