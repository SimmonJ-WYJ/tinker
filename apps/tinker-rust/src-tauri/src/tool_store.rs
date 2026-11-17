//! 工具日志安全 I/O，作为 RunStore 子模块共用已有 writer lock。
use super::*;
use crate::tool_journal::{StoredToolRun, ToolRecord, ToolRecordKind, ToolRunHeader};
pub(super) fn decode_tool_header(line: &[u8], id: &str) -> Result<ToolRunHeader, RunError> {
    check_tool_version(line, "storageVersion", 3)?;
    let h: ToolRunHeader = serde_json::from_slice(line).map_err(|_| RunError::CorruptLog)?;
    h.validate()?;
    if h.run_id != id {
        return Err(RunError::CorruptLog);
    }
    Ok(h)
}
impl RunStore {
    pub(super) fn tools_exist(&self) -> Result<bool, RunError> {
        match fs::symlink_metadata(&self.tools_root) {
            Ok(m) if m.file_type().is_symlink() || !m.is_dir() => Err(RunError::UnsafePath),
            Ok(_) => Ok(true),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(_) => Err(RunError::StoreIo),
        }
    }
    pub(crate) fn validate_all_layouts(&self) -> Result<(), RunError> {
        for id in self.ids()? {
            if self.find_location(&id)? == 3 {
                let run = self.load_tool_run(&id)?;
                self.tool_context_policy(
                    run.header.parent.as_ref(),
                    run.header.created_order,
                    &run.header.input,
                    Some((&id, run.header.policy_version)),
                )?;
            } else {
                let run = self.load(&id)?;
                if let RunLineage::Continuation {
                    parent,
                    policy_version,
                } = &run.lineage
                {
                    self.context_for_policy(
                        parent,
                        run.created_order,
                        &run.snapshot.input,
                        Some((&id, *policy_version)),
                    )?;
                }
            }
        }
        Ok(())
    }
    pub(crate) fn create_tool_run(&self, header: ToolRunHeader) -> Result<StoredToolRun, RunError> {
        header.validate()?;
        self.validate_all_layouts()?;
        match self.find_location(&header.run_id) {
            Err(RunError::RunNotFound) => {}
            Ok(_) => return Err(RunError::RequestConflict),
            Err(e) => return Err(e),
        }
        let expected = self.entries()?.last().map_or(Ok(1), |(o, _)| {
            o.checked_add(1).ok_or(RunError::RunLimitExceeded)
        })?;
        if header.created_order != expected {
            return Err(RunError::CorruptLog);
        }
        self.tool_context_policy(
            header.parent.as_ref(),
            header.created_order,
            &header.input,
            Some((&header.run_id, header.policy_version)),
        )?;
        let mut bytes = serde_json::to_vec(&header).map_err(|_| RunError::StoreIo)?;
        if bytes.len() > MAX_HEADER_BYTES {
            return Err(RunError::InputTooLarge);
        }
        bytes.push(b'\n');
        if !self.tools_exist()? {
            ensure_dir(&self.tools_root)?;
            File::open(&self.root)?.sync_all()?;
        }
        let path = self.tools_root.join(format!("{}.jsonl", header.run_id));
        safe_file(&path)?;
        let mut file = options().write(true).create_new(true).open(path)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        File::open(&self.tools_root)?.sync_all()?;
        let mut run = StoredToolRun::new(header)?;
        run.log_bytes = bytes.len();
        Ok(run)
    }
    pub(crate) fn load_tool_run(&self, id: &str) -> Result<StoredToolRun, RunError> {
        validate_id(id)?;
        if self.find_location(id)? != 3 {
            return Err(RunError::UnsupportedVersion);
        }
        let path = self.tools_root.join(format!("{id}.jsonl"));
        safe_file(&path)?;
        let file = File::open(path)?;
        if file.metadata()?.len() > MAX_LOG_BYTES as u64 {
            return Err(RunError::RunLimitExceeded);
        }
        let mut bytes = Vec::new();
        file.take(MAX_LOG_BYTES as u64 + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() > MAX_LOG_BYTES {
            return Err(RunError::RunLimitExceeded);
        }
        let end = bytes
            .iter()
            .rposition(|b| *b == b'\n')
            .map(|i| i + 1)
            .ok_or(RunError::CorruptLog)?;
        let mut lines = bytes[..end - 1].split(|b| *b == b'\n');
        let h = lines.next().ok_or(RunError::CorruptLog)?;
        if h.len() > MAX_HEADER_BYTES {
            return Err(RunError::RunLimitExceeded);
        }
        let mut run = StoredToolRun::new(decode_tool_header(h, id)?)?;
        for line in lines {
            if line.len() > MAX_EVENT_BYTES {
                return Err(RunError::RunLimitExceeded);
            }
            check_tool_version(line, "version", 1)?;
            let record: ToolRecord =
                serde_json::from_slice(line).map_err(|_| RunError::CorruptLog)?;
            run.apply(record).map_err(|e| match e {
                RunError::UnsupportedVersion | RunError::RunLimitExceeded => e,
                _ => RunError::CorruptLog,
            })?;
        }
        run.log_bytes = bytes.len();
        if end != bytes.len() {
            run.snapshot.recovery_required = true;
        }
        Ok(run)
    }
    pub(crate) fn append_tool_record(
        &self,
        run: &mut StoredToolRun,
        event: ToolRecordKind,
    ) -> Result<(), RunError> {
        if run.snapshot.recovery_required {
            return Err(RunError::RecoveryRequired);
        }
        let record = ToolRecord {
            version: 1,
            run_id: run.header.run_id.clone(),
            sequence: run.snapshot.sequence + 1,
            event,
        };
        let mut encoded = serde_json::to_vec(&record).map_err(|_| RunError::StoreIo)?;
        if encoded.len() > MAX_EVENT_BYTES {
            return Err(RunError::RunLimitExceeded);
        }
        encoded.push(b'\n');
        // ToolFinished 消费 ToolStarted 已预留的结果槽；仅继续保留终态槽。
        let reserve = match &record.event {
            ToolRecordKind::Terminated { .. } => 0,
            ToolRecordKind::ToolFinished { .. } => 1,
            _ => 2,
        };
        if run.events.len() + 1 + reserve > MAX_EVENTS
            || run.log_bytes + encoded.len() + reserve * (MAX_EVENT_BYTES + 1) > MAX_LOG_BYTES
        {
            return Err(RunError::RunLimitExceeded);
        }
        let mut next = run.clone();
        next.apply(record.clone())?;
        let committed = (|| {
            if self.find_location(&run.header.run_id)? != 3 {
                return Err(RunError::CorruptLog);
            }
            let path = self.tools_root.join(format!("{}.jsonl", run.header.run_id));
            if !safe_file(&path)? {
                return Err(RunError::StoreIo);
            }
            let mut file = options().append(true).open(path)?;
            if file.metadata()?.len() != run.log_bytes as u64 {
                return Err(RunError::CorruptLog);
            }
            file.write_all(&encoded)?;
            #[cfg(test)]
            if self.fail_tool_sync.swap(false, Ordering::Relaxed) {
                return Err(RunError::StoreIo);
            }
            file.sync_data()?;
            #[cfg(test)]
            {
                let event = match record.event {
                    ToolRecordKind::ToolStarted { .. } => "started",
                    ToolRecordKind::RoundFinished { call: None, .. } => "stopped",
                    _ => "",
                };
                let mut delay = self.delay_tool_sync.lock().unwrap();
                if delay.as_ref().is_some_and(|(target, _)| *target == event) {
                    std::thread::sleep(delay.take().unwrap().1);
                }
            }
            Ok(())
        })();
        if let Err(e) = committed {
            run.snapshot.recovery_required = true;
            return Err(e);
        }
        next.log_bytes += encoded.len();
        *run = next;
        Ok(())
    }
}

fn check_tool_version(line: &[u8], field: &str, expected: u64) -> Result<(), RunError> {
    let value: serde_json::Value =
        serde_json::from_slice(line).map_err(|_| RunError::CorruptLog)?;
    match value.get(field).and_then(|v| v.as_u64()) {
        Some(v) if v == expected => Ok(()),
        Some(_) => Err(RunError::UnsupportedVersion),
        None => Err(RunError::CorruptLog),
    }
}
