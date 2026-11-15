//! 持久化边界、恢复预检和取消调度的私有测试。
use super::*;
use std::sync::{atomic::AtomicUsize, Barrier};
use std::time::Duration;
static NEXT: AtomicUsize = AtomicUsize::new(0);
fn root() -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!(
        "tool-regression-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::SeqCst)
    ));
    std::fs::create_dir(&path).unwrap();
    path
}
struct Provider;
impl RunProvider for Provider {
    fn execute(
        &self,
        _: &str,
        _: &AtomicBool,
        _: &mut dyn FnMut(&str) -> Result<(), RunError>,
    ) -> Result<(), RunError> {
        unreachable!()
    }
    fn execute_tool_round(
        &self,
        c: &ToolContext,
        _: &[ToolSpec],
        _: &AtomicBool,
        _: Duration,
        _: &mut dyn FnMut(&str) -> Result<(), RunError>,
    ) -> Result<ToolRoundOutput, RunError> {
        if c.messages.len() == 1 {
            Ok(ToolRoundOutput::ToolCall(ProviderToolCall {
                id: "c1".into(),
                name: "workspace_read".into(),
                arguments: "{\"path\":\"notes/intro.txt\"}".into(),
            }))
        } else {
            Ok(ToolRoundOutput::Stop)
        }
    }
}
struct Executor(AtomicUsize);
impl ToolExecutor for Executor {
    fn workspace_revision(&self) -> &str {
        "fixture"
    }
    fn catalog(&self) -> Vec<ToolSpec> {
        vec![ToolSpec {
            name: ToolName::WorkspaceRead,
            description: "Read".into(),
        }]
    }
    fn execute(&self, c: &ToolCall, _: &AtomicBool) -> Result<ToolResult, RunError> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Ok(ToolResult {
            call_id: c.call_id.clone(),
            outcome: ToolOutcome::Succeeded,
            content: "fixture".into(),
        })
    }
}
fn wait(c: &RunController, status: RunStatus) -> ToolRunSnapshot {
    let deadline = Instant::now() + Duration::from_secs(4);
    loop {
        let s = c.read_tools("r1", 0, 256).unwrap().snapshot;
        if s.status == status {
            return s;
        }
        assert!(Instant::now() < deadline, "{s:?}");
        std::thread::sleep(Duration::from_millis(2));
    }
}
fn start(c: &RunController, e: Arc<Executor>, timeout: Duration) {
    c.start_tools(
        "r1".into(),
        None,
        "read".into(),
        Arc::new(Provider),
        e,
        ToolRunOptions::new("fixture".into(), Duration::from_secs(1), timeout).unwrap(),
    )
    .unwrap();
}
fn grant(c: &RunController) {
    let p = wait(c, RunStatus::WaitingInput).pending.unwrap();
    c.respond_permission(
        "r1",
        PermissionReply {
            permission_id: p.permission_id,
            decision: PermissionDecision::Granted,
        },
    )
    .unwrap();
}
#[test]
fn durable_write_deadline_blocks_executor_and_completion() {
    for target in ["stopped", "started"] {
        let store = RunStore::open(root()).unwrap();
        *store.delay_tool_sync.lock().unwrap() = Some((target, Duration::from_millis(600)));
        let c = RunController::from_store_with_tools(store).unwrap();
        let e = Arc::new(Executor(AtomicUsize::new(0)));
        start(&c, e.clone(), Duration::from_millis(400));
        grant(&c);
        let s = wait(&c, RunStatus::Failed);
        assert_eq!(s.error_code.as_deref(), Some("runTimeout"));
        assert_eq!(e.0.load(Ordering::SeqCst), usize::from(target == "stopped"));
        let events = c.read_tools("r1", 0, 256).unwrap().events;
        assert!(events.iter().any(|e| if target == "started" {
            matches!(e.event, ToolRecordKind::ToolStarted { .. })
        } else {
            matches!(e.event, ToolRecordKind::RoundFinished { call: None, .. })
        }));
    }
}
#[test]
fn granted_receipt_cancel_wins_before_activation() {
    let path = root();
    let mut store = RunStore::open(&path).unwrap();
    let gate = Arc::new((Barrier::new(2), Barrier::new(2)));
    store.granted_gate = Some(gate.clone());
    let c = RunController::from_store_with_tools(store).unwrap();
    let e = Arc::new(Executor(AtomicUsize::new(0)));
    start(&c, e.clone(), Duration::from_secs(3));
    grant(&c);
    gate.0.wait();
    let bytes = std::fs::read_to_string(path.join("runs-v1/tools-v3/r1.jsonl")).unwrap();
    assert!(bytes.contains("granted"));
    assert!(!bytes.contains("toolStarted"));
    assert_eq!(c.cancel_tools("r1").unwrap().status, RunStatus::Cancelled);
    gate.1.wait();
    drop(c);
    assert_eq!(e.0.load(Ordering::SeqCst), 0);
    assert!(
        !std::fs::read_to_string(path.join("runs-v1/tools-v3/r1.jsonl"))
            .unwrap()
            .contains("toolStarted")
    );
}
#[test]
fn torn_later_log_blocks_all_recovery_writes() {
    use std::io::Write;
    for terminal in [false, true] {
        let path = root();
        let store = RunStore::open(&path).unwrap();
        for order in 1..=2 {
            let mut run = store
                .create_tool_run(ToolRunHeader {
                    storage_version: 3,
                    policy_version: 1,
                    run_id: format!("r{order}"),
                    input: "read".into(),
                    created_order: order,
                    parent: None,
                    workspace_revision: "fixture".into(),
                })
                .unwrap();
            store
                .append_tool_record(&mut run, ToolRecordKind::Started)
                .unwrap();
            if terminal && order == 2 {
                let event = termination(&run, RunStatus::Cancelled, None);
                store.append_tool_record(&mut run, event).unwrap();
            }
        }
        let earlier = path.join("runs-v1/tools-v3/r1.jsonl");
        let later = path.join("runs-v1/tools-v3/r2.jsonl");
        std::fs::OpenOptions::new()
            .append(true)
            .open(&later)
            .unwrap()
            .write_all(b"{")
            .unwrap();
        let before = std::fs::read(&earlier).unwrap();
        assert!(
            store
                .load_tool_run("r2")
                .unwrap()
                .snapshot
                .recovery_required
        );
        drop(store);
        assert!(matches!(
            RunController::open_with_tools(&path),
            Err(RunError::RecoveryRequired)
        ));
        assert_eq!(std::fs::read(&earlier).unwrap(), before);
    }
}
#[test]
fn output_validation_panic_does_not_poison_lifecycle_mutex() {
    struct Panics;
    impl RunProvider for Panics {
        fn execute(
            &self,
            _: &str,
            _: &AtomicBool,
            _: &mut dyn FnMut(&str) -> Result<(), RunError>,
        ) -> Result<(), RunError> {
            unreachable!()
        }
        fn validate_tool_output(&self, _: &str) -> Result<(), RunError> {
            panic!("synthetic validation panic")
        }
        fn execute_tool_round(
            &self,
            _: &ToolContext,
            _: &[ToolSpec],
            _: &AtomicBool,
            _: Duration,
            emit: &mut dyn FnMut(&str) -> Result<(), RunError>,
        ) -> Result<ToolRoundOutput, RunError> {
            emit("candidate")?;
            Ok(ToolRoundOutput::Stop)
        }
    }
    let c = RunController::open_with_tools(root()).unwrap();
    let e = Arc::new(Executor(AtomicUsize::new(0)));
    c.start_tools(
        "r1".into(),
        None,
        "read".into(),
        Arc::new(Panics),
        e,
        ToolRunOptions::new(
            "fixture".into(),
            Duration::from_secs(1),
            Duration::from_secs(2),
        )
        .unwrap(),
    )
    .unwrap();
    let s = wait(&c, RunStatus::Failed);
    assert_eq!(s.error_code.as_deref(), Some("providerPanicked"));
    assert!(s.output.is_empty());
    assert_eq!(c.cancel_tools("r1").unwrap().status, RunStatus::Failed);
}
