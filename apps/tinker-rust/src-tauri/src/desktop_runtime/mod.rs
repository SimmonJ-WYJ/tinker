//! 正式会话服务；stdio与Tauri共同调用，秘密仅由可信宿主注入。
mod execution;
mod profile;
pub mod protocol;
mod session;
mod store;
use crate::{run_controller::RunController, run_store::RunStore};
use profile::Profile;
pub use profile::{Model, TrustedProfile};
use protocol::*;
pub use protocol::{DesktopError, DesktopReply, DesktopRequest};
use serde_json::{json, Value};
use session::{Binding, Entry};
pub use session::{Session, Turn};
use std::{
    collections::{BTreeMap, HashSet},
    path::Path,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use store::Journal;
pub struct DesktopRuntime {
    inner: Mutex<Inner>,
}
struct Inner {
    journal: Journal,
    profiles: BTreeMap<String, Profile>,
    sessions: BTreeMap<String, Session>,
    bindings: BTreeMap<String, Vec<Binding>>,
    controllers: BTreeMap<String, RunController>,
}
impl DesktopRuntime {
    /// root须由可信宿主在稳定父目录下durable创建，使用既有绝对路径且无symlink祖先。
    /// 服务只创建自身namespace，启动时再次确认root及直接parent，不创建调用方祖先。
    pub fn open(root: impl AsRef<Path>, profiles: Vec<TrustedProfile>) -> Result<Self> {
        if profiles.is_empty() || profiles.len() > 128 {
            return Err(DesktopError("invalidProfile"));
        }
        let mut registry = BTreeMap::new();
        for p in profiles {
            let p = Profile::from_trusted(p)?;
            if registry.insert(p.profile_id.clone(), p).is_some() {
                return Err(DesktopError("invalidProfile"));
            }
        }
        if serde_json::to_vec(&registry.values().collect::<Vec<_>>())
            .map_err(|_| DesktopError("invalidProfile"))?
            .len()
            > MAX_PAGE_BYTES
        {
            return Err(DesktopError("invalidProfile"));
        }
        let (journal, records) = Journal::open(root.as_ref())?;
        let mut inner = Inner {
            journal,
            profiles: registry,
            sessions: BTreeMap::new(),
            bindings: BTreeMap::new(),
            controllers: BTreeMap::new(),
        };
        let mut requests = HashSet::new();
        for record in records {
            match record.entry {
                Entry::Session { session } => {
                    id(&session.session_id)?;
                    id(&session.profile_id)?;
                    title(&session.title)?;
                    if let Some(w) = &session.workspace_id {
                        id(w)?;
                    }
                    if session.created_at > MAX_SAFE_INTEGER
                        || session.updated_at > MAX_SAFE_INTEGER
                        || session.updated_at < session.created_at
                    {
                        return Err(DesktopError("corruptJournal"));
                    }
                    if let Some(old) = inner.sessions.get(&session.session_id) {
                        if old.profile_id != session.profile_id
                            || old.workspace_id != session.workspace_id
                            || old.created_at != session.created_at
                            || session.updated_at <= old.updated_at
                            || old.deleted
                        {
                            return Err(DesktopError("corruptJournal"));
                        }
                    } else if session.deleted || inner.sessions.len() >= MAX_SESSIONS {
                        return Err(DesktopError("corruptJournal"));
                    }
                    inner
                        .bindings
                        .entry(session.session_id.clone())
                        .or_default();
                    inner.sessions.insert(session.session_id.clone(), session);
                }
                Entry::Bind { binding } => {
                    execution::validate_send(&binding.request)?;
                    id(&binding.config_revision)?;
                    let s = inner.session(&binding.request.session_id)?;
                    if binding.accepted_at <= s.updated_at
                        || binding.accepted_at > MAX_SAFE_INTEGER
                        || !requests.insert(binding.request.request_id.clone())
                    {
                        return Err(DesktopError("corruptJournal"));
                    }
                    let bindings = inner
                        .bindings
                        .get_mut(&binding.request.session_id)
                        .ok_or(DesktopError("corruptJournal"))?;
                    if bindings.len() >= MAX_REQUESTS
                        || binding.parent_run_id.as_ref().is_some_and(|parent| {
                            !bindings.iter().any(|b| b.request.request_id == *parent)
                        })
                    {
                        return Err(DesktopError("corruptJournal"));
                    }
                    let session = inner
                        .sessions
                        .get_mut(&binding.request.session_id)
                        .ok_or(DesktopError("corruptJournal"))?;
                    session.updated_at = binding.accepted_at;
                    session.profile_id = binding.request.profile_id.clone();
                    bindings.push(binding);
                }
            }
        }
        // 已journal会话必须已有完整布局；预检不能补目录或改任何run/cache。
        for session_id in inner.sessions.keys() {
            store::existing_run_layout(&inner.journal.root.join(session_id))?;
        }
        let mut stores = BTreeMap::new();
        for session_id in inner.sessions.keys() {
            let run_store = RunStore::open(inner.journal.root.join(session_id))?;
            execution::validate_store(
                &run_store,
                inner
                    .bindings
                    .get(session_id)
                    .ok_or(DesktopError("corruptJournal"))?,
            )?;
            stores.insert(session_id.clone(), run_store);
        }
        // 所有只读校验通过且所有写锁仍持有后，才追加interrupted恢复事件。
        for (session_id, run_store) in stores {
            inner
                .controllers
                .insert(session_id, RunController::from_store(run_store)?);
        }
        Ok(Self {
            inner: Mutex::new(inner),
        })
    }
    pub fn dispatch(&self, value: Value) -> Result<DesktopReply> {
        let wire_id = value
            .get("id")
            .and_then(Value::as_str)
            .ok_or(DesktopError("invalidEnvelope"))?
            .to_string();
        id(&wire_id)?;
        if serde_json::to_vec(&value)
            .map_err(|_| DesktopError("invalidEnvelope"))?
            .len()
            > MAX_FRAME_BYTES
        {
            return Ok(DesktopReply::new(
                wire_id,
                Err(DesktopError("frameTooLarge")),
            ));
        }
        let request: DesktopRequest = match serde_json::from_value(value) {
            Ok(r) => r,
            Err(_) => {
                return Ok(DesktopReply::new(
                    wire_id,
                    Err(DesktopError("invalidEnvelope")),
                ))
            }
        };
        if request.version != VERSION {
            return Ok(DesktopReply::new(
                wire_id,
                Err(DesktopError("unsupportedVersion")),
            ));
        }
        let result = self
            .inner
            .lock()
            .map_err(|_| DesktopError("runtimeUnavailable"))
            .and_then(|mut inner| inner.route(&request.method, request.params));
        Ok(DesktopReply::new(wire_id, result))
    }
}
impl Inner {
    fn session(&self, id: &str) -> Result<&Session> {
        protocol::id(id)?;
        self.sessions
            .get(id)
            .filter(|s| !s.deleted)
            .ok_or(DesktopError("sessionNotFound"))
    }
    fn route(&mut self, method: &str, params: Value) -> Result<Value> {
        match method {
            "runtime.describe" => {
                let _: Empty = decode(params)?;
                Ok(
                    json!({"version":VERSION,"maxFrameBytes":MAX_FRAME_BYTES,"maxPending":MAX_PENDING,"maxPageBytes":MAX_PAGE_BYTES,"capabilities":["text","sessions","cancel","history"],"efforts":[]}),
                )
            }
            "profiles.list" => {
                let _: Empty = decode(params)?;
                Ok(json!({"profiles":self.profiles.values().collect::<Vec<_>>()}))
            }
            "sessions.list" => {
                let _: Empty = decode(params)?;
                Ok(
                    json!({"sessions":self.sessions.values().filter(|s|!s.deleted).collect::<Vec<_>>()}),
                )
            }
            "sessions.create" => self.create(decode(params)?),
            "sessions.update" => self.update(decode(params)?),
            "sessions.delete" => self.delete(decode(params)?),
            "sessions.history" => self.history(decode(params)?),
            "chat.send" => self.send(decode(params)?),
            "chat.cancel" => self.cancel(decode(params)?),
            "chat.events" => self.events(decode(params)?),
            _ => Err(DesktopError("unknownMethod")),
        }
    }
    fn create(&mut self, p: Create) -> Result<Value> {
        self.create_with_sync(p, store::sync_directory)
    }
    fn create_with_sync(&mut self, p: Create, sync: impl Fn(&Path) -> Result<()>) -> Result<Value> {
        title(&p.title)?;
        id(&p.profile_id)?;
        if let Some(w) = &p.workspace_id {
            id(w)?;
        }
        if !self.profiles.contains_key(&p.profile_id) {
            return Err(DesktopError("profileNotFound"));
        }
        if p.reuse_draft {
            if let Some(s) = self.sessions.values().find(|s| {
                !s.deleted
                    && !s.archived
                    && s.profile_id == p.profile_id
                    && s.workspace_id == p.workspace_id
                    && self.bindings.get(&s.session_id).is_some_and(Vec::is_empty)
            }) {
                return Ok(json!(s));
            }
        }
        if self.sessions.len() >= MAX_SESSIONS {
            return Err(DesktopError("sessionLimit"));
        }
        let session_id = format!("session-{}", self.sessions.len() + 1);
        let path = self.journal.root.join(&session_id);
        store::directory(&path)?;
        let run_store = RunStore::open(&path)?;
        execution::validate_store(&run_store, &[])?;
        // 确认runs-v1目录项及session目录项，失败时不可发布session或启动provider。
        sync(&path.join("runs-v1/context-v2"))?;
        sync(&path.join("runs-v1"))?;
        sync(&path)?;
        sync(&self.journal.root)?;
        let controller = RunController::from_store(run_store)?;
        let now = activity_time(0)?;
        let session = Session {
            session_id: session_id.clone(),
            title: p.title,
            profile_id: p.profile_id,
            workspace_id: p.workspace_id,
            pinned: false,
            archived: false,
            created_at: now,
            updated_at: now,
            deleted: false,
        };
        self.journal.append(Entry::Session {
            session: session.clone(),
        })?;
        self.sessions.insert(session_id.clone(), session.clone());
        self.bindings.insert(session_id.clone(), Vec::new());
        self.controllers.insert(session_id, controller);
        Ok(json!(session))
    }
    fn update(&mut self, p: Update) -> Result<Value> {
        let mut session = self.session(&p.session_id)?.clone();
        if let Some(t) = p.title {
            title(&t)?;
            session.title = t;
        }
        if let Some(v) = p.pinned {
            session.pinned = v;
        }
        if let Some(v) = p.archived {
            session.archived = v;
        }
        session.updated_at = activity_time(session.updated_at)?;
        self.journal.append(Entry::Session {
            session: session.clone(),
        })?;
        self.sessions.insert(p.session_id, session.clone());
        Ok(json!(session))
    }
    fn delete(&mut self, p: SessionId) -> Result<Value> {
        let mut session = self.session(&p.session_id)?.clone();
        session.deleted = true;
        session.updated_at = activity_time(session.updated_at)?;
        self.journal.append(Entry::Session {
            session: session.clone(),
        })?;
        self.sessions.insert(p.session_id.clone(), session);
        // tombstone先落盘，控制器和写锁保留到服务结束；不会删除活跃run文件。
        if let Some(bindings) = self.bindings.get(&p.session_id) {
            for b in bindings {
                if let Some(c) = self.controllers.get(&p.session_id) {
                    match c.cancel(&b.request.request_id) {
                        Ok(_) | Err(crate::run_types::RunError::RunNotFound) => {}
                        Err(e) => return Err(e.into()),
                    }
                }
            }
        }
        Ok(json!({"deleted":true}))
    }
}

// updatedAt记录最后用户变更的宿主提交时间；模型delta/terminal不改变Recent排序。
fn activity_time(previous: u64) -> Result<u64> {
    let now: u64 = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| DesktopError("invalidTime"))?
        .as_millis()
        .try_into()
        .map_err(|_| DesktopError("invalidTime"))?;
    let next = now.max(previous.checked_add(1).ok_or(DesktopError("invalidTime"))?);
    if next > MAX_SAFE_INTEGER {
        return Err(DesktopError("invalidTime"));
    }
    Ok(next)
}

impl Drop for Inner {
    fn drop(&mut self) {
        // 先取消并回收所有worker，再释放journal单写锁。
        self.controllers.clear();
    }
}

#[cfg(test)]
mod tests;
