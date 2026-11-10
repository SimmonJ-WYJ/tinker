//! 显式父链、严格存储边界与上下文预算的合成回归。
use crate::{
    run_context::*, run_controller::RunController, run_provider::RunProvider, run_store::RunStore,
    run_types::*, session_lifecycle::RunStatus,
};
use std::{
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
static NEXT: AtomicU64 = AtomicU64::new(0);
struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!(
            "tinker-context-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&p).unwrap();
        Self(p)
    }
    fn log(&self, id: &str, v2: bool) -> PathBuf {
        self.0
            .join(if v2 { "runs-v1/context-v2" } else { "runs-v1" })
            .join(format!("{id}.jsonl"))
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn complete(store: &RunStore, id: &str) -> ParentRunRef {
    let mut r = store
        .create(id, "问题".into(), OfflineScenario::Success)
        .unwrap();
    store
        .append(&mut r, RunRecordKind::Started, None, None)
        .unwrap();
    store
        .append(&mut r, RunRecordKind::Delta, Some("回答".into()), None)
        .unwrap();
    store
        .append(&mut r, RunRecordKind::Completed, None, None)
        .unwrap();
    ParentRunRef {
        run_id: id.into(),
        sequence: r.snapshot.sequence,
    }
}
fn child(store: &RunStore, id: &str, parent: ParentRunRef) -> ParentRunRef {
    let mut r = store
        .create_continuation(id, "续".into(), OfflineScenario::Success, parent)
        .unwrap();
    store
        .append(&mut r, RunRecordKind::Started, None, None)
        .unwrap();
    store
        .append(&mut r, RunRecordKind::Completed, None, None)
        .unwrap();
    ParentRunRef {
        run_id: id.into(),
        sequence: r.snapshot.sequence,
    }
}
fn edit_header(temp: &Temp, id: &str, edit: impl FnOnce(&mut serde_json::Value)) {
    let path = temp.log(id, true);
    let bytes = fs::read_to_string(&path).unwrap();
    let (header, rest) = bytes.split_once('\n').unwrap();
    let mut v = serde_json::from_str(header).unwrap();
    edit(&mut v);
    fs::write(path, format!("{}\n{}", v, rest)).unwrap();
}
#[test]
fn context_exact_content_and_ancestor_boundaries() {
    let turns = vec![("u".into(), "a".into()); 16];
    assert_eq!(
        RunContext::from_turns(turns.clone(), "今")
            .unwrap()
            .messages()
            .len(),
        33
    );
    assert_eq!(
        RunContext::from_turns(vec![("u".into(), "a".into()); 17], "x").unwrap_err(),
        RunError::ContextLimitExceeded
    );
    let input = "中";
    let turns = vec![("u".into(), "a".repeat(MAX_CONTEXT_BYTES - input.len() - 1))];
    assert!(RunContext::from_turns(turns.clone(), input).is_ok());
    assert_eq!(
        RunContext::from_turns(turns, &format!("{input}x")).unwrap_err(),
        RunError::ContextLimitExceeded
    );
    let c = RunContext::from_turns(vec![("\"\n中".into(), "✨".into())], "\0").unwrap();
    assert_eq!(
        serde_json::to_value(c.messages()).unwrap()[1]["role"],
        "assistant"
    );
}
#[test]
fn context_layout_headers_collisions_orders_and_cache() {
    let t = Temp::new();
    let store = RunStore::open(&t.0).unwrap();
    let a = complete(&store, "A");
    child(&store, "B", a.clone());
    assert_eq!(store.ids().unwrap(), ["A", "B"]);
    let root: serde_json::Value = serde_json::from_str(
        fs::read_to_string(t.log("A", false))
            .unwrap()
            .lines()
            .next()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(root.as_object().unwrap().len(), 7);
    assert_eq!(root["protocolVersion"], 1);
    let log = fs::read_to_string(t.log("B", true)).unwrap();
    let header: serde_json::Value = serde_json::from_str(log.lines().next().unwrap()).unwrap();
    assert_eq!(header["protocolVersion"], 2);
    assert_eq!(header["parent"]["sequence"], 3);
    for line in log.lines().skip(1) {
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(line).unwrap()["protocolVersion"],
            1
        );
    }
    fs::write(t.0.join("runs-v1/context-v2/B.json"), "bad cache").unwrap();
    assert_eq!(
        store.load("B").unwrap().snapshot.status,
        RunStatus::Completed
    );
    // 模拟降级写者只看到根目录，跨布局同order按布局稳定排序。
    let mut v = root.clone();
    v["runId"] = "C".into();
    v["requestId"] = "C".into();
    v["createdOrder"] = 2.into();
    fs::write(t.log("C", false), format!("{v}\n")).unwrap();
    assert_eq!(store.ids().unwrap(), ["A", "C", "B"]);
    let before = fs::read(t.log("B", true)).unwrap();
    fs::copy(t.log("A", false), t.log("B", false)).unwrap();
    assert_eq!(store.load("B").unwrap_err(), RunError::CorruptLog);
    assert_eq!(store.ids().unwrap_err(), RunError::CorruptLog);
    assert_eq!(fs::read(t.log("B", true)).unwrap(), before);
}
#[test]
fn context_strict_headers_and_lineage_fail_before_recovery() {
    for case in 0..13 {
        let t = Temp::new();
        let store = RunStore::open(&t.0).unwrap();
        let a = complete(&store, "A");
        child(&store, "B", a);
        drop(store);
        edit_header(&t, "B", |v| match case {
            0 => {
                v["protocolVersion"] = 3.into();
            }
            1 => {
                v["contextPolicyVersion"] = 99.into();
            }
            2 => {
                v.as_object_mut().unwrap().remove("parent");
            }
            3 => {
                v["parent"]["runId"] = "../A".into();
            }
            4 => {
                v["parent"]["runId"] = "B".into();
            }
            5 => {
                v["createdOrder"] = 1.into();
            }
            6 => {
                v["parent"]["sequence"] = 2.into();
            }
            7 => {
                v["parent"]["runId"] = "missing".into();
            }
            8 => {
                v["extra"] = true.into();
            }
            9 => {
                v["parent"]["extra"] = true.into();
            }
            10 => {
                v["parent"]["sequence"] = 0.into();
            }
            11 => {
                v["protocolVersion"] = 1.into();
            }
            _ => {
                v["contextPolicyVersion"] = 0.into();
            }
        });
        let before = fs::read(t.log("B", true)).unwrap();
        assert!(RunController::open(&t.0).is_err(), "case {case}");
        assert_eq!(fs::read(t.log("B", true)).unwrap(), before);
    }
}
#[test]
fn context_missing_or_incomplete_parent_never_becomes_empty_history() {
    for kind in [
        RunRecordKind::Failed,
        RunRecordKind::Cancelled,
        RunRecordKind::Interrupted,
    ] {
        let t = Temp::new();
        let store = RunStore::open(&t.0).unwrap();
        let mut r = store
            .create("A", "u".into(), OfflineScenario::Success)
            .unwrap();
        store
            .append(&mut r, RunRecordKind::Started, None, None)
            .unwrap();
        store.append(&mut r, kind, None, None).unwrap();
        assert_eq!(
            store.continuation_context("A", "x").unwrap_err(),
            RunError::ContextParentNotCompleted
        );
    }
    let t = Temp::new();
    let store = RunStore::open(&t.0).unwrap();
    let a = complete(&store, "A");
    child(&store, "B", a);
    let mut bytes = fs::read(t.log("A", false)).unwrap();
    bytes.extend_from_slice(b"partial");
    fs::write(t.log("A", false), bytes).unwrap();
    assert_eq!(
        store.continuation_context("B", "x").unwrap_err(),
        RunError::ContextParentNotCompleted
    );
}
#[test]
fn context_depth_is_checked_without_dropping_ancestors() {
    let t = Temp::new();
    let store = RunStore::open(&t.0).unwrap();
    let mut parent = complete(&store, "r0");
    for n in 1..16 {
        parent = child(&store, &format!("r{n}"), parent);
    }
    assert_eq!(
        store
            .continuation_context(&parent.run_id, "current")
            .unwrap()
            .0
            .messages()
            .len(),
        33
    );
    parent = child(&store, "r16", parent);
    assert_eq!(
        store.continuation_context(&parent.run_id, "x").unwrap_err(),
        RunError::ContextLimitExceeded
    );
}
struct Echo;
impl RunProvider for Echo {
    fn execute(
        &self,
        input: &str,
        _: &AtomicBool,
        emit: &mut dyn FnMut(&str) -> Result<(), RunError>,
    ) -> Result<(), RunError> {
        emit(input)
    }
}
fn terminal(c: &RunController, id: &str) -> RunSnapshot {
    let until = Instant::now() + Duration::from_secs(4);
    loop {
        let s = c.read(Some(id), 0, 64).unwrap().snapshot;
        if is_terminal(s.status) {
            return s;
        }
        assert!(Instant::now() < until);
        std::thread::sleep(Duration::from_millis(2));
    }
}
#[test]
fn context_legacy_provider_explicitly_rejects_and_dedupes_after_restart() {
    let t = Temp::new();
    let c = RunController::open(&t.0).unwrap();
    c.start_with_provider(
        "A".into(),
        "first".into(),
        OfflineScenario::Success,
        Arc::new(Echo),
    )
    .unwrap();
    terminal(&c, "A");
    c.continue_with_provider(
        "B".into(),
        "A".into(),
        "next".into(),
        OfflineScenario::Success,
        Arc::new(Echo),
    )
    .unwrap();
    let b = terminal(&c, "B");
    assert_eq!(b.error_code.as_deref(), Some("contextUnsupported"));
    assert_eq!(
        c.start_with_provider(
            "B".into(),
            "next".into(),
            OfflineScenario::Success,
            Arc::new(Echo)
        )
        .unwrap_err(),
        RunError::RequestConflict
    );
    assert_eq!(
        c.continue_with_provider(
            "A".into(),
            "B".into(),
            "first".into(),
            OfflineScenario::Success,
            Arc::new(Echo)
        )
        .unwrap_err(),
        RunError::RequestConflict
    );
    assert_eq!(
        c.continue_with_provider(
            "C".into(),
            "B".into(),
            "x".into(),
            OfflineScenario::Success,
            Arc::new(Echo)
        )
        .unwrap_err(),
        RunError::ContextParentNotCompleted
    );
    assert!(!t.log("C", true).exists());
    drop(c);
    let c = RunController::open(&t.0).unwrap();
    assert_eq!(
        c.continue_with_provider(
            "B".into(),
            "A".into(),
            "next".into(),
            OfflineScenario::Success,
            Arc::new(Echo)
        )
        .unwrap(),
        b
    );
    for (parent, input, scenario) in [
        ("A", "changed", OfflineScenario::Success),
        ("A", "next", OfflineScenario::Failure),
        ("missing", "next", OfflineScenario::Success),
    ] {
        assert_eq!(
            c.continue_with_provider(
                "B".into(),
                parent.into(),
                input.into(),
                scenario,
                Arc::new(Echo)
            )
            .unwrap_err(),
            RunError::RequestConflict
        );
    }
    assert_eq!(
        c.continue_with_provider(
            "self".into(),
            "self".into(),
            "x".into(),
            OfflineScenario::Success,
            Arc::new(Echo)
        )
        .unwrap_err(),
        RunError::RequestConflict
    );
}
#[test]
fn context_header_only_is_interrupted_and_retains_parent() {
    let t = Temp::new();
    let store = RunStore::open(&t.0).unwrap();
    let a = complete(&store, "A");
    store
        .create_continuation("B", "u".into(), OfflineScenario::Success, a)
        .unwrap();
    drop(store);
    let c = RunController::open(&t.0).unwrap();
    assert_eq!(
        c.read(Some("B"), 0, 64).unwrap().snapshot.status,
        RunStatus::Interrupted
    );
    drop(c);
    let store = RunStore::open(&t.0).unwrap();
    assert!(matches!(
        store.load("B").unwrap().lineage,
        RunLineage::Continuation { .. }
    ));
}
#[test]
fn context_active_cache_does_not_mask_cross_layout_id_collision() {
    let t = Temp::new();
    let c = RunController::open(&t.0).unwrap();
    c.start_with_provider(
        "A".into(),
        "first".into(),
        OfflineScenario::Success,
        Arc::new(Echo),
    )
    .unwrap();
    terminal(&c, "A");
    fs::copy(t.log("A", false), t.log("A", true)).unwrap();
    assert_eq!(
        c.start_with_provider(
            "A".into(),
            "first".into(),
            OfflineScenario::Success,
            Arc::new(Echo)
        )
        .unwrap_err(),
        RunError::CorruptLog
    );
}
#[test]
fn context_exact_disk_budget_rejects_without_child_creation() {
    let t = Temp::new();
    let store = RunStore::open(&t.0).unwrap();
    let mut parent = None;
    for id in ["A", "B"] {
        let input = "u".repeat(MAX_INPUT_BYTES);
        let mut r = match parent {
            None => store.create(id, input, OfflineScenario::Success),
            Some(p) => store.create_continuation(id, input, OfflineScenario::Success, p),
        }
        .unwrap();
        store
            .append(&mut r, RunRecordKind::Started, None, None)
            .unwrap();
        for _ in 0..16 {
            store
                .append(&mut r, RunRecordKind::Delta, Some("中".repeat(4096)), None)
                .unwrap();
        }
        store
            .append(&mut r, RunRecordKind::Completed, None, None)
            .unwrap();
        parent = Some(ParentRunRef {
            run_id: id.into(),
            sequence: r.snapshot.sequence,
        });
    }
    // 两轮各65536+196608字节，恰为512KiB，当前空字符串仅用于内部预算检查。
    assert!(store.continuation_context("B", "").is_ok());
    assert_eq!(
        store.continuation_context("B", "x").unwrap_err(),
        RunError::ContextLimitExceeded
    );
    drop(store);
    let c = RunController::open(&t.0).unwrap();
    assert_eq!(
        c.continue_with_provider(
            "C".into(),
            "B".into(),
            "x".into(),
            OfflineScenario::Success,
            Arc::new(Echo)
        )
        .unwrap_err(),
        RunError::ContextLimitExceeded
    );
    assert!(!t.log("C", true).exists());
}
#[cfg(unix)]
#[test]
fn context_symlink_hardlink_and_directory_substitution_preserve_targets() {
    use std::os::unix::fs::symlink;
    for hard in [false, true] {
        let t = Temp::new();
        let store = RunStore::open(&t.0).unwrap();
        let a = complete(&store, "A");
        child(&store, "B", a);
        drop(store);
        let target = t.0.join("external");
        fs::rename(t.log("B", true), &target).unwrap();
        let before = fs::read(&target).unwrap();
        if hard {
            fs::hard_link(&target, t.log("B", true)).unwrap();
        } else {
            symlink(&target, t.log("B", true)).unwrap();
        }
        assert_eq!(RunController::open(&t.0).unwrap_err(), RunError::UnsafePath);
        assert_eq!(fs::read(target).unwrap(), before);
    }
    let t = Temp::new();
    let store = RunStore::open(&t.0).unwrap();
    let a = complete(&store, "A");
    child(&store, "B", a);
    drop(store);
    let dir = t.0.join("runs-v1/context-v2");
    let outside = t.0.join("external-dir");
    fs::rename(&dir, &outside).unwrap();
    symlink(&outside, &dir).unwrap();
    assert_eq!(RunController::open(&t.0).unwrap_err(), RunError::UnsafePath);
}
#[test]
fn context_parent_corruption_blocks_before_child_header() {
    let t = Temp::new();
    let c = RunController::open(&t.0).unwrap();
    c.start_with_provider(
        "A".into(),
        "u".into(),
        OfflineScenario::Success,
        Arc::new(Echo),
    )
    .unwrap();
    terminal(&c, "A");
    let mut log = fs::read(t.log("A", false)).unwrap();
    log.extend_from_slice(b"truncated");
    fs::write(t.log("A", false), log).unwrap();
    assert_eq!(
        c.continue_with_provider(
            "B".into(),
            "A".into(),
            "next".into(),
            OfflineScenario::Success,
            Arc::new(Echo)
        )
        .unwrap_err(),
        RunError::ContextParentNotCompleted
    );
    assert!(!t.log("B", true).exists());
}
#[test]
fn context_order_scan_reads_headers_while_open_validates_full_history() {
    let t = Temp::new();
    let store = RunStore::open(&t.0).unwrap();
    complete(&store, "A");
    let mut bytes = fs::read(t.log("A", false)).unwrap();
    bytes.extend_from_slice(b"{bad event}\n");
    fs::write(t.log("A", false), bytes).unwrap();
    assert_eq!(store.ids().unwrap(), ["A"]);
    assert_eq!(store.validate_all().unwrap_err(), RunError::CorruptLog);
}
struct BrokenContext(PathBuf);
impl RunProvider for BrokenContext {
    fn execute(
        &self,
        _: &str,
        _: &AtomicBool,
        _: &mut dyn FnMut(&str) -> Result<(), RunError>,
    ) -> Result<(), RunError> {
        unreachable!()
    }
    fn execute_context(
        &self,
        _: &RunContext,
        _: &AtomicBool,
        emit: &mut dyn FnMut(&str) -> Result<(), RunError>,
    ) -> Result<(), RunError> {
        emit("durable partial")?;
        fs::rename(&self.0, self.0.with_extension("confirmed")).unwrap();
        fs::create_dir(&self.0).unwrap();
        emit("not committed")
    }
}
#[test]
fn context_delta_storage_failure_keeps_confirmed_partial_and_blocks_new_execution() {
    let t = Temp::new();
    let c = RunController::open(&t.0).unwrap();
    c.start_with_provider(
        "A".into(),
        "u".into(),
        OfflineScenario::Success,
        Arc::new(Echo),
    )
    .unwrap();
    terminal(&c, "A");
    c.continue_with_provider(
        "B".into(),
        "A".into(),
        "next".into(),
        OfflineScenario::Success,
        Arc::new(BrokenContext(t.log("B", true))),
    )
    .unwrap();
    let b = terminal(&c, "B");
    assert_eq!(b.status, RunStatus::Failed);
    assert_eq!(b.output, "durable partial");
    assert!(b.recovery_required);
    assert_eq!(b.error_code.as_deref(), Some("unsafePath"));
    assert_eq!(
        c.continue_with_provider(
            "C".into(),
            "A".into(),
            "next".into(),
            OfflineScenario::Success,
            Arc::new(Echo)
        )
        .unwrap_err(),
        RunError::RecoveryRequired
    );
    assert!(!t.log("C", true).exists());
    let bytes = fs::read_to_string(t.log("B", true).with_extension("confirmed")).unwrap();
    assert!(bytes.contains("durable partial"));
    assert!(!bytes.contains("not committed"));
}
#[test]
fn context_invalid_directory_fails_before_provider_and_preserves_v1() {
    let t = Temp::new();
    let store = RunStore::open(&t.0).unwrap();
    complete(&store, "A");
    drop(store);
    let before = fs::read(t.log("A", false)).unwrap();
    fs::remove_dir(t.0.join("runs-v1/context-v2")).unwrap();
    fs::write(t.0.join("runs-v1/context-v2"), "obstruction").unwrap();
    assert_eq!(RunController::open(&t.0).unwrap_err(), RunError::UnsafePath);
    assert_eq!(fs::read(t.log("A", false)).unwrap(), before);
}
#[test]
fn context_multi_node_cycle_is_rejected_without_mutation() {
    let t = Temp::new();
    let store = RunStore::open(&t.0).unwrap();
    let a = complete(&store, "A");
    let b = child(&store, "B", a);
    let c = child(&store, "C", b);
    drop(store);
    edit_header(&t, "B", |v| {
        v["parent"]["runId"] = c.run_id.into();
        v["parent"]["sequence"] = c.sequence.into();
    });
    let before_b = fs::read(t.log("B", true)).unwrap();
    let before_c = fs::read(t.log("C", true)).unwrap();
    assert_eq!(RunController::open(&t.0).unwrap_err(), RunError::CorruptLog);
    assert_eq!(fs::read(t.log("B", true)).unwrap(), before_b);
    assert_eq!(fs::read(t.log("C", true)).unwrap(), before_c);
}
#[test]
fn context_open_validates_later_lineage_before_recovering_earlier_active_run() {
    for started in [false, true] {
        let t = Temp::new();
        let store = RunStore::open(&t.0).unwrap();
        let parent = complete(&store, "P");
        let mut a = store
            .create("A", "active".into(), OfflineScenario::Success)
            .unwrap();
        if started {
            store
                .append(&mut a, RunRecordKind::Started, None, None)
                .unwrap();
            store
                .append(&mut a, RunRecordKind::Delta, Some("partial".into()), None)
                .unwrap();
        }
        store
            .create_continuation("B", "later".into(), OfflineScenario::Success, parent)
            .unwrap();
        drop(store);
        edit_header(&t, "B", |v| v["parent"]["runId"] = "missing".into());
        let before_a = fs::read(t.log("A", false)).unwrap();
        let before_b = fs::read(t.log("B", true)).unwrap();
        assert_eq!(
            RunController::open(&t.0).unwrap_err(),
            RunError::RunNotFound
        );
        assert_eq!(fs::read(t.log("A", false)).unwrap(), before_a);
        assert_eq!(fs::read(t.log("B", true)).unwrap(), before_b);
    }
}
struct CountContext(Arc<AtomicU64>);
impl RunProvider for CountContext {
    fn execute(
        &self,
        _: &str,
        _: &AtomicBool,
        emit: &mut dyn FnMut(&str) -> Result<(), RunError>,
    ) -> Result<(), RunError> {
        self.0.fetch_add(1, Ordering::SeqCst);
        emit("ok")
    }
    fn execute_context(
        &self,
        _: &RunContext,
        token: &AtomicBool,
        emit: &mut dyn FnMut(&str) -> Result<(), RunError>,
    ) -> Result<(), RunError> {
        self.execute("", token, emit)
    }
}
#[cfg(unix)]
#[test]
fn context_real_header_permission_failure_starts_no_provider_and_blocks_until_reopen() {
    use std::os::unix::fs::PermissionsExt;
    let t = Temp::new();
    let c = RunController::open(&t.0).unwrap();
    c.start_with_provider(
        "A".into(),
        "root".into(),
        OfflineScenario::Success,
        Arc::new(Echo),
    )
    .unwrap();
    terminal(&c, "A");
    let calls = Arc::new(AtomicU64::new(0));
    let provider = Arc::new(CountContext(calls.clone()));
    let dir = t.0.join("runs-v1/context-v2");
    let permissions = fs::metadata(&dir).unwrap().permissions();
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o500)).unwrap();
    let result = c.continue_with_provider(
        "B".into(),
        "A".into(),
        "next".into(),
        OfflineScenario::Success,
        provider.clone(),
    );
    fs::set_permissions(&dir, permissions).unwrap();
    assert_eq!(result.unwrap_err(), RunError::StoreIo);
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    assert!(!t.log("B", true).exists());
    assert_eq!(
        c.continue_with_provider(
            "C".into(),
            "A".into(),
            "next".into(),
            OfflineScenario::Success,
            provider.clone()
        )
        .unwrap_err(),
        RunError::RecoveryRequired
    );
    assert!(!t.log("C", true).exists());
    drop(c);
    let c = RunController::open(&t.0).unwrap();
    c.continue_with_provider(
        "B".into(),
        "A".into(),
        "next".into(),
        OfflineScenario::Success,
        provider,
    )
    .unwrap();
    assert_eq!(terminal(&c, "B").status, RunStatus::Completed);
    assert_eq!(calls.load(Ordering::SeqCst), 1);
}
