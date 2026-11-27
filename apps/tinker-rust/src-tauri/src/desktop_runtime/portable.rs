//! 可移植历史是不可执行的快照。只发布一个目录清单 journal 记录。
use super::*;
use crate::{
    desktop_runtime::{Entry, Turn, UNCONFIGURED_PROFILE_ID},
    electron_import::SourceAttachment,
    formal_platform::TrustedRoot,
    run_controller::RunController,
    run_store::RunStore,
};
use std::collections::BTreeMap;

const SEED: &str = "portable-history-v1.json";
const OWNER: &str = "portable-owner-v1.json";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PortableSession {
    session: Session,
    messages: Vec<SourceMessage>,
    attachments: Vec<SourceAttachment>,
    turns: Vec<Turn>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PortableEntry {
    pub(crate) session_id: String,
    pub(crate) integrity: String,
}

impl PortableSession {
    pub(crate) fn session_id(&self) -> &str {
        &self.session.session_id
    }

    pub(crate) fn validate_references(&self, root: &TrustedRoot, workspace: &str) -> Result<()> {
        self.validate(workspace)?;
        for reference in self
            .turns
            .iter()
            .filter_map(|turn| turn.document_source.as_ref())
        {
            if !reference.matches_project(root, workspace)? {
                return Err(DesktopError("invalidImport"));
            }
        }
        Ok(())
    }

    fn validate(&self, workspace: &str) -> Result<()> {
        self.validate_for(Some(workspace), UNCONFIGURED_PROFILE_ID)
    }

    fn validate_for(&self, workspace: Option<&str>, profile: &str) -> Result<()> {
        let canonical_digest = |n: &str| {
            n.len() == 40
                && n.bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        };
        if let Some(workspace) = workspace {
            id(workspace)?;
        }
        id(self.session_id())?;
        // 禁止预留名字与 journal / 锁文件冲突。
        if !(self
            .session_id()
            .strip_prefix("portable-")
            .is_some_and(canonical_digest)
            || self.session_id().strip_prefix("session-").is_some_and(|n| {
                n.parse::<usize>()
                    .is_ok_and(|v| v > 0 && v.to_string() == n)
            })
            || self
                .session_id()
                .strip_prefix(PREFIX)
                .is_some_and(canonical_digest))
        {
            return Err(DesktopError("invalidImport"));
        }
        title(&self.session.title)?;
        if self.session.workspace_id.as_deref() != workspace
            || self.session.deleted
            || self.session.profile_id != profile
            || self.session.created_at > self.session.updated_at
            || self.session.updated_at > MAX_SAFE_INTEGER
        {
            return Err(DesktopError("invalidImport"));
        }
        validate_messages(&self.messages)?;
        if self.turns.len() > MAX_REQUESTS || self.attachments.len() > 128 {
            return Err(DesktopError("importLimit"));
        }
        let mut requests = BTreeSet::new();
        for turn in &self.turns {
            id(&turn.request_id)?;
            if !requests.insert(&turn.request_id)
                || turn.session_id != self.session_id()
                || turn.run_id != turn.request_id
                || turn.user_message_id != format!("{}-user", turn.request_id)
                || turn.assistant_message_id != format!("{}-assistant", turn.request_id)
                || turn.started_at > MAX_SAFE_INTEGER
                || turn.sequence > MAX_SAFE_INTEGER
                || turn.user_message.len() > crate::run_types::MAX_INPUT_BYTES
                || turn.assistant_message.len() > crate::run_types::MAX_OUTPUT_BYTES
                || !crate::run_types::is_terminal(turn.status)
                || turn.profile_id != "portable-history"
                || turn.config_revision != "portable-history-v1"
                || turn.model_id != "portable-history"
                || turn.effort.is_some()
                || turn
                    .error_code
                    .as_ref()
                    .is_some_and(|code| id(code).is_err())
            {
                return Err(DesktopError("invalidImport"));
            }
        }
        let mut ids = BTreeSet::new();
        for item in &self.attachments {
            let file = file_metadata(item);
            file.validate()?;
            if item.media_type == "image/png" {
                crate::picked_image::validate_legacy_png(&item.bytes)?;
            } else if std::str::from_utf8(&item.bytes).is_err() || item.bytes.contains(&0) {
                return Err(DesktopError("invalidImportedFile"));
            }
            if !ids.insert(&item.id) {
                return Err(DesktopError("invalidImport"));
            }
        }
        if self
            .messages
            .iter()
            .flat_map(|m| &m.attachment_ids)
            .any(|id| !ids.contains(id))
        {
            return Err(DesktopError("invalidImport"));
        }
        let referenced: BTreeSet<_> = self
            .messages
            .iter()
            .flat_map(|m| m.attachment_ids.iter())
            .collect();
        if ids != referenced {
            return Err(DesktopError("invalidImport"));
        }
        let summary = self.seed(String::new());
        if serde_json::to_vec(&summary)
            .map_err(|_| DesktopError("invalidImport"))?
            .len()
            + 128
            > MAX_SEED_BYTES
        {
            return Err(DesktopError("importLimit"));
        }
        Ok(())
    }
    fn seed(&self, fingerprint: String) -> Seed {
        Seed {
            version: 2,
            integrity: String::new(),
            session: self.session.clone(),
            source_session_id: String::new(),
            fingerprint,
            messages: self.messages.clone(),
            files: self.attachments.iter().map(file_metadata).collect(),
            turns: self.turns.clone(),
            claimed_workspace: None,
        }
    }
}

fn file_metadata(item: &SourceAttachment) -> StoredFile {
    StoredFile {
        id: item.id.clone(),
        filename: item.filename.clone(),
        media_type: item.media_type.clone(),
        sha256: format!("{:x}", Sha256::digest(&item.bytes)),
        size: item.bytes.len() as u64,
    }
}

pub(in crate::desktop_runtime) fn load(dir: &Path, sid: &str, expected: &str) -> Result<Seed> {
    let seed: Seed = read_json(&dir.join(SEED))?;
    if seed.version != 2
        || seed.session.session_id != sid
        || seed.integrity != expected
        || integrity(&seed)? != expected
    {
        return Err(DesktopError("corruptImport"));
    }
    validate_files(&seed, dir, false)?;
    Ok(seed)
}

impl DesktopRuntime {
    pub(crate) fn export_portable_sessions(&self, workspace: &str) -> Result<Vec<PortableSession>> {
        id(workspace)?;
        let inner = self
            .inner
            .lock()
            .map_err(|_| DesktopError("runtimeUnavailable"))?;
        let mut out = vec![];
        let mut remaining = crate::portable_project::MAX_ARCHIVE_BYTES;
        for session in inner
            .sessions
            .values()
            .filter(|s| !s.deleted && inner.session_workspace(s) == Some(workspace))
        {
            let sid = &session.session_id;
            inner.require_import_seed(sid)?;
            if inner
                .chains
                .values()
                .filter(|chain| &chain.session_id == sid)
                .any(|chain| chain.messages.iter().any(|m| !m.bound))
            {
                return Err(DesktopError("contextUnsupported"));
            }
            let mut value = PortableSession {
                session: session.clone(),
                messages: vec![],
                attachments: vec![],
                turns: vec![],
            };
            value.session.workspace_id = Some(workspace.into());
            value.session.profile_id = UNCONFIGURED_PROFILE_ID.into();
            if let Some(seed) = inner.imported.get(sid) {
                let dir = inner.journal.root.join(sid);
                let fresh = if seed.version == 2 {
                    load(&dir, sid, &seed.integrity)?
                } else {
                    super::load(&dir, sid)?
                };
                for text in fresh.messages.iter().map(|m| m.text.len()).chain(
                    fresh
                        .turns
                        .iter()
                        .map(|t| t.user_message.len() + t.assistant_message.len()),
                ) {
                    remaining = remaining
                        .checked_sub(text)
                        .ok_or(DesktopError("storageLimit"))?;
                }
                value.messages = fresh.messages;
                value.turns = fresh.turns;
                for file in fresh.files {
                    remaining = remaining
                        .checked_sub(file.size as usize)
                        .ok_or(DesktopError("storageLimit"))?;
                    let bytes = legacy_attachments::read_asset(&dir, &file)?;
                    value.attachments.push(SourceAttachment {
                        id: file.id,
                        filename: file.filename,
                        media_type: file.media_type,
                        bytes,
                    });
                }
            }
            for binding in inner
                .bindings
                .get(sid)
                .ok_or(DesktopError("sessionNotFound"))?
            {
                let mut projection = inner.turn_v2(binding)?;
                if projection
                    .as_object_mut()
                    .and_then(|o| o.remove("toolState"))
                    .is_some_and(|v| !v.is_null())
                {
                    return Err(DesktopError("contextUnsupported"));
                }
                let mut turn: Turn = serde_json::from_value(projection)
                    .map_err(|_| DesktopError("invalidImport"))?;
                if !crate::run_types::is_terminal(turn.status) {
                    return Err(DesktopError("runBusy"));
                }
                turn.profile_id = "portable-history".into();
                turn.model_id = "portable-history".into();
                turn.config_revision = "portable-history-v1".into();
                turn.effort = None;
                remaining = remaining
                    .checked_sub(turn.user_message.len() + turn.assistant_message.len())
                    .ok_or(DesktopError("storageLimit"))?;
                value.turns.push(turn);
            }
            value.validate(workspace)?;
            out.push(value);
        }
        Ok(out)
    }

    /// 独立安装常有同名 session-1。只冲突时重映射；历史消息、引用和资产一致使用新身份。
    pub(crate) fn map_portable_sessions(
        &self,
        workspace: &str,
        sessions: &mut [PortableSession],
    ) -> Result<BTreeMap<String, String>> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| DesktopError("runtimeUnavailable"))?;
        let mut map = BTreeMap::new();
        let reserved: BTreeSet<String> =
            sessions.iter().map(|s| s.session_id().to_owned()).collect();
        if reserved.len() != sessions.len() {
            return Err(DesktopError("invalidImport"));
        }
        for value in sessions {
            value.validate(workspace)?;
            let original = value.session_id().to_owned();
            let owner = digest(value)?;
            let sid = if inner.sessions.contains_key(&original)
                && !inner
                    .imported
                    .get(&original)
                    .is_some_and(|s| s.version == 2 && s.fingerprint == owner)
            {
                let mapped = format!("portable-{}", &digest(&(workspace, &original))?[..40]);
                if reserved.contains(&mapped) {
                    return Err(DesktopError("importConflict"));
                }
                mapped
            } else {
                original.clone()
            };
            value.session.session_id = sid.clone();
            for turn in &mut value.turns {
                turn.session_id = sid.clone();
            }
            map.insert(original, sid);
        }
        Ok(map)
    }

    pub(crate) fn preflight_portable_sessions(
        &self,
        workspace: &str,
        sessions: &[PortableSession],
    ) -> Result<()> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| DesktopError("runtimeUnavailable"))?;
        preflight(&inner, Some(workspace), UNCONFIGURED_PROFILE_ID, sessions)
    }

    pub(crate) fn restore_portable_sessions(
        &self,
        workspace: &str,
        sessions: &[PortableSession],
        publish_catalog: impl FnOnce() -> Result<()>,
    ) -> Result<()> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| DesktopError("runtimeUnavailable"))?;
        preflight(&inner, Some(workspace), UNCONFIGURED_PROFILE_ID, sessions)?;
        publish(&mut inner, sessions, publish_catalog)
    }
}

