//! 正式预览的原生平台事实源；与DesktopRuntime共用已标记根，独立持久化命名空间。
pub mod close;
mod launch;
pub mod protocol;
pub mod settings;
mod spotlight;
mod store;
pub mod workspace;
use crate::desktop_runtime::{
    protocol::{DesktopError, Result},
    TrustedProfile,
};
pub use launch::{
    local_mock_profiles, TrustedRoot, APPLICATION_ID, MOCK_CONFIG_REVISION, MOCK_KEY,
    MOCK_PROFILE_ID, SYNTHETIC_PROFILE, SYNTHETIC_TOOLS, TOOLS_APPLICATION_ID,
};
use launch::{public_profiles, PublicProfile};
use protocol::*;
pub use protocol::{HostEnvironment, PlatformReply, PlatformRequest, PlatformSnapshot};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeMap, sync::Mutex};
use workspace::WorkspaceRecord;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Receipt {
    request: PlatformRequest,
    revision: u64,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Persisted {
    version: u32,
    revision: u64,
    settings: settings::Settings,
    user_profile: UserProfile,
    workspaces: Vec<WorkspaceRecord>,
    receipts: BTreeMap<String, Receipt>,
}
struct Inner {
    store: store::Store,
    state: Persisted,
    environment: HostEnvironment,
}
pub struct FormalPlatform {
    inner: Mutex<Inner>,
    profiles: Vec<PublicProfile>,
}
// 与preload常量逐字一致；未来能力不能通过前缀匹配被误放行。
fn mutating(channel: &str) -> Result<bool> {
    match channel {
        "settings:get"
        | "user-profile:get"
        | "theme:resolve"
        | "window:chrome-state"
        | "agent:list-workspaces"
        | "agent:get-reasoning-effort"
        | "agent:get-permission-mode"
        | "agent:get-workspace-directories"
        | "onboarding-spotlight:get"
        | "onboarding-spotlight:bootstrap"
        | "concept-spotlight:get-state"
        | "telemetry:get-consent-state"
        | "telemetry:real-send-allowed"
        | "runtime:get-status" => Ok(false),
        "settings:update"
        | "settings:update-sync"
        | "user-profile:update"
        | "agent:set-reasoning-effort"
        | "onboarding-spotlight:start"
        | "onboarding-spotlight:advance"
        | "onboarding-spotlight:skip-sub-stage"
        | "onboarding-spotlight:complete"
        | "onboarding-spotlight:skip"
        | "onboarding-spotlight:restart"
        | "concept-spotlight:start"
        | "concept-spotlight:advance"
        | "concept-spotlight:skip"
        | "concept-spotlight:complete"
        | "concept-spotlight:restart" => Ok(true),
        _ => Err(DesktopError("unsupported")),
    }
}
fn validate_request(request: &PlatformRequest) -> Result<bool> {
    if request.version != VERSION {
        return Err(DesktopError("unsupportedVersion"));
    }
    if serde_json::to_vec(request)
        .map_err(|_| DesktopError("invalidParams"))?
        .len()
        > MAX_REQUEST_BYTES
    {
        return Err(DesktopError("storageLimit"));
    }
    let write = mutating(&request.channel)?;
    if write != request.mutation.is_some() {
        return Err(DesktopError("invalidParams"));
    }
    if let Some(m) = &request.mutation {
        identifier(&m.mutation_id)?;
        if m.expected_revision >= MAX_SAFE_INTEGER {
            return Err(DesktopError("invalidParams"));
        }
    }
    Ok(write)
}
impl FormalPlatform {
    pub fn open(
        root: &TrustedRoot,
        profiles: &[TrustedProfile],
        environment: HostEnvironment,
    ) -> Result<Self> {
        let profiles = public_profiles(profiles)?;
        let mut store = store::Store::open(root)?;
        let state = if let Some(bytes) = store.bytes() {
            let value: Value =
                serde_json::from_slice(bytes).map_err(|_| DesktopError("corruptSnapshot"))?;
            if value.get("version").and_then(Value::as_u64) != Some(VERSION as u64) {
                return Err(DesktopError("unsupportedVersion"));
            }
            serde_json::from_value(value).map_err(|_| DesktopError("corruptSnapshot"))?
        } else {
            Persisted::initial(&profiles)
        };
        state.validate(&profiles)?;
        store.recover_pending()?;
        if store.bytes().is_none() {
            store.write(serde_json::to_vec(&state).map_err(|_| DesktopError("storeIo"))?)?;
        }
        Ok(Self {
            inner: Mutex::new(Inner {
                store,
                state,
                environment,
            }),
            profiles,
        })
    }
    pub fn bootstrap(&self) -> Result<PlatformSnapshot> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| DesktopError("recoveryRequired"))?;
        Ok(inner.state.snapshot(&inner.environment))
    }
    /// 只能由可信宿主在原生主题/全屏事件后调用；不增加持久化revision。
    pub fn set_host_environment(&self, environment: HostEnvironment) -> Result<PlatformSnapshot> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| DesktopError("recoveryRequired"))?;
        inner.environment = environment;
        Ok(inner.state.snapshot(&inner.environment))
    }
    pub fn invoke(&self, request: PlatformRequest) -> Result<PlatformReply> {
        let write = validate_request(&request)?;
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| DesktopError("recoveryRequired"))?;
        if write {
            let mutation = request
                .mutation
                .as_ref()
                .ok_or(DesktopError("invalidParams"))?;
            if let Some(receipt) = inner.state.receipts.get(&mutation.mutation_id) {
                if receipt.request != request {
                    return Err(DesktopError("mutationConflict"));
                }
                // 幂等重试返回当前revision和当前事实，不能让客户端cache倒退。
            } else {
                if mutation.expected_revision != inner.state.revision {
                    return Err(DesktopError("revisionConflict"));
                }
                if inner.state.receipts.len() >= MAX_RECEIPTS {
                    return Err(DesktopError("storageLimit"));
                }
                let mut next = inner.state.clone();
                next.apply(&request, &self.profiles)?;
                next.revision += 1;
                next.receipts.insert(
                    mutation.mutation_id.clone(),
                    Receipt {
                        request: request.clone(),
                        revision: next.revision,
                    },
                );
                let bytes = serde_json::to_vec(&next).map_err(|_| DesktopError("storeIo"))?;
                inner.store.write(bytes)?;
                inner.state = next;
            }
        }
        let snapshot = inner.state.snapshot(&inner.environment);
        let value = inner.state.value(&request, &snapshot)?;
        Ok(PlatformReply {
            version: VERSION,
            revision: inner.state.revision,
            value,
            snapshot: write.then_some(snapshot),
        })
    }
}
impl Persisted {
    fn initial(profiles: &[PublicProfile]) -> Self {
        Self {
            version: VERSION,
            revision: 0,
            settings: settings::Settings::initial(profiles),
            user_profile: UserProfile {
                user_name: "Local Mock".into(),
                avatar: "icon:user".into(),
            },
            workspaces: vec![WorkspaceRecord::initial()],
            receipts: BTreeMap::new(),
        }
    }
    fn validate(&self, profiles: &[PublicProfile]) -> Result<()> {
        if self.version != VERSION
            || self.revision > MAX_SAFE_INTEGER
            || self.workspaces.len() != 1
            || self.receipts.len() > MAX_RECEIPTS
            || self.revision != self.receipts.len() as u64
        {
            return Err(DesktopError("corruptSnapshot"));
        }
        self.settings
            .validate(profiles)
            .map_err(|_| DesktopError("corruptSnapshot"))?;
        validate_user(&self.user_profile).map_err(|_| DesktopError("corruptSnapshot"))?;
        self.workspaces[0].validate()?;
        let mut revisions = std::collections::HashSet::new();
        for (id, r) in &self.receipts {
            if !validate_request(&r.request).map_err(|_| DesktopError("corruptSnapshot"))?
                || r.request
                    .mutation
                    .as_ref()
                    .is_none_or(|m| &m.mutation_id != id || m.expected_revision + 1 != r.revision)
                || r.revision == 0
                || r.revision > self.revision
                || !revisions.insert(r.revision)
            {
                return Err(DesktopError("corruptSnapshot"));
            }
        }
        // 顺序验证历史参数，避免用当前model绑定误判早期合法patch。
        let mut ordered: Vec<_> = self.receipts.values().collect();
        ordered.sort_by_key(|r| r.revision);
        let mut replay = Self::initial(profiles);
        for receipt in ordered {
            replay
                .apply(&receipt.request, profiles)
                .map_err(|_| DesktopError("corruptSnapshot"))?;
        }
        Ok(())
    }
    fn snapshot(&self, env: &HostEnvironment) -> PlatformSnapshot {
        PlatformSnapshot {
            version: VERSION,
            revision: self.revision,
            settings: self.settings.clone(),
            user_profile: self.user_profile.clone(),
            workspaces: self
                .workspaces
                .iter()
                .map(|w| w.workspace.clone())
                .collect(),
            theme: ResolvedTheme {
                mode: self.settings.theme.clone(),
                is_dark: match self.settings.theme.as_str() {
                    "dark" => true,
                    "light" => false,
                    _ => env.system_dark,
                },
            },
            chrome: env.chrome.clone(),
        }
    }
    fn workspace(&self, args: &[Value], length: usize) -> Result<&WorkspaceRecord> {
        if args.len() != length {
            return Err(DesktopError("invalidParams"));
        }
        let slug = args[0].as_str().ok_or(DesktopError("invalidParams"))?;
        identifier(slug)?;
        self.workspaces
            .iter()
            .find(|w| w.workspace.slug == slug)
            .ok_or(DesktopError("workspaceNotFound"))
    }
    fn apply(&mut self, r: &PlatformRequest, profiles: &[PublicProfile]) -> Result<()> {
        match r.channel.as_str() {
            "settings:update" | "settings:update-sync" => {
                if r.args.len() != 1
                    || r.args[0].get("onboardingSpotlight").is_some()
                    || r.args[0].get("conceptSpotlight").is_some()
                {
                    return Err(DesktopError("invalidParams"));
                }
                let settings: settings::Settings = patch(&self.settings, &r.args[0])?;
                settings.validate(profiles)?;
                self.settings = settings;
            }
            "user-profile:update" => {
                if r.args.len() != 1 {
                    return Err(DesktopError("invalidParams"));
                }
                let profile = patch(&self.user_profile, &r.args[0])?;
                validate_user(&profile)?;
                self.user_profile = profile;
            }
            "agent:set-reasoning-effort" => {
                self.workspace(&r.args, 2)?;
                let effort = r.args[1].as_str().ok_or(DesktopError("invalidParams"))?;
                let profile = profiles
                    .iter()
                    .find(|p| p.profile_id == self.settings.agent_channel_id)
                    .ok_or(DesktopError("profileNotFound"))?;
                let model = profile
                    .models
                    .iter()
                    .find(|m| m.model_id == self.settings.agent_model_id)
                    .ok_or(DesktopError("modelNotFound"))?;
                if !model.supported_efforts.iter().any(|s| s == effort) {
                    return Err(DesktopError("unsupportedEffort"));
                }
                self.workspaces[0].effort = effort.into();
            }
            channel if channel.starts_with("onboarding-spotlight:") => {
                self.settings.onboarding_spotlight.apply(channel, &r.args)?
            }
            channel if channel.starts_with("concept-spotlight:") => {
                self.settings.concept_spotlight.apply(channel, &r.args)?
            }
            _ => return Err(DesktopError("unsupported")),
        }
        Ok(())
    }
    fn value(&self, r: &PlatformRequest, snapshot: &PlatformSnapshot) -> Result<Value> {
        match r.channel.as_str() {
            "settings:update" => return encoded(&self.settings),
            "settings:update-sync" => return Ok(json!(true)),
            "user-profile:update" => return encoded(&self.user_profile),
            "agent:set-reasoning-effort" => return Ok(Value::Null),
            "agent:get-reasoning-effort" => return encoded(&self.workspace(&r.args, 1)?.effort),
            "agent:get-permission-mode" => {
                self.workspace(&r.args, 1)?;
                return Ok(json!("acceptEdits"));
            }
            "agent:get-workspace-directories" => {
                self.workspace(&r.args, 1)?;
                return Ok(json!([]));
            }
            _ => {}
        }
        if r.mutation.is_none() && !r.args.is_empty() {
            return Err(DesktopError("invalidParams"));
        }
        match r.channel.as_str() {
            "settings:get" => encoded(&self.settings),
            "user-profile:get" => encoded(&self.user_profile),
            "theme:resolve" => encoded(&snapshot.theme),
            "window:chrome-state" => encoded(&snapshot.chrome),
            "agent:list-workspaces" => encoded(&snapshot.workspaces),
            "telemetry:get-consent-state" => Ok(
                json!({"region":"unknown","defaultEnabled":false,"posthogEnabled":false,"agentEvolutionEnabled":false}),
            ),
            "telemetry:real-send-allowed" => Ok(json!(false)),
            "runtime:get-status" => Ok(Value::Null),
            channel if channel.starts_with("onboarding-spotlight:") => {
                encoded(&self.settings.onboarding_spotlight)
            }
            channel if channel.starts_with("concept-spotlight:") => {
                encoded(&self.settings.concept_spotlight)
            }
            _ => Err(DesktopError("unsupported")),
        }
    }
}

#[cfg(test)]
mod tests;
