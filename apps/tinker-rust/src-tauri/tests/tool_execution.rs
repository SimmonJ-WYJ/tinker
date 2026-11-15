use tinker_rust_foundation::run_controller::RunController;
#[test]
fn tools_open_does_not_create_tool_storage() {
    let root = std::env::temp_dir().join(format!("tool-controller-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    let controller = RunController::open_with_tools(&root).unwrap();
    assert!(!root.join("runs-v1/tools-v3").exists());
    drop(controller);
}
use std::{
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tinker_rust_foundation::{
    run_provider::RunProvider, run_types::RunError, session_lifecycle::RunStatus, tool_types::*,
};
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
        emit: &mut dyn FnMut(&str) -> Result<(), RunError>,
    ) -> Result<ToolRoundOutput, RunError> {
        if c.messages.len() == 1 {
            Ok(ToolRoundOutput::ToolCall(ProviderToolCall {
                id: "c1".into(),
                name: "workspace_read".into(),
                arguments: "{\"path\":\"notes/intro.txt\"}".into(),
            }))
        } else {
            emit("finished")?;
            Ok(ToolRoundOutput::Stop)
        }
    }
}
struct Executor(AtomicUsize);
impl ToolExecutor for Executor {
    fn workspace_revision(&self) -> &str {
        "fixture-v1"
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
            content: "synthetic content".into(),
        })
    }
}
static NEXT: AtomicUsize = AtomicUsize::new(0);
fn controller() -> (std::path::PathBuf, RunController) {
    let root = std::env::temp_dir().join(format!(
        "tool-loop-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::SeqCst)
    ));
    std::fs::create_dir(&root).unwrap();
    let c = RunController::open_with_tools(&root).unwrap();
    (root, c)
}
fn wait(
    c: &RunController,
    status: RunStatus,
) -> tinker_rust_foundation::tool_journal::ToolRunSnapshot {
    let start = Instant::now();
    loop {
        let s = c.read_tools("r1", 0, 256).unwrap().snapshot;
        if s.status == status {
            return s;
        }
        assert!(
            start.elapsed() < Duration::from_secs(3),
            "unexpected status {:?}",
            s.status
        );
        std::thread::sleep(Duration::from_millis(2));
    }
}
fn start(c: &RunController, e: Arc<Executor>, permission: Duration, run: Duration) {
    c.start_tools(
        "r1".into(),
        None,
        "read".into(),
        Arc::new(Provider),
        e,
        ToolRunOptions::new("fixture-v1".into(), permission, run).unwrap(),
    )
    .unwrap();
}
#[test]
fn grant_is_idempotent_and_denial_never_executes() {
    for decision in [PermissionDecision::Granted, PermissionDecision::Denied] {
        let (_, c) = controller();
        let e = Arc::new(Executor(AtomicUsize::new(0)));
        start(
            &c,
            e.clone(),
            Duration::from_secs(1),
            Duration::from_secs(2),
        );
        let pending = wait(&c, RunStatus::WaitingInput).pending.unwrap();
        assert_eq!(e.0.load(Ordering::SeqCst), 0);
        let reply = PermissionReply {
            permission_id: pending.permission_id,
            decision,
        };
        let receipt = c.respond_permission("r1", reply.clone()).unwrap();
        assert_eq!(receipt, c.respond_permission("r1", reply).unwrap());
        wait(&c, RunStatus::Completed);
        assert_eq!(
            e.0.load(Ordering::SeqCst),
            usize::from(decision == PermissionDecision::Granted)
        );
    }
}
#[test]
fn cancelled_wait_never_executes_and_restart_does_not_resume() {
    let (root, c) = controller();
    let e = Arc::new(Executor(AtomicUsize::new(0)));
    start(
        &c,
        e.clone(),
        Duration::from_secs(1),
        Duration::from_secs(2),
    );
    let pending = wait(&c, RunStatus::WaitingInput).pending.unwrap();
    c.cancel_tools("r1").unwrap();
    assert!(c
        .respond_permission(
            "r1",
            PermissionReply {
                permission_id: pending.permission_id,
                decision: PermissionDecision::Granted
            }
        )
        .is_err());
    drop(c);
    let c = RunController::open_with_tools(root).unwrap();
    assert_eq!(
        c.read_tools("r1", 0, 256).unwrap().snapshot.status,
        RunStatus::Cancelled
    );
    assert_eq!(e.0.load(Ordering::SeqCst), 0);
}
#[test]
fn permission_and_total_deadlines_never_execute() {
    for total in [false, true] {
        let (_, c) = controller();
        let e = Arc::new(Executor(AtomicUsize::new(0)));
        start(
            &c,
            e.clone(),
            Duration::from_millis(20),
            if total {
                Duration::from_millis(10)
            } else {
                Duration::from_secs(2)
            },
        );
        let s = wait(
            &c,
            if total {
                RunStatus::Failed
            } else {
                RunStatus::Completed
            },
        );
        if total {
            assert_eq!(s.error_code.as_deref(), Some("runTimeout"));
        }
        assert_eq!(e.0.load(Ordering::SeqCst), 0);
    }
}
#[test]
fn receipt_replay_survives_a_new_run() {
    let (_, c) = controller();
    let e = Arc::new(Executor(AtomicUsize::new(0)));
    start(
        &c,
        e.clone(),
        Duration::from_secs(1),
        Duration::from_secs(2),
    );
    let p = wait(&c, RunStatus::WaitingInput).pending.unwrap();
    let reply = PermissionReply {
        permission_id: p.permission_id,
        decision: PermissionDecision::Denied,
    };
    let receipt = c.respond_permission("r1", reply.clone()).unwrap();
    wait(&c, RunStatus::Completed);
    c.start_tools(
        "r2".into(),
        None,
        "read".into(),
        Arc::new(Provider),
        e,
        ToolRunOptions::new(
            "fixture-v1".into(),
            Duration::from_secs(1),
            Duration::from_secs(2),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(c.respond_permission("r1", reply), Ok(receipt));
}
#[test]
fn corrupt_storage_stops_activation_and_blocks_controller() {
    use std::io::Write;
    let (root, c) = controller();
    let e = Arc::new(Executor(AtomicUsize::new(0)));
    start(
        &c,
        e.clone(),
        Duration::from_secs(1),
        Duration::from_secs(2),
    );
    let p = wait(&c, RunStatus::WaitingInput).pending.unwrap();
    std::fs::OpenOptions::new()
        .append(true)
        .open(root.join("runs-v1/tools-v3/r1.jsonl"))
        .unwrap()
        .write_all(b"foreign")
        .unwrap();
    assert!(c
        .respond_permission(
            "r1",
            PermissionReply {
                permission_id: p.permission_id,
                decision: PermissionDecision::Granted
            }
        )
        .is_err());
    let result = c.start_tools(
        "r2".into(),
        None,
        "read".into(),
        Arc::new(Provider),
        e.clone(),
        ToolRunOptions::new(
            "fixture-v1".into(),
            Duration::from_secs(1),
            Duration::from_secs(2),
        )
        .unwrap(),
    );
    assert_eq!(result, Err(RunError::RecoveryRequired));
    assert_eq!(e.0.load(Ordering::SeqCst), 0);
}
struct BarrierExecutor {
    entered: std::sync::mpsc::Sender<()>,
    release: std::sync::Mutex<std::sync::mpsc::Receiver<()>>,
    count: AtomicUsize,
}
impl ToolExecutor for BarrierExecutor {
    fn workspace_revision(&self) -> &str {
        "fixture-v1"
    }
    fn catalog(&self) -> Vec<ToolSpec> {
        Executor(AtomicUsize::new(0)).catalog()
    }
    fn execute(&self, c: &ToolCall, _: &AtomicBool) -> Result<ToolResult, RunError> {
        self.count.fetch_add(1, Ordering::SeqCst);
        self.entered.send(()).unwrap();
        self.release
            .lock()
            .unwrap()
            .recv_timeout(Duration::from_secs(2))
            .unwrap();
        Ok(ToolResult {
            call_id: c.call_id.clone(),
            outcome: ToolOutcome::Succeeded,
            content: "synthetic".into(),
        })
    }
}
#[test]
fn cancel_ack_waits_for_entered_bounded_executor() {
    let (_, c) = controller();
    let c = Arc::new(c);
    let (entered, entry) = std::sync::mpsc::channel();
    let (release, wait_release) = std::sync::mpsc::channel();
    let e = Arc::new(BarrierExecutor {
        entered,
        release: std::sync::Mutex::new(wait_release),
        count: AtomicUsize::new(0),
    });
    c.start_tools(
        "r1".into(),
        None,
        "read".into(),
        Arc::new(Provider),
        e.clone(),
        ToolRunOptions::new(
            "fixture-v1".into(),
            Duration::from_secs(1),
            Duration::from_secs(3),
        )
        .unwrap(),
    )
    .unwrap();
    let p = wait(&c, RunStatus::WaitingInput).pending.unwrap();
    c.respond_permission(
        "r1",
        PermissionReply {
            permission_id: p.permission_id,
            decision: PermissionDecision::Granted,
        },
    )
    .unwrap();
    entry.recv_timeout(Duration::from_secs(1)).unwrap();
    let clone = c.clone();
    let (ack, received) = std::sync::mpsc::channel();
    let cancel = std::thread::spawn(move || {
        clone.cancel_tools("r1").unwrap();
        ack.send(()).unwrap();
    });
    assert!(received.recv_timeout(Duration::from_millis(20)).is_err());
    release.send(()).unwrap();
    received.recv_timeout(Duration::from_secs(1)).unwrap();
    cancel.join().unwrap();
    assert_eq!(e.count.load(Ordering::SeqCst), 1);
}
#[test]
fn dropped_pending_run_restarts_interrupted_without_execution() {
    let (root, c) = controller();
    let e = Arc::new(Executor(AtomicUsize::new(0)));
    start(
        &c,
        e.clone(),
        Duration::from_secs(1),
        Duration::from_secs(2),
    );
    wait(&c, RunStatus::WaitingInput);
    drop(c);
    let c = RunController::open_with_tools(root).unwrap();
    assert_eq!(
        c.read_tools("r1", 0, 256).unwrap().snapshot.status,
        RunStatus::Interrupted
    );
    assert_eq!(e.0.load(Ordering::SeqCst), 0);
}
struct TimeoutProvider;
impl RunProvider for TimeoutProvider {
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
        _: &ToolContext,
        _: &[ToolSpec],
        _: &AtomicBool,
        remaining: Duration,
        _: &mut dyn FnMut(&str) -> Result<(), RunError>,
    ) -> Result<ToolRoundOutput, RunError> {
        std::thread::sleep(remaining);
        Err(RunError::HttpTimeout)
    }
}
#[test]
fn http_total_deadline_is_run_timeout() {
    let (_, c) = controller();
    c.start_tools(
        "r1".into(),
        None,
        "read".into(),
        Arc::new(TimeoutProvider),
        Arc::new(Executor(AtomicUsize::new(0))),
        ToolRunOptions::new(
            "fixture-v1".into(),
            Duration::from_secs(1),
            Duration::from_millis(200),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(
        wait(&c, RunStatus::Failed).error_code.as_deref(),
        Some("runTimeout")
    );
}
struct GuardProvider;
impl RunProvider for GuardProvider {
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
        t: &[ToolSpec],
        cancel: &AtomicBool,
        r: Duration,
        emit: &mut dyn FnMut(&str) -> Result<(), RunError>,
    ) -> Result<ToolRoundOutput, RunError> {
        Provider.execute_tool_round(c, t, cancel, r, emit)
    }
    fn validate_tool_result(&self, r: &ToolResult) -> Result<(), RunError> {
        if r.content.contains("secret-fixture-token") {
            Err(RunError::ToolFailed)
        } else {
            Ok(())
        }
    }
}
struct LeakingExecutor;
impl ToolExecutor for LeakingExecutor {
    fn workspace_revision(&self) -> &str {
        "fixture-v1"
    }
    fn catalog(&self) -> Vec<ToolSpec> {
        Executor(AtomicUsize::new(0)).catalog()
    }
    fn execute(&self, c: &ToolCall, _: &AtomicBool) -> Result<ToolResult, RunError> {
        Ok(ToolResult {
            call_id: c.call_id.clone(),
            outcome: ToolOutcome::Succeeded,
            content: "secret-fixture-token".into(),
        })
    }
}
#[test]
fn rejected_result_never_enters_journal_or_snapshot() {
    let (root, c) = controller();
    c.start_tools(
        "r1".into(),
        None,
        "read".into(),
        Arc::new(GuardProvider),
        Arc::new(LeakingExecutor),
        ToolRunOptions::new(
            "fixture-v1".into(),
            Duration::from_secs(1),
            Duration::from_secs(2),
        )
        .unwrap(),
    )
    .unwrap();
    let p = wait(&c, RunStatus::WaitingInput).pending.unwrap();
    c.respond_permission(
        "r1",
        PermissionReply {
            permission_id: p.permission_id,
            decision: PermissionDecision::Granted,
        },
    )
    .unwrap();
    let s = wait(&c, RunStatus::Failed);
    assert_eq!(s.error_code.as_deref(), Some("toolFailed"));
    assert!(!serde_json::to_string(&s)
        .unwrap()
        .contains("secret-fixture-token"));
    assert!(
        !std::fs::read_to_string(root.join("runs-v1/tools-v3/r1.jsonl"))
            .unwrap()
            .contains("secret-fixture-token")
    );
}
#[test]
fn bypassed_option_constructor_is_revalidated() {
    let (root, c) = controller();
    assert!(c
        .start_tools(
            "r1".into(),
            None,
            "read".into(),
            Arc::new(Provider),
            Arc::new(Executor(AtomicUsize::new(0))),
            ToolRunOptions {
                workspace_revision: "fixture-v1".into(),
                permission_timeout: Duration::ZERO,
                run_timeout: Duration::from_secs(121)
            }
        )
        .is_err());
    assert!(!root.join("runs-v1/tools-v3").exists());
}
#[test]
fn duplicate_send_and_wrong_permissions_cannot_activate() {
    let (_, c) = controller();
    let e = Arc::new(Executor(AtomicUsize::new(0)));
    start(
        &c,
        e.clone(),
        Duration::from_secs(1),
        Duration::from_secs(2),
    );
    let pending = wait(&c, RunStatus::WaitingInput);
    let duplicate = c
        .start_tools(
            "r1".into(),
            None,
            "read".into(),
            Arc::new(Provider),
            e.clone(),
            ToolRunOptions::new(
                "fixture-v1".into(),
                Duration::from_secs(1),
                Duration::from_secs(2),
            )
            .unwrap(),
        )
        .unwrap();
    assert_eq!(duplicate, pending);
    for (id, permission) in [("r1", "wrong"), ("wrong", "p-r1-0")] {
        assert!(c
            .respond_permission(
                id,
                PermissionReply {
                    permission_id: permission.into(),
                    decision: PermissionDecision::Granted
                }
            )
            .is_err());
    }
    c.cancel_tools("r1").unwrap();
    assert_eq!(e.0.load(Ordering::SeqCst), 0);
}
#[test]
fn default_controller_cannot_start_tools() {
    let root = std::env::temp_dir().join(format!("tool-disabled-{}", std::process::id()));
    std::fs::create_dir(&root).unwrap();
    let c = RunController::open(&root).unwrap();
    let e = Arc::new(Executor(AtomicUsize::new(0)));
    assert_eq!(
        c.start_tools(
            "r1".into(),
            None,
            "read".into(),
            Arc::new(Provider),
            e.clone(),
            ToolRunOptions::new(
                "fixture-v1".into(),
                Duration::from_secs(1),
                Duration::from_secs(2)
            )
            .unwrap()
        ),
        Err(RunError::ToolUnsupported)
    );
    assert_eq!(e.0.load(Ordering::SeqCst), 0);
    assert!(!root.join("runs-v1/tools-v3").exists());
}
