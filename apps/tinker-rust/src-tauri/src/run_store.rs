//! 独立 runs-v1 的单写者 JSONL 事实源；快照只作为可重建缓存。
use crate::{
    run_types::*,
    session_lifecycle::{RunEvent, RunState, RunStatus},
};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions, TryLockError},
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RunHeader {
    protocol_version: u32,
    run_id: String,
    request_id: String,
    provider_kind: ProviderKind,
    scenario: OfflineScenario,
    input: String,
    created_order: u64,
}
#[derive(Debug, Clone)]
pub(crate) struct StoredRun {
    pub snapshot: RunSnapshot,
    pub events: Vec<RunRecord>,
    pub log_bytes: usize,
}
#[derive(Debug)]
pub struct RunStore {
    root: PathBuf,
    _writer_lock: File,
}
impl RunStore {
    pub fn open(parent: impl AsRef<Path>) -> Result<Self, RunError> {
        let parent = parent.as_ref();
        ensure_dir(parent)?;
        let root = parent.join("runs-v1");
        ensure_dir(&root)?;
        let root = root.canonicalize()?;
        let lock_path = root.join("writer.lock");
        safe_file(&lock_path)?;
        let lock = options()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(lock_path)?;
        lock.try_lock().map_err(|error| match error {
            TryLockError::WouldBlock => RunError::StoreLocked,
            TryLockError::Error(_) => RunError::StoreIo,
        })?;
        Ok(Self {
            root,
            _writer_lock: lock,
        })
    }
    pub(crate) fn ids(&self) -> Result<Vec<String>, RunError> {
        Ok(self.entries()?.into_iter().map(|(_, id)| id).collect())
    }
    fn entries(&self) -> Result<Vec<(u64, String)>, RunError> {
        ensure_dir(&self.root)?;
        let mut ids = Vec::new();
        for entry in fs::read_dir(&self.root)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().is_some_and(|ext| ext == "jsonl") {
                safe_file(&path)?;
                let id = path
                    .file_stem()
                    .and_then(|id| id.to_str())
                    .ok_or(RunError::UnsafePath)?;
                validate_id(id)?;
                let file = File::open(&path)?;
                if file.metadata()?.len() > MAX_LOG_BYTES as u64 {
                    return Err(RunError::RunLimitExceeded);
                }
                let mut line = Vec::new();
                BufReader::new(file.take(MAX_HEADER_BYTES as u64 + 1))
                    .read_until(b'\n', &mut line)?;
                if line.last() != Some(&b'\n') || line.len() > MAX_HEADER_BYTES + 1 {
                    return Err(RunError::CorruptLog);
                }
                check_version(&line)?;
                let header: RunHeader =
                    serde_json::from_slice(&line).map_err(|_| RunError::CorruptLog)?;
                if header.run_id != id || header.request_id != id || header.created_order == 0 {
                    return Err(RunError::CorruptLog);
                }
                ids.push((header.created_order, id.to_owned()));
            }
        }
        ids.sort();
        if ids.windows(2).any(|pair| pair[0].0 == pair[1].0) {
            return Err(RunError::CorruptLog);
        }
        Ok(ids)
    }
    pub(crate) fn create(
        &self,
        id: &str,
        input: String,
        scenario: OfflineScenario,
    ) -> Result<StoredRun, RunError> {
        validate_id(id)?;
        if input.len() > MAX_INPUT_BYTES {
            return Err(RunError::InputTooLarge);
        }
        let created_order = self.entries()?.last().map_or(Ok(1), |(order, _)| {
            order.checked_add(1).ok_or(RunError::RunLimitExceeded)
        })?;
        let header = RunHeader {
            protocol_version: PROTOCOL_VERSION,
            run_id: id.into(),
            request_id: id.into(),
            provider_kind: ProviderKind::OfflineFixture,
            scenario,
            input,
            created_order,
        };
        let mut bytes = serde_json::to_vec(&header).map_err(|_| RunError::StoreIo)?;
        if bytes.len() > MAX_HEADER_BYTES {
            return Err(RunError::InputTooLarge);
        }
        bytes.push(b'\n');
        let path = self.log_path(id);
        safe_file(&path)?;
        let mut file = options().write(true).create_new(true).open(&path)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        File::open(&self.root)?.sync_all()?;
        Ok(StoredRun {
            snapshot: snapshot_from_header(header),
            events: Vec::new(),
            log_bytes: bytes.len(),
        })
    }
    pub(crate) fn load(&self, id: &str) -> Result<StoredRun, RunError> {
        validate_id(id)?;
        let path = self.log_path(id);
        if !safe_file(&path)? {
            return Err(RunError::RunNotFound);
        }
        let file = File::open(&path)?;
        if file.metadata()?.len() > MAX_LOG_BYTES as u64 {
            return Err(RunError::RunLimitExceeded);
        }
        let mut bytes = Vec::new();
        file.take(MAX_LOG_BYTES as u64 + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() > MAX_LOG_BYTES {
            return Err(RunError::RunLimitExceeded);
        }
        let complete_end = bytes
            .iter()
            .rposition(|byte| *byte == b'\n')
            .map(|index| index + 1)
            .ok_or(RunError::CorruptLog)?;
        let mut lines = bytes[..complete_end - 1].split(|byte| *byte == b'\n');
        let header_line = lines.next().ok_or(RunError::CorruptLog)?;
        if header_line.len() > MAX_HEADER_BYTES {
            return Err(RunError::RunLimitExceeded);
        }
        check_version(header_line)?;
        let header: RunHeader =
            serde_json::from_slice(header_line).map_err(|_| RunError::CorruptLog)?;
        if header.run_id != id
            || header.request_id != id
            || header.input.len() > MAX_INPUT_BYTES
            || header.created_order == 0
        {
            return Err(RunError::CorruptLog);
        }
        let mut loaded = StoredRun {
            snapshot: snapshot_from_header(header),
            events: Vec::new(),
            log_bytes: bytes.len(),
        };
        for line in lines {
            if line.is_empty() {
                return Err(RunError::CorruptLog);
            }
            if line.len() > MAX_EVENT_BYTES {
                return Err(RunError::RunLimitExceeded);
            }
            check_version(line)?;
            let record: RunRecord =
                serde_json::from_slice(line).map_err(|_| RunError::CorruptLog)?;
            apply_record(&mut loaded, record)?;
        }
        if complete_end != bytes.len() {
            loaded.snapshot.recovery_required = true;
            if !is_terminal(loaded.snapshot.status) {
                loaded.snapshot.status = RunStatus::Interrupted;
                loaded.snapshot.error_code = Some("truncatedLog".into());
            }
        }
        Ok(loaded)
    }
    pub(crate) fn append(
        &self,
        run: &mut StoredRun,
        kind: RunRecordKind,
        text: Option<String>,
        error_code: Option<String>,
    ) -> Result<(), RunError> {
        if run.snapshot.recovery_required {
            return Err(RunError::RecoveryRequired);
        }
        let record = RunRecord {
            protocol_version: PROTOCOL_VERSION,
            run_id: run.snapshot.run_id.clone(),
            sequence: run.snapshot.sequence + 1,
            kind,
            text,
            error_code,
        };
        let mut encoded = serde_json::to_vec(&record).map_err(|_| RunError::StoreIo)?;
        if encoded.len() > MAX_EVENT_BYTES || run.events.len() >= MAX_EVENTS {
            return Err(RunError::RunLimitExceeded);
        }
        encoded.push(b'\n');
        let reserve = if kind == RunRecordKind::Delta {
            MAX_EVENT_BYTES + 1
        } else {
            0
        };
        if run.log_bytes + encoded.len() + reserve > MAX_LOG_BYTES
            || (kind == RunRecordKind::Delta && run.events.len() >= MAX_EVENTS - 1)
        {
            return Err(RunError::RunLimitExceeded);
        }
        let mut next = run.clone();
        apply_record(&mut next, record)?;
        let path = self.log_path(&run.snapshot.run_id);
        if !safe_file(&path)? {
            return Err(RunError::StoreIo);
        }
        let mut file = options().append(true).open(path)?;
        if file.metadata()?.len() != run.log_bytes as u64 {
            return Err(RunError::CorruptLog);
        }
        file.write_all(&encoded)?;
        file.sync_data()?;
        next.log_bytes += encoded.len();
        *run = next;
        // 快照是派生缓存；JSONL 已经同步落盘后，缓存失败不能推翻已提交事件。
        let _ = self.cache_snapshot(&run.snapshot);
        Ok(())
    }
    fn cache_snapshot(&self, snapshot: &RunSnapshot) -> Result<(), RunError> {
        let target = self.root.join(format!("{}.json", snapshot.run_id));
        safe_file(&target)?;
        let temp = self.root.join(format!(
            ".snapshot-{}-{}",
            std::process::id(),
            NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
        ));
        let result = (|| {
            let mut file = options().write(true).create_new(true).open(&temp)?;
            serde_json::to_writer(&mut file, snapshot).map_err(|_| RunError::StoreIo)?;
            file.sync_all()?;
            fs::rename(&temp, target)?;
            File::open(&self.root)?.sync_all()?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(temp);
        }
        result
    }
    fn log_path(&self, id: &str) -> PathBuf {
        self.root.join(format!("{id}.jsonl"))
    }
}
fn snapshot_from_header(header: RunHeader) -> RunSnapshot {
    RunSnapshot {
        protocol_version: PROTOCOL_VERSION,
        run_id: header.run_id,
        request_id: header.request_id,
        provider_kind: header.provider_kind,
        scenario: header.scenario,
        input: header.input,
        output: String::new(),
        status: RunStatus::Queued,
        sequence: 0,
        error_code: None,
        recovery_required: false,
    }
}
fn check_version(line: &[u8]) -> Result<(), RunError> {
    let value: serde_json::Value =
        serde_json::from_slice(line).map_err(|_| RunError::CorruptLog)?;
    match value
        .get("protocolVersion")
        .and_then(|value| value.as_u64())
    {
        Some(1) => Ok(()),
        Some(_) => Err(RunError::UnsupportedVersion),
        None => Err(RunError::CorruptLog),
    }
}
fn apply_record(run: &mut StoredRun, record: RunRecord) -> Result<(), RunError> {
    if record.run_id != run.snapshot.run_id
        || record.sequence != run.snapshot.sequence + 1
        || run.events.len() >= MAX_EVENTS
        || record.protocol_version != PROTOCOL_VERSION
    {
        return Err(RunError::CorruptLog);
    }
    let event = match record.kind {
        RunRecordKind::Started => Some(RunEvent::Start),
        RunRecordKind::Delta => None,
        RunRecordKind::Completed => Some(RunEvent::Complete),
        RunRecordKind::Failed => Some(RunEvent::Fail),
        RunRecordKind::Cancelled => Some(RunEvent::Cancel),
        RunRecordKind::Interrupted => Some(RunEvent::Interrupt),
    };
    if let Some(event) = event {
        if record.text.is_some()
            || (matches!(
                record.kind,
                RunRecordKind::Started | RunRecordKind::Completed | RunRecordKind::Cancelled
            ) && record.error_code.is_some())
        {
            return Err(RunError::CorruptLog);
        }
        let mut state = RunState::queued(&run.snapshot.run_id).map_err(|_| RunError::CorruptLog)?;
        if run.snapshot.status != RunStatus::Queued {
            state
                .apply(&run.snapshot.run_id, RunEvent::Start)
                .map_err(|_| RunError::CorruptLog)?;
        }
        if is_terminal(run.snapshot.status) {
            return Err(RunError::CorruptLog);
        }
        state
            .apply(&run.snapshot.run_id, event)
            .map_err(|_| RunError::CorruptLog)?;
        run.snapshot.status = state.status();
    } else {
        if run.snapshot.status != RunStatus::Running || record.error_code.is_some() {
            return Err(RunError::CorruptLog);
        }
        let text = record.text.as_ref().ok_or(RunError::CorruptLog)?;
        if run.snapshot.output.len() + text.len() > MAX_OUTPUT_BYTES {
            return Err(RunError::RunLimitExceeded);
        }
        run.snapshot.output.push_str(text);
    }
    run.snapshot.sequence = record.sequence;
    run.snapshot.error_code = record.error_code.clone();
    run.events.push(record);
    Ok(())
}
fn options() -> OpenOptions {
    let mut options = OpenOptions::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options
}
fn ensure_dir(path: &Path) -> Result<(), RunError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            Err(RunError::UnsafePath)
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let mut builder = fs::DirBuilder::new();
            builder.recursive(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::DirBuilderExt;
                builder.mode(0o700);
            }
            builder.create(path)?;
            Ok(())
        }
        Err(_) => Err(RunError::StoreIo),
    }
}
fn safe_file(path: &Path) -> Result<bool, RunError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if !metadata.is_file() || metadata.file_type().is_symlink() {
                return Err(RunError::UnsafePath);
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;
                if metadata.nlink() != 1 {
                    return Err(RunError::UnsafePath);
                }
            }
            Ok(true)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(_) => Err(RunError::StoreIo),
    }
}
