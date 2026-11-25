//! 渠道、偏好和回执共用一个原子快照；凭据只经锁外暂存边界。
use super::*;
use crate::credentialed_channels::{
    catalog::{random_reference, Catalog, ChannelWrite, CredentialChange, EndpointPolicy},
    vault::{CredentialVault, Secret, VaultScope},
};
use std::time::{Duration, Instant};
mod state;
struct Stage {
    request: PlatformRequest,
    generation: String,
    expires: Instant,
    ready: bool,
}
struct ManagedInner {
    project_epoch: u64,
    store: store::Store,
    state: Persisted,
    environment: HostEnvironment,
    stages: BTreeMap<String, Stage>,
    frozen: bool,
}
pub struct CredentialedPlatform {
    pub(crate) known: crate::credentialed_channels::worker::Known,
    root: TrustedRoot,
    inner: Mutex<ManagedInner>,
    stage_io: Mutex<()>,
    policy: EndpointPolicy,
    scope: VaultScope,
}
pub struct PreparedMutation {
    project_epoch: u64,
    next: Persisted,
    request: PlatformRequest,
    base_revision: u64,
    replay: bool,
}
impl PreparedMutation {
    pub fn is_replay(&self) -> bool {
        self.replay
    }
    pub fn catalog(&self) -> &Catalog {
        self.next.credential_catalog.as_ref().expect("已验证目录")
    }
}
impl CredentialedPlatform {
    pub fn open(
        root: &TrustedRoot,
        policy: EndpointPolicy,
        environment: HostEnvironment,
    ) -> Result<Self> {
        root.validate_channels()?;
        let mut store = store::Store::open(root)?;
        let state = if let Some(bytes) = store.bytes() {
            let value: Value =
                serde_json::from_slice(bytes).map_err(|_| DesktopError("corruptSnapshot"))?;
            if value.get("version").and_then(Value::as_u64) != Some(VERSION as u64) {
                return Err(DesktopError("unsupportedVersion"));
            }
            serde_json::from_value(value).map_err(|_| DesktopError("corruptSnapshot"))?
        } else {
            let mut state = Persisted::initial(&[]);
            state.user_profile.user_name = "Local".into();
            state.workspaces[0].effort.clear();
            state.credential_catalog = Some(Catalog::empty(random_reference()?)?);
            state
        };
        state::validate(&state, &policy)?;
        // 未完成候选也要完整验证；不能删除未知未来格式或据此删除vault条目。
        store.validate_pending(|bytes| {
            let pending: Persisted =
                serde_json::from_slice(bytes).map_err(|_| DesktopError("corruptSnapshot"))?;
            state::validate(&pending, &policy)?;
            if pending
                .credential_catalog
                .as_ref()
                .map(|c| &c.store_namespace)
                != state
                    .credential_catalog
                    .as_ref()
                    .map(|c| &c.store_namespace)
            {
                return Err(DesktopError("corruptCatalog"));
            }
            Ok(())
        })?;
        store.recover_pending()?;
        if store.bytes().is_none() {
            store.write(serde_json::to_vec(&state).map_err(|_| DesktopError("storeIo"))?)?;
        }
        let scope = VaultScope::new(
            state
                .credential_catalog
                .as_ref()
                .ok_or(DesktopError("corruptCatalog"))?
                .store_namespace
                .clone(),
        )?;
        Ok(Self {
            root: root.clone(),
            known: Default::default(),
            inner: Mutex::new(ManagedInner {
                project_epoch: 0,
                store,
                state,
                environment,
                stages: BTreeMap::new(),
                frozen: false,
            }),
            stage_io: Mutex::new(()),
            policy,
            scope,
        })
    }
    pub(crate) fn require_workspace(&self, key: workspace::WorkspaceKey<'_>) -> Result<()> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| DesktopError("recoveryRequired"))?;
        inner
            .state
            .workspaces
            .iter()
            .any(|r| key.matches(&r.workspace))
            .then_some(())
            .ok_or(DesktopError("workspaceNotFound"))
    }
    pub fn catalog(&self) -> Result<Catalog> {
        self.inner
            .lock()
            .map_err(|_| DesktopError("recoveryRequired"))?
            .state
            .credential_catalog
            .clone()
            .ok_or(DesktopError("corruptCatalog"))
    }
    pub(crate) fn image_catalog(&self) -> Result<Catalog> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| DesktopError("recoveryRequired"))?;
        if inner.frozen {
            return Err(DesktopError("recoveryRequired"));
        }
        inner
            .state
            .credential_catalog
            .clone()
            .ok_or(DesktopError("corruptCatalog"))
    }
    pub fn vault_scope(&self) -> VaultScope {
        self.scope.clone()
    }
    pub fn bootstrap(&self) -> Result<PlatformSnapshot> {
        let i = self
            .inner
            .lock()
            .map_err(|_| DesktopError("recoveryRequired"))?;
        Ok(i.state.snapshot(&i.environment))
    }
    pub fn channels(&self) -> Result<Value> {
        Ok(self.catalog()?.public_list())
    }
    pub fn freeze(&self) {
        if let Ok(mut i) = self.inner.lock() {
            i.frozen = true;
        }
    }
    /// 只允许显式保存；调用者必须在actor之外执行vault I/O。测试连接不得使用此API。
    pub fn stage(
        &self,
        request: PlatformRequest,
        generation: &str,
        secret: &Secret,
        vault: &dyn CredentialVault,
    ) -> Result<PlatformRequest> {
        self.stage_cancellable(
            request,
            generation,
            secret,
            vault,
            &std::sync::atomic::AtomicBool::new(false),
        )
    }
    pub(crate) fn stage_cancellable(
        &self,
        mut request: PlatformRequest,
        generation: &str,
        secret: &Secret,
        vault: &dyn CredentialVault,
        cancelled: &std::sync::atomic::AtomicBool,
    ) -> Result<PlatformRequest> {
        if cancelled.load(std::sync::atomic::Ordering::Acquire) {
            return Err(DesktopError("staleGeneration"));
        }
        identifier(generation)?;
        if !matches!(
            request.channel.as_str(),
            "channel:create" | "channel:update"
        ) || request.args.len() != 1
        {
            return Err(DesktopError("invalidParams"));
        }
        let mut write: ChannelWrite = decode(request.args[0].clone())?;
        write.channel = write.channel.normalize(&self.policy)?;
        let reference = random_reference()?;
        write.credential = CredentialChange::Replace(reference.clone());
        request.args[0] = encoded(&write)?;
        state::validate_request(&request)?;
        {
            let mut i = self
                .inner
                .lock()
                .map_err(|_| DesktopError("recoveryRequired"))?;
            if i.frozen {
                return Err(DesktopError("recoveryRequired"));
            }
            let m = request
                .mutation
                .as_ref()
                .ok_or(DesktopError("invalidParams"))?;
            if m.expected_revision != i.state.revision {
                return Err(DesktopError("revisionConflict"));
            }
            let now = Instant::now();
            i.stages.retain(|_, s| s.expires > now);
            if i.stages.len() >= 16 {
                return Err(DesktopError("stageLimit"));
            }
            if i.state.receipts.contains_key(&m.mutation_id)
                || i.stages.values().any(|s| {
                    s.request
                        .mutation
                        .as_ref()
                        .is_some_and(|old| old.mutation_id == m.mutation_id)
                })
            {
                return Err(DesktopError("stageConflict"));
            }
            let next = self.next_state(&i.state, &request)?;
            let public = serde_json::to_value(&(request.clone(), next))
                .map_err(|_| DesktopError("invalidParams"))?;
            if secret.with_bytes(|key| contains_secret(&public, key)) {
                return Err(DesktopError("invalidParams"));
            }
            i.stages.insert(
                reference.clone(),
                Stage {
                    request: request.clone(),
                    generation: generation.into(),
                    expires: now + Duration::from_secs(120),
                    ready: false,
                },
            );
        }
        // immutable put成功后才允许提交引用；失败保留stage且不自动删除可能已写入的条目。
        let _io = self
            .stage_io
            .lock()
            .map_err(|_| DesktopError("vaultUnavailable"))?;
        if vault.owned_references(&self.scope)?.len() >= 144 {
            return Err(DesktopError("storageLimit"));
        }
        let binding = crate::credentialed_channels::vault::CredentialBinding::new(
            &self.scope,
            &write.channel,
        );
        vault.put_bound_cancellable(&self.scope, &reference, &binding, secret, cancelled)?;
        let mut i = self
            .inner
            .lock()
            .map_err(|_| DesktopError("recoveryRequired"))?;
        if i.frozen {
            return Err(DesktopError("recoveryRequired"));
        }
        let stage = i
            .stages
            .get_mut(&reference)
            .ok_or(DesktopError("stageExpired"))?;
        if stage.expires <= Instant::now() {
            return Err(DesktopError("stageExpired"));
        }
        stage.ready = true;
        Ok(request)
    }
    pub fn prepare(
        &self,
        mut request: PlatformRequest,
        generation: &str,
    ) -> Result<PreparedMutation> {
        identifier(generation)?;
        state::validate_request(&request)?;
        if matches!(
            request.channel.as_str(),
            "channel:create" | "channel:update"
        ) {
            let mut write: ChannelWrite = decode(request.args[0].clone())?;
            write.channel = write.channel.normalize(&self.policy)?;
            request.args[0] = encoded(&write)?;
        }
        let i = self
            .inner
            .lock()
            .map_err(|_| DesktopError("recoveryRequired"))?;
        if i.frozen {
            return Err(DesktopError("recoveryRequired"));
        }
        let mutation = request
            .mutation
            .as_ref()
            .ok_or(DesktopError("invalidParams"))?;
        if let Some(receipt) = i.state.receipts.get(&mutation.mutation_id) {
            if !receipt.matches(&request)? {
                return Err(DesktopError("mutationConflict"));
            }
            return Ok(PreparedMutation {
                next: i.state.clone(),
                request,
                base_revision: i.state.revision,
                project_epoch: i.project_epoch,
                replay: true,
            });
        }
        if mutation.expected_revision != i.state.revision {
            return Err(DesktopError("revisionConflict"));
        }
        if i.state.receipts.len() >= MAX_RECEIPTS {
            return Err(DesktopError("storageLimit"));
        }
        if matches!(
            request.channel.as_str(),
            "channel:create" | "channel:update"
        ) {
            let write: ChannelWrite = decode(request.args[0].clone())?;
            if let CredentialChange::Replace(reference) = write.credential {
                let stage = i
                    .stages
                    .get(&reference)
                    .ok_or(DesktopError("stageMissing"))?;
                if !stage.ready || stage.generation != generation || stage.request != request {
                    return Err(DesktopError("stageMismatch"));
                }
                if stage.expires <= Instant::now() {
                    return Err(DesktopError("stageExpired"));
                }
            }
        }
        let next = self.next_state(&i.state, &request)?;
        Ok(PreparedMutation {
            next,
            request,
            base_revision: i.state.revision,
            project_epoch: i.project_epoch,
            replay: false,
        })
    }
    fn next_state(&self, current: &Persisted, request: &PlatformRequest) -> Result<Persisted> {
        if current.receipts.len() >= MAX_RECEIPTS {
            return Err(DesktopError("storageLimit"));
        }
        let mutation = request
            .mutation
            .as_ref()
            .ok_or(DesktopError("invalidParams"))?;
        let mut next = current.clone();
        state::apply(&mut next, request, &self.policy)?;
        next.revision += 1;
        for receipt in next.receipts.values_mut() {
            receipt.compact()?;
        }
        next.receipts.insert(
            mutation.mutation_id.clone(),
            Receipt::new(request.clone(), next.revision)?,
        );
        state::validate(&next, &self.policy)?;
        store::snapshot_budget(&serde_json::to_vec(&next).map_err(|_| DesktopError("storeIo"))?)?;
        Ok(next)
    }
    pub fn set_host_environment(&self, environment: HostEnvironment) -> Result<PlatformSnapshot> {
        let mut i = self
            .inner
            .lock()
            .map_err(|_| DesktopError("recoveryRequired"))?;
        i.environment = environment;
        Ok(i.state.snapshot(&i.environment))
    }
    /// install必须消费prepare后已完成校验的运行时状态；异常后本实例永久冻结。
    pub fn commit(
        &self,
        prepared: PreparedMutation,
        install: impl FnOnce(&Catalog) -> Result<()>,
    ) -> Result<PlatformReply> {
        let mut i = self
            .inner
            .lock()
            .map_err(|_| DesktopError("recoveryRequired"))?;
        if i.frozen {
            return Err(DesktopError("recoveryRequired"));
        }
        if prepared.catalog().store_namespace != self.scope.namespace() {
            return Err(DesktopError("stageMismatch"));
        }
        if i.state.revision != prepared.base_revision || i.project_epoch != prepared.project_epoch {
            return Err(DesktopError("revisionConflict"));
        }
        if !prepared.replay {
            if matches!(
                prepared.request.channel.as_str(),
                "channel:create" | "channel:update"
            ) {
                let write: ChannelWrite = decode(prepared.request.args[0].clone())?;
                if let CredentialChange::Replace(reference) = write.credential {
                    let stage = i
                        .stages
                        .get(&reference)
                        .ok_or(DesktopError("stageMissing"))?;
                    if !stage.ready || stage.request != prepared.request {
                        return Err(DesktopError("stageMismatch"));
                    }
                    if stage.expires <= Instant::now() {
                        return Err(DesktopError("stageExpired"));
                    }
                }
            }
            let bytes = serde_json::to_vec(&prepared.next).map_err(|_| DesktopError("storeIo"))?;
            if let Err(e) = i.store.write(bytes) {
                i.frozen = true;
                return Err(e);
            }
            i.state = prepared.next;
            if let Err(e) = install(
                i.state
                    .credential_catalog
                    .as_ref()
                    .ok_or(DesktopError("corruptCatalog"))?,
            ) {
                i.frozen = true;
                return Err(e);
            }
            if let Some(m) = &prepared.request.mutation {
                i.stages.retain(|_, s| {
                    s.request
                        .mutation
                        .as_ref()
                        .is_none_or(|other| other.mutation_id != m.mutation_id)
                });
            }
        }
        state::reply(&i.state, &i.environment, &prepared.request)
    }
    pub fn read(&self, request: PlatformRequest) -> Result<PlatformReply> {
        if request.mutation.is_some() {
            return Err(DesktopError("invalidParams"));
        }
        if request.channel == "channel:decrypt-key" {
            return Err(DesktopError("unsupported"));
        }
        super::validate_request(&request)?;
        let i = self
            .inner
            .lock()
            .map_err(|_| DesktopError("recoveryRequired"))?;
        state::reply(&i.state, &i.environment, &request)
    }
}
#[cfg(test)]
mod tests;