fn publish(
    inner: &mut Inner,
    sessions: &[PortableSession],
    publish_catalog: impl FnOnce() -> Result<()>,
) -> Result<()> {
    let mut staged = BTreeMap::new();
    let mut entries = vec![];
    for value in sessions {
        let sid = value.session_id();
        if inner.sessions.contains_key(sid) {
            continue;
        }
        let dir = inner.journal.root.join(sid);
        let owner = digest(value)?;
        if !dir.try_exists()? {
            let preparing = inner.journal.root.join(format!(".portable-{owner}"));
            store::directory(&preparing)?;
            write_json(&preparing.join(OWNER), &owner)?;
            fs::rename(&preparing, &dir)?;
            store::sync_directory(&inner.journal.root)?;
        }
        legacy_attachments::stage_files(&dir, &value.attachments)?;
        let mut seed = value.seed(owner);
        seed.integrity = integrity(&seed)?;
        write_json(&dir.join(SEED), &seed)?;
        let run_store = RunStore::open(&dir)?;
        crate::desktop_runtime::execution::validate_store(
            &run_store,
            &[],
            !inner.tools.is_empty(),
        )?;
        let controller = if inner.tools.is_empty() {
            RunController::from_store(run_store)?
        } else {
            RunController::from_store_with_tools(run_store)?
        };
        for path in [
            dir.join("runs-v1/context-v2"),
            dir.join("runs-v1"),
            dir,
            inner.journal.root.clone(),
        ] {
            store::sync_directory(&path)?;
        }
        entries.push(PortableEntry {
            session_id: sid.into(),
            integrity: seed.integrity.clone(),
        });
        staged.insert(sid.to_owned(), (seed, controller));
    }
    if !entries.is_empty() {
        inner
            .journal
            .append(Entry::PortableSessions { sessions: entries })?;
    }
    if let Err(error) = publish_catalog() {
        inner.journal.require_recovery();
        return Err(error);
    }
    for (sid, (seed, controller)) in staged {
        inner.sessions.insert(sid.clone(), seed.session.clone());
        inner.controllers.insert(sid.clone(), controller);
        inner.bindings.insert(sid.clone(), vec![]);
        inner.imported.insert(sid, seed);
    }
    Ok(())
}

