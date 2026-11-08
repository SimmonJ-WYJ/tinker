//! 日志与输出预算的合成边界回归，不触碰真实用户数据。
use crate::{
    run_store::{RunStore, StoredRun},
    run_types::*,
};
use std::{
    fs,
    io::Write,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};
static NEXT: AtomicU64 = AtomicU64::new(0);
struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "tinker-run-limits-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
    fn log(&self, id: &str) -> PathBuf {
        self.0.join("runs-v1").join(format!("{id}.jsonl"))
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn running(store: &RunStore, id: &str) -> StoredRun {
    let mut run = store
        .create(id, "合成输入".into(), OfflineScenario::Success)
        .unwrap();
    store
        .append(&mut run, RunRecordKind::Started, None, None)
        .unwrap();
    run
}
#[test]
fn run_store_rejects_oversized_event_before_writing() {
    let temp = Temp::new();
    let store = RunStore::open(&temp.0).unwrap();
    let mut run = running(&store, "event");
    let before = fs::read(temp.log("event")).unwrap();
    assert_eq!(
        store.append(
            &mut run,
            RunRecordKind::Delta,
            Some("\u{0001}".repeat(MAX_EVENT_BYTES / 6)),
            None
        ),
        Err(RunError::RunLimitExceeded)
    );
    assert_eq!(run.snapshot.sequence, 1);
    assert!(run.snapshot.output.is_empty());
    assert_eq!(fs::read(temp.log("event")).unwrap(), before);
}
#[test]
fn run_store_output_limit_preserves_last_committed_bytes() {
    let temp = Temp::new();
    let store = RunStore::open(&temp.0).unwrap();
    let mut run = running(&store, "output");
    for _ in 0..32 {
        store
            .append(&mut run, RunRecordKind::Delta, Some("x".repeat(8192)), None)
            .unwrap();
    }
    assert_eq!(run.snapshot.output.len(), MAX_OUTPUT_BYTES);
    let sequence = run.snapshot.sequence;
    assert_eq!(
        store.append(&mut run, RunRecordKind::Delta, Some("x".into()), None),
        Err(RunError::RunLimitExceeded)
    );
    assert_eq!(run.snapshot.sequence, sequence);
    store
        .append(
            &mut run,
            RunRecordKind::Failed,
            None,
            Some("runLimitExceeded".into()),
        )
        .unwrap();
    assert_eq!(store.load("output").unwrap().snapshot, run.snapshot);
}
#[test]
fn run_store_event_budget_reserves_room_for_a_terminal_record() {
    let temp = Temp::new();
    let store = RunStore::open(&temp.0).unwrap();
    running(&store, "events");
    let mut file = fs::OpenOptions::new()
        .append(true)
        .open(temp.log("events"))
        .unwrap();
    for sequence in 2..MAX_EVENTS as u64 {
        let record = RunRecord {
            protocol_version: 1,
            run_id: "events".into(),
            sequence,
            kind: RunRecordKind::Delta,
            text: Some(String::new()),
            error_code: None,
        };
        serde_json::to_writer(&mut file, &record).unwrap();
        file.write_all(b"\n").unwrap();
    }
    file.sync_all().unwrap();
    drop(file);
    let mut run = store.load("events").unwrap();
    assert_eq!(run.events.len(), MAX_EVENTS - 1);
    assert_eq!(
        store.append(&mut run, RunRecordKind::Delta, Some("x".into()), None),
        Err(RunError::RunLimitExceeded)
    );
    store
        .append(
            &mut run,
            RunRecordKind::Failed,
            None,
            Some("runLimitExceeded".into()),
        )
        .unwrap();
    assert_eq!(run.events.len(), MAX_EVENTS);
    assert_eq!(
        store.load("events").unwrap().snapshot.sequence,
        MAX_EVENTS as u64
    );
}
#[test]
fn run_store_rejects_disk_log_over_four_megabytes() {
    let temp = Temp::new();
    let store = RunStore::open(&temp.0).unwrap();
    running(&store, "log");
    fs::OpenOptions::new()
        .write(true)
        .open(temp.log("log"))
        .unwrap()
        .set_len(MAX_LOG_BYTES as u64 + 1)
        .unwrap();
    assert_eq!(store.load("log").unwrap_err(), RunError::RunLimitExceeded);
}
#[test]
fn run_store_rebuilds_from_jsonl_when_snapshot_cache_is_corrupt() {
    let temp = Temp::new();
    let store = RunStore::open(&temp.0).unwrap();
    let mut run = running(&store, "cache");
    store
        .append(&mut run, RunRecordKind::Completed, None, None)
        .unwrap();
    fs::write(temp.0.join("runs-v1/cache.json"), b"{garbage}").unwrap();
    assert_eq!(store.load("cache").unwrap().snapshot, run.snapshot);
}
#[test]
fn run_store_rejects_unknown_event_fields_and_duplicate_sequence() {
    for replacement in [
        serde_json::json!({"protocolVersion":1,"runId":"shape","sequence":2,"kind":"delta","text":"x","errorCode":null,"unknown":true}),
        serde_json::json!({"protocolVersion":1,"runId":"shape","sequence":1,"kind":"delta","text":"x","errorCode":null}),
    ] {
        let temp = Temp::new();
        let store = RunStore::open(&temp.0).unwrap();
        running(&store, "shape");
        let mut file = fs::OpenOptions::new()
            .append(true)
            .open(temp.log("shape"))
            .unwrap();
        serde_json::to_writer(&mut file, &replacement).unwrap();
        file.write_all(b"\n").unwrap();
        drop(file);
        assert_eq!(store.load("shape").unwrap_err(), RunError::CorruptLog);
    }
}
#[test]
fn run_store_requires_explicit_nullable_event_fields() {
    for field in ["text", "errorCode"] {
        let temp = Temp::new();
        let store = RunStore::open(&temp.0).unwrap();
        store
            .create("nullable", "输入".into(), OfflineScenario::Success)
            .unwrap();
        let mut value = serde_json::json!({"protocolVersion":1,"runId":"nullable","sequence":1,"kind":"started","text":null,"errorCode":null});
        value.as_object_mut().unwrap().remove(field);
        let mut file = fs::OpenOptions::new()
            .append(true)
            .open(temp.log("nullable"))
            .unwrap();
        serde_json::to_writer(&mut file, &value).unwrap();
        file.write_all(b"\n").unwrap();
        drop(file);
        assert_eq!(store.load("nullable").unwrap_err(), RunError::CorruptLog);
    }
}
