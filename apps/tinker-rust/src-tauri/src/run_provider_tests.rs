//! 通用provider通过真实控制器的注入与故障边界。
use super::*;

struct EchoProvider;
impl crate::run_provider::RunProvider for EchoProvider {
    fn execute(
        &self,
        input: &str,
        _: &std::sync::atomic::AtomicBool,
        emit: &mut dyn FnMut(&str) -> Result<(), crate::run_types::RunError>,
    ) -> Result<(), crate::run_types::RunError> {
        emit(input)?;
        emit("/second")
    }
}
struct PanicProvider;
impl crate::run_provider::RunProvider for PanicProvider {
    fn execute(
        &self,
        _: &str,
        _: &std::sync::atomic::AtomicBool,
        emit: &mut dyn FnMut(&str) -> Result<(), crate::run_types::RunError>,
    ) -> Result<(), crate::run_types::RunError> {
        emit("partial")?;
        panic!("synthetic provider panic");
    }
}
#[test]
fn injected_providers_stream_and_panic_keeps_partial_in_terminal_state() {
    let temp = Temp::new();
    let controller = RunController::open(&temp.0).unwrap();
    controller
        .start_with_provider(
            "echo".into(),
            "generic".into(),
            OfflineScenario::Failure,
            std::sync::Arc::new(EchoProvider),
        )
        .unwrap();
    let done = terminal(&controller, "echo");
    assert_eq!(done.status, RunStatus::Completed);
    assert_eq!(done.output, "generic/second");
    controller
        .start_with_provider(
            "panic".into(),
            "x".into(),
            OfflineScenario::Success,
            std::sync::Arc::new(PanicProvider),
        )
        .unwrap();
    let failed = terminal(&controller, "panic");
    assert_eq!(failed.status, RunStatus::Failed);
    assert_eq!(failed.output, "partial");
    assert_eq!(failed.error_code.as_deref(), Some("providerPanicked"));
}

