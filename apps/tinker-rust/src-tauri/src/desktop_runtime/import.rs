//! 导入的不可变 seed 与现有单条 Session catalog 发布；历史绝不作为待执行请求重放。
use super::{protocol::*, session::Entry, store, DesktopRuntime, Inner, Session};
use crate::{
    electron_import::{SourceMessage, SourceSession},
    legacy_attachments::{self, StoredFile},
    run_context::{ChatMessage, ChatRole, RunContext},
    run_provider::RunProvider,
    run_types::RunError,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fs::{self, File},
    io::{Read, Write},
    path::Path,
    sync::{atomic::AtomicBool, Arc},
};
#[path = "portable.rs"]
pub(crate) mod portable;
#[path = "import_workspace.rs"]
mod workspace;
pub(super) const PREFIX: &str = "electron-import-";
const SEED_FILE: &str = "imported-session-v1.json";
const INTENT_FILE: &str = "import-intent-v1.json";
const MAX_SEED_BYTES: usize = 8 * 1024 * 1024;
const MAX_VISIBLE_IMPORT_BYTES: usize = 4 * 1024 * 1024;
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Seed {
    version: u32,
    integrity: String,
    session: Session,
    source_session_id: String,
    fingerprint: String,
    messages: Vec<SourceMessage>,
    files: Vec<StoredFile>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    turns: Vec<super::Turn>,
    #[serde(skip)]
    claimed_workspace: Option<String>,
    #[serde(skip)]
    pub(super) revision_draft: Option<portable::RevisionDraft>,
}
#[derive(Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Intent {
    version: u32,
    source_session_id: String,
    fingerprint: String,
    session_id: String,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReceipt {
    pub session_id: String,
    pub imported: bool,
}
struct HashWriter(Sha256);
impl Write for HashWriter {
    fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
        self.0.update(b);
        Ok(b.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
fn digest(value: &impl Serialize) -> Result<String> {
    let mut writer = HashWriter(Sha256::new());
    serde_json::to_writer(&mut writer, value).map_err(|_| DesktopError("invalidImport"))?;
    Ok(format!("{:x}", writer.0.finalize()))
}
fn session_id(source: &str) -> Result<String> {
    Ok(format!("{PREFIX}{}", &digest(&source)?[..40]))
}
fn validate_messages(messages: &[SourceMessage]) -> Result<()> {
    if messages.len() > 256 {
        return Err(DesktopError("importLimit"));
    }
    let mut ids = BTreeSet::new();
    for m in messages {
        if m.id.is_empty()
            || m.id.len() > 512
            || !ids.insert(&m.id)
            || m.created_at > MAX_SAFE_INTEGER
            || m.attachment_ids.len() > 64
        {
            return Err(DesktopError("invalidImport"));
        }
        let limit = match m.role.as_str() {
            "user" => crate::run_types::MAX_INPUT_BYTES,
            "assistant" => crate::run_types::MAX_OUTPUT_BYTES,
            _ => return Err(DesktopError("invalidImport")),
        };
        if m.text.len() > limit {
            return Err(DesktopError("importLimit"));
        }
    }
    Ok(())
}
fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T> {
    store::safe_file(path)?;
    let file = File::open(path).map_err(|_| DesktopError("corruptImport"))?;
    if file.metadata()?.len() > MAX_SEED_BYTES as u64 {
        return Err(DesktopError("importLimit"));
    }
    let mut bytes = Vec::new();
    file.take(MAX_SEED_BYTES as u64 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > MAX_SEED_BYTES {
        return Err(DesktopError("importLimit"));
    }
    serde_json::from_slice(&bytes).map_err(|_| DesktopError("corruptImport"))
}
fn write_json(path: &Path, value: &impl Serialize) -> Result<()> {
    write_json_with_sync(path, value, store::sync_directory)
}
fn write_json_with_sync(
    path: &Path,
    value: &impl Serialize,
    sync: impl Fn(&Path) -> Result<()>,
) -> Result<()> {
    store::safe_file(path)?;
    let bytes = serde_json::to_vec(value).map_err(|_| DesktopError("invalidImport"))?;
    if bytes.len() > MAX_SEED_BYTES {
        return Err(DesktopError("importLimit"));
    }
    let parent = path.parent().ok_or(DesktopError("unsafePath"))?;
    let name = path
        .file_name()
        .and_then(|v| v.to_str())
        .ok_or(DesktopError("unsafePath"))?;
    let temp = parent.join(format!(".{name}.tmp"));
    store::safe_file(&temp)?;
    if temp.exists() {
        let mut old = Vec::new();
        File::open(&temp)?
            .take(MAX_SEED_BYTES as u64 + 1)
            .read_to_end(&mut old)?;
        if !bytes.starts_with(&old) {
            return Err(DesktopError("importConflict"));
        }
        fs::remove_file(&temp)?;
    }
    let result = (|| {
        let mut file = store::options().write(true).create_new(true).open(&temp)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        fs::rename(&temp, path)?;
        sync(parent)
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}
fn integrity(seed: &Seed) -> Result<String> {
    if seed.version == 2 {
        return digest(&(
            &seed.session,
            &seed.fingerprint,
            &seed.messages,
            &seed.files,
            &seed.turns,
        ));
    }
    digest(&(
        seed.version,
        &seed.session,
        &seed.source_session_id,
        &seed.fingerprint,
        &seed.messages,
        &seed.files,
    ))
}
fn validate_files(seed: &Seed, dir: &Path, read_bytes: bool) -> Result<()> {
    let mut ids = BTreeSet::new();
    for file in &seed.files {
        file.validate()?;
        if !ids.insert(&file.id) {
            return Err(DesktopError("corruptImport"));
        }
        if read_bytes {
            legacy_attachments::read_asset(dir, file)?;
        }
    }
    for message in &seed.messages {
        if message.attachment_ids.iter().any(|id| !ids.contains(id)) {
            return Err(DesktopError("corruptImport"));
        }
    }
    Ok(())
}
pub(super) fn load(dir: &Path, sid: &str) -> Result<Seed> {
    let mut seed: Seed = read_json(&dir.join(SEED_FILE))?;
    if seed.version != 1 || !seed.turns.is_empty() {
        return Err(DesktopError("unsupportedVersion"));
    }
    validate_messages(&seed.messages)?;
    if seed.integrity != integrity(&seed)? {
        return Err(DesktopError("corruptImport"));
    }
    if seed.session.session_id != sid
        || session_id(&seed.source_session_id)? != sid
        || seed.fingerprint.len() != 64
        || !seed.fingerprint.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err(DesktopError("corruptImport"));
    }
    validate_files(&seed, dir, false)?;
    workspace::load_claim(&mut seed, dir)?;
    Ok(seed)
}
impl Seed {
    pub(super) fn has_archived_request(&self, rid: &str) -> bool {
        self.turns.iter().any(|turn| turn.request_id == rid)
    }
    pub(super) fn metadata(&self) -> &Session {
        &self.session
    }
    pub(super) fn workspace(&self) -> Option<&str> {
        self.session
            .workspace_id
            .as_deref()
            .or(self.claimed_workspace.as_deref())
    }
    pub(super) fn len(&self) -> usize {
        self.messages.len() + self.turns.len()
    }
    fn prefix(&self) -> Vec<ChatMessage> {
        self.messages
            .iter()
            .filter(|m| !m.text.is_empty())
            .map(|m| ChatMessage {
                role: if m.role == "user" {
                    ChatRole::User
                } else {
                    ChatRole::Assistant
                },
                content: m.text.clone(),
            })
            .chain(
                self.turns
                    .iter()
                    .filter(|t| t.status == crate::session_lifecycle::RunStatus::Completed)
                    .flat_map(|t| {
                        [
                            ChatMessage {
                                role: ChatRole::User,
                                content: t.user_message.clone(),
                            },
                            ChatMessage {
                                role: ChatRole::Assistant,
                                content: t.assistant_message.clone(),
                            },
                        ]
                    })
                    .filter(|m| !m.content.is_empty()),
            )
            .collect()
    }
    pub(super) fn turn(&self, index: usize) -> Result<Value> {
        if index >= self.messages.len() {
            let turn = self
                .turns
                .get(index - self.messages.len())
                .ok_or(DesktopError("invalidCursor"))?;
            let mut value = json!(turn);
            value["toolState"] = Value::Null;
            return Ok(value);
        }
        let m = self
            .messages
            .get(index)
            .ok_or(DesktopError("invalidCursor"))?;
        let sid = &self.session.session_id;
        let message_id = format!("electron-import:{sid}:{}", m.id);
        let mut sdk = json!({"type":m.role,"uuid":message_id,"_electronSourceMessageId":m.id,"message":{"content":[{"type":"text","text":m.text}]},"parent_tool_use_id":null,"_createdAt":m.created_at,"_electronImported":true,"session_id":sid});
        legacy_attachments::project(&mut sdk, sid, &m.attachment_ids, &self.files);
        Ok(
            json!({"sessionId":sid,"requestId":format!("electron-import-record:{sid}:{index}"),"runId":format!("electron-import-record:{sid}:{index}"),"userMessageId":if m.role=="user"{message_id.clone()}else{String::new()},"assistantMessageId":if m.role=="assistant"{message_id.clone()}else{String::new()},"profileId":self.session.profile_id,"modelId":"imported-history","configRevision":"imported-history-v1","effort":null,"startedAt":m.created_at,"userMessage":if m.role=="user"{m.text.clone()}else{String::new()},"assistantMessage":if m.role=="assistant"{m.text.clone()}else{String::new()},"status":"completed","sequence":0,"errorCode":null,"toolState":null,"importedMessages":[sdk]}),
        )
    }
}
impl DesktopRuntime {
    pub fn import_electron_session(
        &self,
        source: &SourceSession,
        profile_id: &str,
        prepare_assets: impl FnOnce(&Path) -> Result<Vec<StoredFile>>,
    ) -> Result<ImportReceipt> {
        self.import_electron_session_in_workspace(source, profile_id, None, prepare_assets)
    }
    pub fn import_electron_session_in_workspace(
        &self,
        source: &SourceSession,
        profile_id: &str,
        workspace: Option<&str>,
        prepare_assets: impl FnOnce(&Path) -> Result<Vec<StoredFile>>,
    ) -> Result<ImportReceipt> {
        if let Some(workspace) = workspace {
            id(workspace)?;
        }
        validate_messages(&source.messages)?;
        title(&source.title)?;
        id(profile_id)?;
        if source.source_session_id.is_empty()
            || source.source_session_id.len() > 4096
            || source.created_at > source.updated_at
            || source.updated_at > MAX_SAFE_INTEGER
        {
            return Err(DesktopError("invalidImport"));
        }
        let sid = session_id(&source.source_session_id)?;
        let fingerprint = digest(source)?;
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| DesktopError("runtimeUnavailable"))?;
        inner.journal.ensure_writable()?;
        if inner.sessions.get(&sid).is_some_and(|s| s.deleted) {
            return Err(DesktopError("importConflict"));
        }
        if let Some(seed) = inner.imported.get(&sid) {
            if seed.fingerprint != fingerprint || seed.source_session_id != source.source_session_id
            {
                return Err(DesktopError("importConflict"));
            }
            let dir = inner.journal.root.join(&sid);
            let mut fresh = load(&dir, &sid)?;
            if fresh.integrity != seed.integrity {
                return Err(DesktopError("corruptImport"));
            }
            workspace::claim(&mut fresh, &dir, workspace)?;
            inner.imported.insert(sid.clone(), fresh);
            return Ok(ImportReceipt {
                session_id: sid,
                imported: false,
            });
        }
        if inner.sessions.contains_key(&sid) {
            return Err(DesktopError("importConflict"));
        }
        if inner.sessions.len() >= MAX_SESSIONS {
            return Err(DesktopError("sessionLimit"));
        }
        if !(inner.profiles.contains_key(profile_id)
            || (inner.managed && profile_id == super::UNCONFIGURED_PROFILE_ID))
        {
            return Err(DesktopError("profileNotFound"));
        }
        let dir = inner.journal.root.join(&sid);
        store::directory(&dir)?;
        let intent = Intent {
            version: 1,
            source_session_id: source.source_session_id.clone(),
            fingerprint: fingerprint.clone(),
            session_id: sid.clone(),
        };
        let intent_path = dir.join(INTENT_FILE);
        if intent_path.exists() {
            let old: Intent = read_json(&intent_path)?;
            if old != intent {
                return Err(DesktopError("importConflict"));
            }
        } else {
            if fs::read_dir(&dir)?
                .any(|entry| entry.map_or(true, |e| e.file_name() != ".import-intent-v1.json.tmp"))
            {
                return Err(DesktopError("importConflict"));
            }
            write_json(&intent_path, &intent)?;
        }
        let seed_path = dir.join(SEED_FILE);
        let mut seed = if seed_path.exists() {
            let seed = load(&dir, &sid)?;
            if seed.fingerprint != fingerprint || seed.source_session_id != source.source_session_id
            {
                return Err(DesktopError("importConflict"));
            }
            seed
        } else {
            let files = prepare_assets(&dir)?;
            let session = Session {
                session_id: sid.clone(),
                title: source.title.clone(),
                profile_id: profile_id.into(),
                workspace_id: workspace.map(str::to_owned),
                pinned: source.pinned,
                archived: source.archived,
                created_at: source.created_at,
                updated_at: source.updated_at,
                deleted: false,
            };
            let mut seed = Seed {
                version: 1,
                integrity: String::new(),
                session,
                source_session_id: source.source_session_id.clone(),
                fingerprint,
                messages: source.messages.clone(),
                files,
                turns: vec![],
                claimed_workspace: None,
                revision_draft: None,
            };
            seed.integrity = integrity(&seed)?;
            validate_files(&seed, &dir, true)?;
            write_json(&seed_path, &seed)?;
            seed
        };
        let visible = seed
            .messages
            .iter()
            .enumerate()
            .try_fold(0usize, |total, (i, _)| {
                let n = serde_json::to_vec(&seed.turn(i)?)
                    .map_err(|_| DesktopError("invalidImport"))?
                    .len();
                total.checked_add(n).ok_or(DesktopError("importLimit"))
            })?;
        if visible > MAX_VISIBLE_IMPORT_BYTES {
            return Err(DesktopError("importLimit"));
        }
        workspace::claim(&mut seed, &dir, workspace)?;
        let store = crate::run_store::RunStore::open(&dir)?;
        super::execution::validate_store(&store, &[], !inner.tools.is_empty())?;
        for path in [
            dir.join("runs-v1/context-v2"),
            dir.join("runs-v1"),
            dir.clone(),
            inner.journal.root.clone(),
        ] {
            store::sync_directory(&path)?;
        }
        let controller = if inner.tools.is_empty() {
            crate::run_controller::RunController::from_store(store)?
        } else {
            crate::run_controller::RunController::from_store_with_tools(store)?
        };
        inner.journal.append(Entry::Session {
            session: seed.session.clone(),
        })?;
        inner.sessions.insert(sid.clone(), seed.session.clone());
        inner.bindings.insert(sid.clone(), vec![]);
        inner.controllers.insert(sid.clone(), controller);
        inner.imported.insert(sid.clone(), seed);
        Ok(ImportReceipt {
            session_id: sid,
            imported: true,
        })
    }
    pub(crate) fn imported_files(&self, sid: &str) -> Result<Vec<StoredFile>> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| DesktopError("runtimeUnavailable"))?;
        inner.session(sid)?;
        inner.require_import_seed(sid)?;
        Ok(inner
            .imported
            .get(sid)
            .map_or_else(Vec::new, |s| s.files.clone()))
    }
    #[cfg(all(target_os = "macos", feature = "formal-preview"))]
    pub(crate) fn history_image(
        &self,
        sid: &str,
        message_id: &str,
        filename: &str,
    ) -> Result<(StoredFile, Vec<u8>)> {
        let missing = DesktopError("imageNotFound");
        let inner = self
            .inner
            .lock()
            .map_err(|_| DesktopError("runtimeUnavailable"))?;
        inner.session(sid)?;
        inner.require_import_seed(sid)?;
        let seed = inner.imported.get(sid).ok_or(missing)?;
        let message = seed
            .messages
            .iter()
            .find(|m| m.id == message_id)
            .ok_or(missing)?;
        let file = seed
            .files
            .iter()
            .find(|f| {
                f.media_type == "image/png"
                    && message.attachment_ids.contains(&f.id)
                    && legacy_attachments::wire_name(f) == filename
            })
            .ok_or(missing)?;
        let bytes = legacy_attachments::read_asset(&inner.journal.root.join(sid), file)?;
        Ok((file.clone(), bytes))
    }

    pub(crate) fn imported_file_bytes(&self, sid: &str, filename: &str) -> Result<Option<Vec<u8>>> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| DesktopError("runtimeUnavailable"))?;
        inner.session(sid)?;
        inner.require_import_seed(sid)?;
        let Some(seed) = inner.imported.get(sid) else {
            return Ok(None);
        };
        let Some(file) = seed
            .files
            .iter()
            .find(|f| legacy_attachments::wire_name(f) == filename)
        else {
            return Ok(None);
        };
        Ok(Some(legacy_attachments::read_asset(
            &inner.journal.root.join(sid),
            file,
        )?))
    }
}
impl Inner {
    pub(super) fn require_import_seed(&self, sid: &str) -> Result<()> {
        if (sid.starts_with(PREFIX) || sid.starts_with("portable-"))
            && !self.imported.contains_key(sid)
        {
            return Err(DesktopError("corruptImport"));
        }
        Ok(())
    }
    pub(super) fn import_profile_guard(&self, sid: &str, profile_id: &str) -> Result<()> {
        self.require_import_seed(sid)?;
        if let Some(seed) = self.imported.get(sid) {
            let dir = self.journal.root.join(sid);
            store::existing_run_layout(&dir)?;
            let fresh = if seed.version == 2 {
                portable::load(&dir, sid, &seed.integrity)?
            } else {
                load(&dir, sid)?
            };
            if fresh.integrity != seed.integrity {
                return Err(DesktopError("corruptImport"));
            }
            if self.tools.contains_key(profile_id) {
                return Err(DesktopError("contextUnsupported"));
            }
        }
        Ok(())
    }
    pub(super) fn import_preflight(
        &self,
        sid: &str,
        rid: &str,
        parent: Option<&str>,
        input: &str,
        profile_id: &str,
    ) -> Result<()> {
        self.import_profile_guard(sid, profile_id)?;
        if self.imported.contains_key(sid) {
            let context = self
                .controllers
                .get(sid)
                .ok_or(DesktopError("sessionNotFound"))?
                .preflight_text_context(rid, parent, input)?;
            self.import_validate_context(sid, &context)?;
        }
        Ok(())
    }
    pub(super) fn import_validate_context(&self, sid: &str, context: &RunContext) -> Result<()> {
        if let Some(seed) = self.imported.get(sid) {
            RunContext::prepend(&seed.prefix(), context)?;
        }
        Ok(())
    }
    pub(super) fn import_provider(
        &self,
        sid: &str,
        provider: Arc<dyn RunProvider>,
    ) -> Arc<dyn RunProvider> {
        match self.imported.get(sid) {
            Some(seed) => Arc::new(SeededProvider {
                prefix: seed.prefix(),
                provider,
            }),
            None => provider,
        }
    }
}
struct SeededProvider {
    prefix: Vec<ChatMessage>,
    provider: Arc<dyn RunProvider>,
}
impl RunProvider for SeededProvider {
    fn validate_tool_metadata(&self, v: &Value) -> std::result::Result<(), RunError> {
        self.provider.validate_tool_metadata(v)
    }
    fn execute(
        &self,
        input: &str,
        token: &AtomicBool,
        emit: &mut dyn FnMut(&str) -> std::result::Result<(), RunError>,
    ) -> std::result::Result<(), RunError> {
        self.execute_context(&RunContext::single(input), token, emit)
    }
    fn execute_context(
        &self,
        context: &RunContext,
        token: &AtomicBool,
        emit: &mut dyn FnMut(&str) -> std::result::Result<(), RunError>,
    ) -> std::result::Result<(), RunError> {
        self.provider
            .execute_context(&RunContext::prepend(&self.prefix, context)?, token, emit)
    }
}