fn preflight(
    inner: &Inner,
    workspace: Option<&str>,
    profile: &str,
    sessions: &[PortableSession],
) -> Result<()> {
    inner.journal.ensure_writable()?;
    if let Some(w) = workspace {
        id(w)?;
    }

    let mut ids = BTreeSet::new();
    let mut count = inner.sessions.len();
    let mut entries = vec![];
    for value in sessions {
        value.validate_for(workspace, profile)?;
        let sid = value.session_id();
        if !ids.insert(sid) {
            return Err(DesktopError("invalidImport"));
        }
        let owner = digest(value)?;
        if let Some(session) = inner.sessions.get(sid) {
            if session.deleted
                || !inner
                    .imported
                    .get(sid)
                    .is_some_and(|s| s.version == 2 && s.fingerprint == owner)
            {
                return Err(DesktopError("importConflict"));
            }
        } else {
            count += 1;
            entries.push(PortableEntry {
                session_id: sid.into(),
                integrity: integrity(&value.seed(owner.clone()))?,
            });
            let dir = inner.journal.root.join(sid);
            if dir.try_exists()? {
                store::directory(&dir)?;
                if read_json::<String>(&dir.join(OWNER))? != owner {
                    return Err(DesktopError("importConflict"));
                }
            }
        }
    }
    if !entries.is_empty() {
        inner.journal.check_portable_batch(entries)?;
    }
    if count > MAX_SESSIONS {
        return Err(DesktopError("sessionLimit"));
    }
    Ok(())
}

#[cfg(test)]
#[path = "portable_tests.rs"]
mod tests;

#[path = "fork.rs"]
mod fork;