struct ErrorProvider(std::sync::Arc<AtomicU64>);
impl crate::run_provider::RunProvider for ErrorProvider {
    fn execute(
        &self,
        input: &str,
        _: &std::sync::atomic::AtomicBool,
        emit: &mut dyn FnMut(&str) -> Result<(), crate::run_types::RunError>,
    ) -> Result<(), crate::run_types::RunError> {
        self.0.fetch_add(1, Ordering::SeqCst);
        emit(input)?;
        Err(crate::run_types::RunError::RunLimitExceeded)
    }
}
#[test]
fn injected_error_dedupes_and_reopen_never_invokes_provider() {
    let temp = Temp::new();
    let calls = std::sync::Arc::new(AtomicU64::new(0));
    let provider = std::sync::Arc::new(ErrorProvider(calls.clone()));
    let controller = RunController::open(&temp.0).unwrap();
    controller
        .start_with_provider(
            "error".into(),
            "partial".into(),
            OfflineScenario::Success,
            provider.clone(),
        )
        .unwrap();
    let failed = terminal(&controller, "error");
    assert_eq!(failed.status, RunStatus::Failed);
    assert_eq!(failed.output, "partial");
    assert_eq!(failed.error_code.as_deref(), Some("runLimitExceeded"));
    assert_eq!(
        controller
            .start_with_provider(
                "error".into(),
                "partial".into(),
                OfflineScenario::Success,
                provider.clone()
            )
            .unwrap(),
        failed
    );
    drop(controller);
    let reopened = RunController::open(&temp.0).unwrap();
    assert_eq!(reopened.read(None, 0, 64).unwrap().snapshot, failed);
    assert_eq!(
        reopened
            .start_with_provider(
                "error".into(),
                "partial".into(),
                OfflineScenario::Success,
                provider
            )
            .unwrap(),
        failed
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}
struct LateProvider(std::sync::Arc<AtomicU64>);
impl crate::run_provider::RunProvider for LateProvider {
    fn execute(
        &self,
        _: &str,
        cancelled: &std::sync::atomic::AtomicBool,
        emit: &mut dyn FnMut(&str) -> Result<(), crate::run_types::RunError>,
    ) -> Result<(), crate::run_types::RunError> {
        emit("partial")?;
        self.0.fetch_add(1, Ordering::SeqCst);
        while !cancelled.load(Ordering::Acquire) {
            thread::sleep(Duration::from_millis(1));
        }
        emit("late")?;
        panic!("late synthetic panic");
    }
}
fn wait_started(calls: &AtomicU64) {
    let deadline = Instant::now() + Duration::from_secs(3);
    while calls.load(Ordering::SeqCst) == 0 {
        assert!(Instant::now() < deadline);
        thread::sleep(Duration::from_millis(1));
    }
}
#[test]
fn injected_cancel_isolates_late_delta_and_panic_and_next_run() {
    let temp = Temp::new();
    let calls = std::sync::Arc::new(AtomicU64::new(0));
    let controller = RunController::open(&temp.0).unwrap();
    controller
        .start_with_provider(
            "late".into(),
            "x".into(),
            OfflineScenario::Failure,
            std::sync::Arc::new(LateProvider(calls.clone())),
        )
        .unwrap();
    wait_started(&calls);
    let cancelled = controller.cancel("late").unwrap();
    assert_eq!(cancelled.output, "partial");
    controller
        .start_with_provider(
            "next".into(),
            "new".into(),
            OfflineScenario::Slow,
            std::sync::Arc::new(EchoProvider),
        )
        .unwrap();
    assert_eq!(terminal(&controller, "next").output, "new/second");
    assert_eq!(
        controller.read(Some("late"), 0, 64).unwrap().snapshot,
        cancelled
    );
}
#[test]
fn injected_drop_preserves_partial_and_recovery_without_reexecution() {
    let temp = Temp::new();
    let calls = std::sync::Arc::new(AtomicU64::new(0));
    let controller = RunController::open(&temp.0).unwrap();
    controller
        .start_with_provider(
            "drop".into(),
            "x".into(),
            OfflineScenario::Success,
            std::sync::Arc::new(LateProvider(calls.clone())),
        )
        .unwrap();
    wait_started(&calls);
    drop(controller);
    let reopened = RunController::open(&temp.0).unwrap();
    let snapshot = reopened.read(None, 0, 64).unwrap().snapshot;
    assert_eq!(snapshot.status, RunStatus::Interrupted);
    assert_eq!(snapshot.output, "partial");
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}

struct BrokenStoreProvider(PathBuf);
impl crate::run_provider::RunProvider for BrokenStoreProvider {
    fn execute(
        &self,
        _: &str,
        _: &std::sync::atomic::AtomicBool,
        emit: &mut dyn FnMut(&str) -> Result<(), crate::run_types::RunError>,
    ) -> Result<(), crate::run_types::RunError> {
        emit("durable partial")?;
        fs::remove_file(&self.0).unwrap();
        fs::create_dir(&self.0).unwrap();
        emit("not committed")
    }
}
#[test]
fn injected_provider_storage_failure_retains_only_acknowledged_partial() {
    let temp = Temp::new();
    let controller = RunController::open(&temp.0).unwrap();
    controller
        .start_with_provider(
            "broken".into(),
            "input".into(),
            OfflineScenario::Success,
            std::sync::Arc::new(BrokenStoreProvider(temp.0.join("runs-v1/broken.jsonl"))),
        )
        .unwrap();
    let failed = terminal(&controller, "broken");
    assert_eq!(failed.status, RunStatus::Failed);
    assert_eq!(failed.output, "durable partial");
    assert_eq!(failed.error_code.as_deref(), Some("unsafePath"));
    assert!(failed.recovery_required);
    assert_eq!(
        controller
            .start_with_provider(
                "blocked".into(),
                "x".into(),
                OfflineScenario::Success,
                std::sync::Arc::new(EchoProvider)
            )
            .unwrap_err()
            .code(),
        "recoveryRequired"
    );
}
