//! 仅可信宿主更新的新请求可用性；已接受绑定不重新套用策略。
use super::{
    protocol::{DesktopError, Result},
    DesktopRuntime, Inner,
};
use std::collections::{BTreeMap, BTreeSet};
pub type Availability = BTreeMap<String, BTreeSet<String>>;
impl DesktopRuntime {
    pub fn set_availability(&self, policy: Availability) -> Result<()> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| DesktopError("recoveryRequired"))?;
        inner.availability_policy_invalid = true;
        if policy.len() != inner.profiles.len()
            || policy.iter().any(|(id, models)| {
                inner.profiles.get(id).is_none_or(|p| {
                    models.len() > p.models.len()
                        || models
                            .iter()
                            .any(|m| !p.models.iter().any(|known| known.model_id == *m))
                })
            })
        {
            return Err(DesktopError("invalidParams"));
        }
        inner.availability = Some(policy);
        inner.availability_policy_invalid = false;
        Ok(())
    }
    /// 恢复冻结只随实例销毁结束；健康策略或历史 receipt 不能恢复新请求权限。
    pub fn freeze_availability(&self) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.availability_recovery_required = true;
        }
    }
}
impl Inner {
    pub(super) fn require_available(&self, profile: &str, model: &str) -> Result<()> {
        if self.availability_recovery_required || self.availability_policy_invalid {
            return Err(DesktopError("recoveryRequired"));
        }
        if self.availability.as_ref().is_some_and(|policy| {
            !policy
                .get(profile)
                .is_some_and(|models| models.contains(model))
        }) {
            return Err(DesktopError("modelUnavailable"));
        }
        Ok(())
    }
}
