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
