//! 正式会话服务；stdio与Tauri共同调用，秘密仅由可信宿主注入。
pub mod availability;
mod execution;
pub(crate) mod profile;
pub mod protocol;
mod queue;
mod queue_replay;
mod queue_types;
pub mod revisions;
mod session;
mod store;
mod tools;
use crate::{run_controller::RunController, run_store::RunStore};
use profile::Profile;
pub use profile::{Model, TrustedProfile};
use protocol::*;
pub use protocol::{DesktopError, DesktopReply, DesktopRequest};
use serde_json::{json, Value};
use session::{Binding, Entry};
pub use session::{Session, Turn};
use std::{
    collections::BTreeMap,
    path::Path,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use store::Journal;
pub use tools::TrustedToolBinding;
/// 空目录草稿身份；永不出现在配置目录或授权执行。
pub const UNCONFIGURED_PROFILE_ID: &str = "unconfigured";
pub struct DesktopRuntime {
    inner: Mutex<Inner>,
}
struct Inner {
    journal: Journal,
    availability: Option<availability::Availability>,
    availability_policy_invalid: bool,
    availability_recovery_required: bool,
    queue_enabled: bool,
    queue_blocked: bool,
    chains: BTreeMap<String, queue_types::Chain>,
    redirects: BTreeMap<String, BTreeMap<String, crate::run_context::ParentRunRef>>,
    profiles: BTreeMap<String, Profile>,
    managed: bool,
    revisions: BTreeMap<(String, String), Profile>,
    tools: BTreeMap<String, TrustedToolBinding>,
    sessions: BTreeMap<String, Session>,
    bindings: BTreeMap<String, Vec<Binding>>,
    controllers: BTreeMap<String, RunController>,
}
impl DesktopRuntime {
    pub fn open_managed(root: impl AsRef<Path>) -> Result<Self> {
        Self::open_managed_with_profiles(
            root,
            revisions::PreparedProfiles::new(vec![], BTreeMap::new(), BTreeMap::new())?,
        )
    }
    pub fn open_managed_with_profiles(
        root: impl AsRef<Path>,
        prepared: revisions::PreparedProfiles,
    ) -> Result<Self> {
        Self::open_registry(root, BTreeMap::new(), vec![], true, Some(prepared))
    }
    /// root须由可信宿主在稳定父目录下durable创建，使用既有绝对路径且无symlink祖先。
    /// 服务只创建自身namespace，启动时再次确认root及直接parent，不创建调用方祖先。
    pub fn open(root: impl AsRef<Path>, profiles: Vec<TrustedProfile>) -> Result<Self> {
        Self::open_with_tools(root, profiles, vec![])
    }
    pub fn open_with_tools(
        root: impl AsRef<Path>,
        profiles: Vec<TrustedProfile>,
        bindings: Vec<TrustedToolBinding>,
    ) -> Result<Self> {
        Self::open_internal(root, profiles, bindings, false)
    }
    pub fn open_with_queueing(
        root: impl AsRef<Path>,
        profiles: Vec<TrustedProfile>,
        tool_bindings: Vec<TrustedToolBinding>,
    ) -> Result<Self> {
        Self::open_internal(root, profiles, tool_bindings, true)
    }
    fn open_internal(
        root: impl AsRef<Path>,
        profiles: Vec<TrustedProfile>,
        bindings: Vec<TrustedToolBinding>,
        queue_enabled: bool,
    ) -> Result<Self> {
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
        Self::open_registry(root, registry, bindings, queue_enabled, None)
    }
    fn open_registry(
        root: impl AsRef<Path>,
        mut registry: BTreeMap<String, Profile>,
        bindings: Vec<TrustedToolBinding>,
        queue_enabled: bool,
        prepared: Option<revisions::PreparedProfiles>,
    ) -> Result<Self> {
        let managed = prepared.is_some();
        let tools = tools::validate_bindings(&mut registry, bindings)?;
        if serde_json::to_vec(&registry.values().collect::<Vec<_>>())
            .map_err(|_| DesktopError("invalidProfile"))?
            .len()
            > MAX_PAGE_BYTES
        {
            return Err(DesktopError("invalidProfile"));
        }
        let (journal, records) = if queue_enabled {
            Journal::open_queue(root.as_ref(), true)?
        } else {
            Journal::open(root.as_ref())?
        };
        let mut inner = Inner {
            journal,
            availability: None,
            availability_policy_invalid: false,
            availability_recovery_required: false,
            queue_enabled,
            queue_blocked: false,
            chains: BTreeMap::new(),
            redirects: BTreeMap::new(),
            profiles: registry,
            managed,
            revisions: BTreeMap::new(),
            tools,
            sessions: BTreeMap::new(),
            bindings: BTreeMap::new(),
            controllers: BTreeMap::new(),
        };
        if let Some(prepared) = prepared {
            inner.profiles = prepared
                .current
                .iter()
                .map(|(id, revision)| {
                    let profile = prepared
                        .revisions
                        .get(&(id.clone(), revision.clone()))
                        .ok_or(DesktopError("invalidProfile"))?
                        .clone();
                    Ok((id.clone(), profile))
                })
                .collect::<Result<BTreeMap<_, _>>>()?;
            inner.revisions = prepared.revisions;
            inner.availability = Some(prepared.enabled);
        }
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
                    // 队列必须先关闭再删除；在任何控制器恢复写入之前拒绝不可能的 tombstone。
                    if session.deleted
                        && inner.chains.values().any(|chain| {
                            chain.session_id == session.session_id && chain.closure.is_none()
                        })
                    {
                        return Err(DesktopError("corruptJournal"));
                    }
                    inner
                        .bindings
                        .entry(session.session_id.clone())
                        .or_default();
                    inner.sessions.insert(session.session_id.clone(), session);
                }
                Entry::Bind { binding } => {
                    inner.apply_plain_binding(binding)?;
                }
                Entry::Queue { transition } => {
                    inner
                        .apply_queue(transition)
                        .map_err(|_| DesktopError("corruptJournal"))?;
                }
            }
        }
        // 已journal会话必须已有完整布局；预检不能补目录或改任何run/cache。
        for session_id in inner.sessions.keys() {
            store::existing_run_layout(&inner.journal.root.join(session_id))?;
        }
        let mut stores = BTreeMap::new();
        for session_id in inner.sessions.keys() {
            let mut run_store = RunStore::open(inner.journal.root.join(session_id))?;
            if let Some(proofs) = inner.redirects.get(session_id) {
                run_store.redirects = proofs.clone();
            }
            run_store.validate_redirects()?;
            inner.validate_queue_store(session_id, &run_store)?;
            execution::validate_store(
                &run_store,
                inner
                    .bindings
                    .get(session_id)
                    .ok_or(DesktopError("corruptJournal"))?,
                !inner.tools.is_empty(),
            )?;
            stores.insert(session_id.clone(), run_store);
        }
        // 所有只读校验通过且所有写锁仍持有后，才追加interrupted恢复事件。
        for (session_id, run_store) in stores {
            inner.controllers.insert(
                session_id,
                if inner.tools.is_empty() {
                    RunController::from_store(run_store)?
                } else {
                    RunController::from_store_with_tools(run_store)?
                },
            );
        }
        inner.recover_queues()?;
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
                let efforts: Vec<_> = ["low", "medium", "high", "max"]
                    .into_iter()
                    .filter(|effort| {
                        self.profiles.values().any(|p| {
                            p.models
                                .iter()
                                .any(|m| m.supported_efforts.iter().any(|e| e == effort))
                        })
                    })
                    .collect();
                Ok(
                    json!({"version":VERSION,"maxFrameBytes":MAX_FRAME_BYTES,"maxPending":MAX_PENDING,"maxPageBytes":MAX_PAGE_BYTES,"capabilities":["text","sessions","cancel","history"],"efforts":efforts}),
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
            "sessions.history" => self.history(decode(params)?, false),
            "sessions.historyV2" => self.history(decode(params)?, true),
            "chat.eventsV2" => self.events_v2(decode(params)?),
            "chat.pendingPermissions" => self.pending_permissions(decode(params)?),
            "chat.permissionRespond" => self.respond_permission(decode(params)?),
            "chat.beginChain" if self.queue_enabled => self.begin_chain(decode(params)?),
            "chat.queue" if self.queue_enabled => self.queue_input(decode(params)?),
            "chat.listChains" if self.queue_enabled => self.list_chains(decode(params)?),
            "chat.queueState" if self.queue_enabled => self.queue_state(decode(params)?),
            "chat.advanceQueue" if self.queue_enabled => self.advance_queue(decode(params)?),
            "chat.stopChain" if self.queue_enabled => self.stop_chain(decode(params)?),
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
        let unconfigured_draft =
            self.managed && self.profiles.is_empty() && p.profile_id == UNCONFIGURED_PROFILE_ID;
        if !(self.profiles.contains_key(&p.profile_id) || unconfigured_draft) {
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
        execution::validate_store(&run_store, &[], !self.tools.is_empty())?;
        // 确认runs-v1目录项及session目录项，失败时不可发布session或启动provider。
        sync(&path.join("runs-v1/context-v2"))?;
        sync(&path.join("runs-v1"))?;
        sync(&path)?;
        sync(&self.journal.root)?;
        let controller = if self.tools.is_empty() {
            RunController::from_store(run_store)?
        } else {
            RunController::from_store_with_tools(run_store)?
        };
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
        let chains: Vec<_> = self
            .chains
            .values()
            .filter(|c| c.session_id == p.session_id && c.closure.is_none())
            .cloned()
            .collect();
        for c in chains {
            self.stop_chain(queue_types::StopChain {
                session_id: p.session_id.clone(),
                chain_id: c.chain_id,
                reason: queue_types::StopReason::Delete,
            })?;
        }
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
                    match self.cancel_run(c, &b.request.request_id) {
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
