//! 可信宿主安装不可变版本；工厂只创建已准备的执行器，禁止在actor锁内阻塞查询秘密。
use super::{profile::Profile, protocol::*, DesktopRuntime, Model};
use crate::{chat_http::HttpProtocol, run_provider::RunProvider};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};
pub trait ManagedProviderFactory: std::marker::Send + Sync {
    /// 必须立即返回；vault/DNS工作由宿主锁外准备或执行器worker完成。
    fn provider(&self, model: &str, effort: Option<&str>) -> Result<Arc<dyn RunProvider>>;
}
pub struct ManagedProfile {
    pub profile_id: String,
    pub label: String,
    pub config_revision: String,
    pub models: Vec<Model>,
    pub protocol: HttpProtocol,
    /// 完整非秘密连接版本的规范编码；不允许密钥、密钥摘要或变化的运行时数据。
    pub authority: String,
    pub factory: Option<Arc<dyn ManagedProviderFactory>>,
}
pub struct PreparedProfiles {
    pub(super) revisions: BTreeMap<(String, String), Profile>,
    pub(super) current: BTreeMap<String, String>,
    pub(super) enabled: BTreeMap<String, BTreeSet<String>>,
}
impl PreparedProfiles {
    pub fn new(
        profiles: Vec<ManagedProfile>,
        current: BTreeMap<String, String>,
        enabled: BTreeMap<String, BTreeSet<String>>,
    ) -> Result<Self> {
        if profiles.len() > 128 || current.len() > 16 || current.len() != enabled.len() {
            return Err(DesktopError("storageLimit"));
        }
        let mut revisions = BTreeMap::new();
        for p in profiles {
            let p = Profile::from_managed(p)?;
            if revisions
                .insert((p.profile_id.clone(), p.config_revision.clone()), p)
                .is_some()
            {
                return Err(DesktopError("invalidProfile"));
            }
        }
        for (id, rev) in &current {
            let p = revisions
                .get(&(id.clone(), rev.clone()))
                .ok_or(DesktopError("invalidProfile"))?;
            if enabled.get(id).is_none_or(|models| {
                models
                    .iter()
                    .any(|m| !p.models.iter().any(|v| &v.model_id == m))
            }) {
                return Err(DesktopError("invalidProfile"));
            }
        }
        let public: Vec<_> = current
            .iter()
            .filter_map(|(id, rev)| revisions.get(&(id.clone(), rev.clone())))
            .collect();
        if serde_json::to_vec(&public)
            .map_err(|_| DesktopError("invalidProfile"))?
            .len()
            > MAX_PAGE_BYTES
        {
            return Err(DesktopError("storageLimit"));
        }
        Ok(Self {
            revisions,
            current,
            enabled,
        })
    }
}
impl DesktopRuntime {
    pub fn install_managed(&self, prepared: PreparedProfiles) -> Result<()> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| DesktopError("recoveryRequired"))?;
        if !inner.managed {
            return Err(DesktopError("unsupported"));
        }
        if inner.availability_recovery_required {
            return Err(DesktopError("recoveryRequired"));
        }
        let result = (|| {
            let mut revisions = inner.revisions.clone();
            for (key, p) in prepared.revisions {
                if let Some(old) = revisions.get_mut(&key) {
                    if !old.same_revision(&p) {
                        return Err(DesktopError("revisionConflict"));
                    }
                    if old.factory.is_none() {
                        old.factory = p.factory;
                    }
                } else {
                    revisions.insert(key, p);
                }
            }
            if revisions.len() > 128 {
                return Err(DesktopError("storageLimit"));
            }
            let current = prepared
                .current
                .into_iter()
                .map(|(id, rev)| {
                    let p = revisions
                        .get(&(id.clone(), rev))
                        .ok_or(DesktopError("invalidProfile"))?
                        .clone();
                    Ok((id, p))
                })
                .collect::<Result<BTreeMap<_, _>>>()?;
            inner.revisions = revisions;
            inner.profiles = current;
            inner.availability = Some(prepared.enabled);
            inner.availability_policy_invalid = false;
            Ok(())
        })();
        if result.is_err() {
            inner.availability_recovery_required = true;
        }
        result
    }
}

impl super::Inner {
    pub(super) fn binding_revision_matches(&self, b: &super::session::Binding) -> bool {
        if self.managed {
            self.revisions
                .contains_key(&(b.request.profile_id.clone(), b.config_revision.clone()))
        } else {
            self.profiles
                .get(&b.request.profile_id)
                .is_some_and(|p| p.config_revision == b.config_revision)
        }
    }
    pub(super) fn bound_profile(&self, b: &super::session::Binding) -> Result<&Profile> {
        if self.managed {
            self.revisions
                .get(&(b.request.profile_id.clone(), b.config_revision.clone()))
                .ok_or(DesktopError("profileNotFound"))
        } else {
            self.profiles
                .get(&b.request.profile_id)
                .filter(|p| p.config_revision == b.config_revision)
                .ok_or(DesktopError("requestConflict"))
        }
    }
}
