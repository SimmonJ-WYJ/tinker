//! 离线执行闭环的行为回归，全部使用合成临时数据。
use crate::{
    run_controller::RunController, run_types::OfflineScenario, session_lifecycle::RunStatus,
};
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
    thread,
    time::{Duration, Instant},
};
static NEXT: AtomicU64 = AtomicU64::new(0);
struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "tinker-run-core-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn terminal(controller: &RunController, id: &str) -> crate::run_types::RunSnapshot {
    let deadline = Instant::now() + Duration::from_secs(3);
    loop {
        let snapshot = controller.read(Some(id), 0, 64).unwrap().snapshot;
        if matches!(
            snapshot.status,
            RunStatus::Completed
                | RunStatus::Failed
                | RunStatus::Cancelled
                | RunStatus::Interrupted
        ) {
            return snapshot;
        }
        assert!(Instant::now() < deadline);
        thread::sleep(Duration::from_millis(5));
    }
}
#[test]
fn run_success_is_durable_and_deduplicated_after_reopen() {
    let temp = Temp::new();
    let controller = RunController::open(&temp.0).unwrap();
    let first = controller
        .start_fixture(
            "request-1".into(),
            "合成输入".into(),
            OfflineScenario::Success,
        )
        .unwrap();
    let done = terminal(&controller, &first.run_id);
    assert_eq!(done.status, RunStatus::Completed);
    assert!(!done.output.is_empty());
    assert_eq!(
        controller
            .start_fixture(
                "request-1".into(),
                "不同输入".into(),
                OfflineScenario::Success
            )
            .unwrap_err()
            .code(),
        "requestConflict"
    );
    assert_eq!(
        controller
            .start_fixture(
                "request-1".into(),
                "合成输入".into(),
                OfflineScenario::Success
            )
            .unwrap(),
        done
    );
    let first_page = controller.read(None, 0, 1).unwrap();
    assert_eq!(first_page.events.len(), 1);
    assert!(first_page.has_more);
    drop(controller);
    let reopened = RunController::open(&temp.0).unwrap();
    assert_eq!(
        reopened
            .start_fixture(
                "request-1".into(),
                "合成输入".into(),
                OfflineScenario::Success
            )
            .unwrap(),
        done
    );
}
#[test]
fn run_cancel_is_idempotent_and_rejects_late_deltas() {
    let temp = Temp::new();
    let controller = RunController::open(&temp.0).unwrap();
    controller
        .start_fixture("slow".into(), "输入".into(), OfflineScenario::Slow)
        .unwrap();
    assert_eq!(
        controller
            .start_fixture("other".into(), "输入".into(), OfflineScenario::Success)
            .unwrap_err()
            .code(),
        "runBusy"
    );
    let cancelled = controller.cancel("slow").unwrap();
    assert_eq!(cancelled.status, RunStatus::Cancelled);
    thread::sleep(Duration::from_millis(120));
    assert_eq!(controller.cancel("slow").unwrap(), cancelled);
    assert_eq!(
        controller.read(Some("slow"), 0, 256).unwrap().snapshot,
        cancelled
    );
}
#[test]
fn run_failure_retains_input_and_partial_output() {
    let temp = Temp::new();
    let controller = RunController::open(&temp.0).unwrap();
    controller
        .start_fixture("fail".into(), "保留输入".into(), OfflineScenario::Failure)
        .unwrap();
    let failed = terminal(&controller, "fail");
    assert_eq!(failed.status, RunStatus::Failed);
    assert_eq!(failed.input, "保留输入");
    assert!(!failed.output.is_empty());
    assert_eq!(failed.error_code.as_deref(), Some("offlineFixtureFailed"));
}
#[test]
fn run_reopen_interrupts_without_restarting_provider() {
    let temp = Temp::new();
    let controller = RunController::open(&temp.0).unwrap();
    controller
        .start_fixture("inflight".into(), "输入".into(), OfflineScenario::Slow)
        .unwrap();
    drop(controller);
    let reopened = RunController::open(&temp.0).unwrap();
    let interrupted = reopened.read(None, 0, 256).unwrap().snapshot;
    assert_eq!(interrupted.status, RunStatus::Interrupted);
    assert_eq!(
        reopened
            .start_fixture("inflight".into(), "输入".into(), OfflineScenario::Slow)
            .unwrap(),
        interrupted
    );
}
#[test]
fn run_storage_lock_and_validation_are_explicit() {
    let temp = Temp::new();
    let controller = RunController::open(&temp.0).unwrap();
    assert_eq!(
        RunController::open(&temp.0).unwrap_err().code(),
        "storeLocked"
    );
    assert_eq!(
        controller
            .start_fixture("../bad".into(), "x".into(), OfflineScenario::Success)
            .unwrap_err()
            .code(),
        "invalidRunId"
    );
    assert_eq!(
        controller
            .start_fixture("large".into(), "x".repeat(65_537), OfflineScenario::Success)
            .unwrap_err()
            .code(),
        "inputTooLarge"
    );
    assert_eq!(
        controller.read(None, 0, 1).unwrap_err().code(),
        "runNotFound"
    );
}
#[test]
fn run_truncated_tail_is_readable_but_never_replayed() {
    use std::io::Write;
    let temp = Temp::new();
    let controller = RunController::open(&temp.0).unwrap();
    controller
        .start_fixture("truncated".into(), "输入".into(), OfflineScenario::Slow)
        .unwrap();
    drop(controller);
    std::fs::OpenOptions::new()
        .append(true)
        .open(temp.0.join("runs-v1/truncated.jsonl"))
        .unwrap()
        .write_all(b"{\"protocolVersion\":1,")
        .unwrap();
    let reopened = RunController::open(&temp.0).unwrap();
    let snapshot = reopened.read(None, 0, 64).unwrap().snapshot;
    assert_eq!(snapshot.status, RunStatus::Interrupted);
    assert!(snapshot.recovery_required);
    assert_eq!(
        reopened
            .start_fixture("truncated".into(), "输入".into(), OfflineScenario::Slow)
            .unwrap(),
        snapshot
    );
}
#[test]
fn run_corrupt_middle_and_future_version_are_rejected() {
    for (replacement, expected) in [
        ("{garbage}\n", "corruptLog"),
        ("{\"protocolVersion\":99}\n", "unsupportedVersion"),
    ] {
        let temp = Temp::new();
        let controller = RunController::open(&temp.0).unwrap();
        controller
            .start_fixture("corrupt".into(), "输入".into(), OfflineScenario::Slow)
            .unwrap();
        drop(controller);
        let path = temp.0.join("runs-v1/corrupt.jsonl");
        let original = fs::read_to_string(&path).unwrap();
        let header = original.lines().next().unwrap();
        fs::write(&path, format!("{header}\n{replacement}")).unwrap();
        assert_eq!(RunController::open(&temp.0).unwrap_err().code(), expected);
    }
}
#[test]
fn run_storage_failure_stops_provider_and_reports_uncertain_durability() {
    let temp = Temp::new();
    let controller = RunController::open(&temp.0).unwrap();
    controller
        .start_fixture("storage".into(), "保留".into(), OfflineScenario::Slow)
        .unwrap();
    let path = temp.0.join("runs-v1/storage.jsonl");
    fs::remove_file(&path).unwrap();
    fs::create_dir(&path).unwrap();
    let failed = terminal(&controller, "storage");
    assert_eq!(failed.status, RunStatus::Failed);
    assert!(failed.recovery_required);
    assert_eq!(failed.input, "保留");
    assert_eq!(
        controller
            .start_fixture("new".into(), "输入".into(), OfflineScenario::Success)
            .unwrap_err()
            .code(),
        "recoveryRequired"
    );
}
#[test]
fn run_full_input_bound_does_not_expand_public_event_payloads() {
    let temp = Temp::new();
    let controller = RunController::open(&temp.0).unwrap();
    let input = "\u{0001}".repeat(65_536);
    controller
        .start_fixture("full".into(), input.clone(), OfflineScenario::Success)
        .unwrap();
    terminal(&controller, "full");
    let page = controller.read(None, 0, 256).unwrap();
    assert_eq!(page.snapshot.input, input);
    for record in page.events {
        assert!(serde_json::to_vec(&record).unwrap().len() <= 16 * 1024);
    }
    drop(controller);
    assert_eq!(
        RunController::open(&temp.0)
            .unwrap()
            .read(None, 0, 64)
            .unwrap()
            .snapshot
            .input
            .len(),
        65_536
    );
}
#[test]
fn run_empty_input_and_cursor_bounds_do_not_mutate_the_run() {
    let temp = Temp::new();
    let controller = RunController::open(&temp.0).unwrap();
    assert_eq!(
        controller
            .start_fixture("empty".into(), " \n\t".into(), OfflineScenario::Success)
            .unwrap_err()
            .code(),
        "emptyInput"
    );
    controller
        .start_fixture("valid".into(), "输入".into(), OfflineScenario::Success)
        .unwrap();
    let done = terminal(&controller, "valid");
    assert_eq!(
        controller
            .read(None, done.sequence + 1, 1)
            .unwrap_err()
            .code(),
        "invalidCursor"
    );
    for limit in [0, 257] {
        assert_eq!(
            controller.read(None, 0, limit).unwrap_err().code(),
            "invalidLimit"
        );
    }
    let empty = controller.read(None, done.sequence, 256).unwrap();
    assert!(empty.events.is_empty());
    assert_eq!(empty.next_after_sequence, done.sequence);
    assert!(!empty.has_more);
    assert_eq!(
        controller
            .start_fixture("valid".into(), "输入".into(), OfflineScenario::Failure)
            .unwrap_err()
            .code(),
        "requestConflict"
    );
}
#[test]
fn run_header_only_crash_recovers_as_interrupted() {
    let temp = Temp::new();
    let store = crate::run_store::RunStore::open(&temp.0).unwrap();
    store
        .create("header-only", "输入".into(), OfflineScenario::Success)
        .unwrap();
    drop(store);
    let controller = RunController::open(&temp.0).unwrap();
    let interrupted = controller.read(None, 0, 64).unwrap();
    assert_eq!(interrupted.snapshot.status, RunStatus::Interrupted);
    assert_eq!(interrupted.snapshot.sequence, 1);
    assert_eq!(
        interrupted.events[0].kind,
        crate::run_types::RunRecordKind::Interrupted
    );
}
#[test]
fn run_empty_middle_line_is_corrupt_not_silently_skipped() {
    let temp = Temp::new();
    let controller = RunController::open(&temp.0).unwrap();
    controller
        .start_fixture("blank".into(), "输入".into(), OfflineScenario::Slow)
        .unwrap();
    drop(controller);
    let path = temp.0.join("runs-v1/blank.jsonl");
    let original = fs::read_to_string(&path).unwrap();
    fs::write(&path, original.replacen('\n', "\n\n", 1)).unwrap();
    assert_eq!(
        RunController::open(&temp.0).unwrap_err().code(),
        "corruptLog"
    );
}
#[cfg(unix)]
#[test]
fn run_rejects_symlink_and_hardlink_store_targets() {
    use std::os::unix::fs::symlink;
    let temp = Temp::new();
    let external = Temp::new();
    symlink(&external.0, temp.0.join("runs-v1")).unwrap();
    assert_eq!(
        RunController::open(&temp.0).unwrap_err().code(),
        "unsafePath"
    );
    fs::remove_file(temp.0.join("runs-v1")).unwrap();
    let store = crate::run_store::RunStore::open(&temp.0).unwrap();
    drop(store);
    let outside = external.0.join("outside");
    fs::write(&outside, "preserved").unwrap();
    symlink(&outside, temp.0.join("runs-v1/link.jsonl")).unwrap();
    assert_eq!(
        RunController::open(&temp.0).unwrap_err().code(),
        "unsafePath"
    );
    assert_eq!(fs::read_to_string(&outside).unwrap(), "preserved");
    fs::remove_file(temp.0.join("runs-v1/link.jsonl")).unwrap();
    fs::hard_link(&outside, temp.0.join("runs-v1/hard.jsonl")).unwrap();
    assert_eq!(
        RunController::open(&temp.0).unwrap_err().code(),
        "unsafePath"
    );
}
#[test]
fn run_latest_start_order_survives_equal_file_timestamps() {
    let temp = Temp::new();
    let controller = RunController::open(&temp.0).unwrap();
    controller
        .start_fixture("z-first".into(), "first".into(), OfflineScenario::Success)
        .unwrap();
    terminal(&controller, "z-first");
    controller
        .start_fixture("a-second".into(), "second".into(), OfflineScenario::Success)
        .unwrap();
    terminal(&controller, "a-second");
    drop(controller);
    for id in ["z-first", "a-second"] {
        let file = fs::File::options()
            .write(true)
            .open(temp.0.join(format!("runs-v1/{id}.jsonl")))
            .unwrap();
        file.set_times(fs::FileTimes::new().set_modified(std::time::UNIX_EPOCH))
            .unwrap();
    }
    let reopened = RunController::open(&temp.0).unwrap();
    assert_eq!(
        reopened.read(None, 0, 64).unwrap().snapshot.run_id,
        "a-second"
    );
}
#[test]
fn run_unacknowledged_header_never_deduplicates_as_a_live_run() {
    let temp = Temp::new();
    let controller = RunController::open(&temp.0).unwrap();
    // 模拟启动元数据写入后 fsync 报错：磁盘留有头记录，控制器没有已确认活动run。
    let header = serde_json::json!({"protocolVersion":1,"runId":"uncertain","requestId":"uncertain","providerKind":"offlineFixture","scenario":"success","input":"输入","createdOrder":1});
    fs::write(
        temp.0.join("runs-v1/uncertain.jsonl"),
        format!("{header}\n"),
    )
    .unwrap();
    assert_eq!(
        controller
            .start_fixture("uncertain".into(), "输入".into(), OfflineScenario::Success)
            .unwrap_err()
            .code(),
        "recoveryRequired"
    );
    assert_eq!(
        controller
            .start_fixture("other".into(), "输入".into(), OfflineScenario::Success)
            .unwrap_err()
            .code(),
        "recoveryRequired"
    );
    drop(controller);
    let reopened = RunController::open(&temp.0).unwrap();
    assert_eq!(
        reopened.read(None, 0, 64).unwrap().snapshot.status,
        RunStatus::Interrupted
    );
}

// 旧离线回归仅在测试宿主中选择fixture，控制器不识别执行场景。
trait FixtureStart {
    fn start_fixture(
        &self,
        id: String,
        input: String,
        scenario: OfflineScenario,
    ) -> Result<crate::run_types::RunSnapshot, crate::run_types::RunError>;
}
impl FixtureStart for RunController {
    fn start_fixture(
        &self,
        id: String,
        input: String,
        scenario: OfflineScenario,
    ) -> Result<crate::run_types::RunSnapshot, crate::run_types::RunError> {
        self.start_with_provider(
            id,
            input,
            scenario,
            std::sync::Arc::new(crate::run_provider::OfflineFixture::new(scenario)),
        )
    }
}

#[path = "run_provider_tests.rs"]
mod provider_tests;