fn contains_secret(value: &Value, key: &[u8]) -> bool {
    let contains = |s: &str| s.as_bytes().windows(key.len()).any(|w| w == key);
    match value {
        Value::String(s) => contains(s),
        Value::Array(a) => a.iter().any(|v| contains_secret(v, key)),
        Value::Object(o) => o
            .iter()
            .any(|(k, v)| contains(k) || contains_secret(v, key)),
        _ => false,
    }
}

impl project_catalog::ProjectCatalog for CredentialedPlatform {
    fn check_project_text(&self, text: &str) -> Result<()> {
        crate::credentialed_channels::worker::guard(&json!(text), &self.known)
    }
    fn edit_projects_mode<T>(
        &self,
        publish: bool,
        edit: impl FnOnce(&mut Vec<WorkspaceRecord>, &std::path::Path) -> Result<T>,
    ) -> Result<T> {
        let mut i = self
            .inner
            .lock()
            .map_err(|_| DesktopError("recoveryRequired"))?;
        if i.frozen {
            return Err(DesktopError("recoveryRequired"));
        }
        let mut next = i.state.clone();
        let result = edit(&mut next.workspaces, self.root.path())?;
        // A newly imported/native project starts with the selected model’s supported
        // effort. Existing project preferences are preserved through reimports.
        for record in next.workspaces.iter_mut().skip(i.state.workspaces.len()) {
            record.effort = next.settings.agent_effort.clone();
        }
        if next.workspaces != i.state.workspaces {
            project_catalog::validate_catalog(&next.workspaces, true)?;
            let data = serde_json::to_vec(&next).map_err(|_| DesktopError("storeIo"))?;
            store::snapshot_budget(&data)?;
            if !publish {
                return Ok(result);
            }
            if let Err(e) = i.store.write(data) {
                i.frozen = true;
                return Err(e);
            }
            i.state = next;
            i.project_epoch += 1;
        }
        Ok(result)
    }
}
