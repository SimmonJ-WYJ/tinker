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
#[path = "run_store_header.rs"]
mod header;
use crate::run_context::*;
use header::*;
#[path = "tool_store.rs"]
mod tools;
#[derive(Debug, Clone)]
pub(crate) struct StoredRun {
    pub snapshot: RunSnapshot,
    pub events: Vec<RunRecord>,
    pub log_bytes: usize,
    pub lineage: RunLineage,
    pub created_order: u64,
    layout: u8,
}
#[derive(Debug)]
pub struct RunStore {
    root: PathBuf,
    context_root: PathBuf,
    tools_root: PathBuf,
    _writer_lock: File,
    #[cfg(test)]
    pub(crate) fail_tool_sync: std::sync::atomic::AtomicBool,
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
        let context_root = root.join("context-v2");
        ensure_dir(&context_root)?;
        let context_root = context_root.canonicalize()?;
        // 子目录自身同步不确认父目录中的新目录项；宿主启动前必须确认布局。
        File::open(&root)?.sync_all()?;
        Ok(Self {
            tools_root: root.join("tools-v3"),
            context_root,
            root,
            _writer_lock: lock,
            #[cfg(test)]
            fail_tool_sync: std::sync::atomic::AtomicBool::new(false),
        })
    }
    pub(crate) fn ids(&self) -> Result<Vec<String>, RunError> {
        Ok(self.entries()?.into_iter().map(|(_, id)| id).collect())
    }
    fn entries(&self) -> Result<Vec<(u64, String)>, RunError> {
        let mut entries = Vec::new();
        let mut all_ids = std::collections::HashSet::new();
        let mut historical_orders = std::collections::HashSet::new();
        for layout in [1, 2, 3] {
            let dir = self.directory(layout);
            if layout == 3 && !self.tools_exist()? {
                continue;
            }
            ensure_dir(dir)?;
            let mut orders = std::collections::HashSet::new();
            for entry in fs::read_dir(dir)? {
                let path = entry?.path();
                if path.extension().is_none_or(|v| v != "jsonl") {
                    continue;
                }
                safe_file(&path)?;
                let id = path
                    .file_stem()
                    .and_then(|v| v.to_str())
                    .ok_or(RunError::UnsafePath)?;
                validate_id(id)?;
                if !all_ids.insert(id.to_owned()) {
                    return Err(RunError::CorruptLog);
                }
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
                let order = if layout == 3 {
                    let h = tools::decode_tool_header(&line, id)?;
                    h.created_order
                } else {
                    decode_header(&line, id, layout)?.0.created_order
                };
                if !orders.insert(order) || (layout == 3 && historical_orders.contains(&order)) {
                    return Err(RunError::CorruptLog);
                }
                historical_orders.insert(order);
                entries.push((order, layout, id.to_owned()));
            }
        }
        entries.sort();
        Ok(entries
            .into_iter()
            .map(|(order, _, id)| (order, id))
            .collect())
    }
    fn directory(&self, layout: u8) -> &Path {
        if layout == 1 {
            &self.root
        } else if layout == 2 {
            &self.context_root
        } else {
            &self.tools_root
        }
    }
    pub(crate) fn find_location(&self, id: &str) -> Result<u8, RunError> {
        validate_id(id)?;
        ensure_dir(&self.root)?;
        ensure_dir(&self.context_root)?;
        let mut found = None;
        for layout in [1, 2, 3] {
            if layout == 3 && !self.tools_exist()? {
                continue;
            }
            if safe_file(&self.directory(layout).join(format!("{id}.jsonl")))? {
                if found.is_some() {
                    return Err(RunError::CorruptLog);
                }
                found = Some(layout);
            }
        }
        found.ok_or(RunError::RunNotFound)
    }
    pub(crate) fn validate_all(&self) -> Result<(), RunError> {
        // 全部布局预检完成后才允许调用方开始恢复；默认工具能力关闭。
        self.validate_all_layouts()?;
        for id in self.ids()? {
            if self.find_location(&id)? == 3 {
                return Err(RunError::UnsupportedVersion);
            }
        }
        Ok(())
    }
    pub(crate) fn context_for(
        &self,
        parent: &ParentRunRef,
        child_order: u64,
        input: &str,
    ) -> Result<(RunContext, ParentRunRef), RunError> {
        let mut next = parent.clone();
        let mut order = child_order;
        let mut visited = std::collections::HashSet::new();
        let mut turns = Vec::new();
        let mut bytes = input.len();
        loop {
            if turns.len() >= MAX_CONTEXT_ANCESTORS {
                return Err(RunError::ContextLimitExceeded);
            }
            if !visited.insert(next.run_id.clone()) {
                return Err(RunError::CorruptLog);
            }
            if self.find_location(&next.run_id)? == 3 {
                return Err(RunError::ContextUnsupported);
            }
            let run = self.load(&next.run_id)?;
            if run.snapshot.status != RunStatus::Completed || run.snapshot.recovery_required {
                return Err(RunError::ContextParentNotCompleted);
            }
            if run.snapshot.sequence != next.sequence || run.created_order >= order {
                return Err(RunError::CorruptLog);
            }
            bytes += run.snapshot.input.len() + run.snapshot.output.len();
            if bytes > MAX_CONTEXT_BYTES {
                return Err(RunError::ContextLimitExceeded);
            }
            turns.push((run.snapshot.input, run.snapshot.output));
            order = run.created_order;
            match run.lineage {
                RunLineage::Standalone => break,
                RunLineage::Continuation { parent, .. } => next = parent,
            }
        }
        turns.reverse();
        Ok((RunContext::from_turns(turns, input)?, parent.clone()))
    }
    pub(crate) fn continuation_context(
        &self,
        parent_id: &str,
        input: &str,
    ) -> Result<(RunContext, ParentRunRef), RunError> {
        if self.find_location(parent_id)? == 3 {
            return Err(RunError::ContextUnsupported);
        }
        let run = self.load(parent_id)?;
        let parent = ParentRunRef {
            run_id: parent_id.into(),
            sequence: run.snapshot.sequence,
        };
        self.context_for(&parent, u64::MAX, input)
    }
    pub(crate) fn create_continuation(
        &self,
        id: &str,
        input: String,
        scenario: OfflineScenario,
        parent: ParentRunRef,
    ) -> Result<StoredRun, RunError> {
        validate_parent(&parent, id)?;
        self.create_inner(
            id,
            input,
            scenario,
            RunLineage::Continuation {
                parent,
                policy_version: CONTEXT_POLICY_VERSION,
            },
        )
    }
    pub(crate) fn create(
        &self,
        id: &str,
        input: String,
        scenario: OfflineScenario,
    ) -> Result<StoredRun, RunError> {
        self.create_inner(id, input, scenario, RunLineage::Standalone)
    }
    fn create_inner(
        &self,
        id: &str,
        input: String,
        scenario: OfflineScenario,
        lineage: RunLineage,
    ) -> Result<StoredRun, RunError> {
        validate_id(id)?;
        match self.find_location(id) {
            Err(RunError::RunNotFound) => {}
            Ok(_) => return Err(RunError::RequestConflict),
            Err(e) => return Err(e),
        }
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
        let mut bytes = encode_header(&header, &lineage)?;
        if bytes.len() > MAX_HEADER_BYTES {
            return Err(RunError::InputTooLarge);
        }
        bytes.push(b'\n');
        let layout = if matches!(lineage, RunLineage::Standalone) {
            1
        } else {
            2
        };
        let path = self.directory(layout).join(format!("{id}.jsonl"));
        safe_file(&path)?;
        let mut file = options().write(true).create_new(true).open(&path)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        File::open(self.directory(layout))?.sync_all()?;
        let created_order = header.created_order;
        Ok(StoredRun {
            lineage,
            created_order,
            layout,
            snapshot: snapshot_from_header(header),
            events: Vec::new(),
            log_bytes: bytes.len(),
        })
    }
    pub(crate) fn load(&self, id: &str) -> Result<StoredRun, RunError> {
        validate_id(id)?;
        let layout = self.find_location(id)?;
        if layout == 3 {
            return Err(RunError::UnsupportedVersion);
        }
        let path = self.directory(layout).join(format!("{id}.jsonl"));
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
        let (header, lineage) = decode_header(header_line, id, layout)?;
        let created_order = header.created_order;
        let mut loaded = StoredRun {
            lineage,
            created_order,
            layout,
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
        let layout = self.find_location(&run.snapshot.run_id)?;
        if layout != run.layout {
            return Err(RunError::CorruptLog);
        }
        let path = self
            .directory(layout)
            .join(format!("{}.jsonl", run.snapshot.run_id));
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
        let _ = self.cache_snapshot(&run.snapshot, run.layout);
        Ok(())
    }
    fn cache_snapshot(&self, snapshot: &RunSnapshot, layout: u8) -> Result<(), RunError> {
        let root = self.directory(layout);
        let target = root.join(format!("{}.json", snapshot.run_id));
        safe_file(&target)?;
        let temp = root.join(format!(
            ".snapshot-{}-{}",
            std::process::id(),
            NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
        ));
        let result = (|| {
            let mut file = options().write(true).create_new(true).open(&temp)?;
            serde_json::to_writer(&mut file, snapshot).map_err(|_| RunError::StoreIo)?;
            file.sync_all()?;
            fs::rename(&temp, target)?;
            File::open(root)?.sync_all()?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(temp);
        }
        result
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
