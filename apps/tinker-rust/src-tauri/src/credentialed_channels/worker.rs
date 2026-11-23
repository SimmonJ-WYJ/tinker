//! 锁外准备当前秘密；纯工厂在Bind之前检查已知秘密，网络仅在执行worker运行。
use super::{
    catalog::{Catalog, ConnectionRevision, EndpointPolicy},
    vault::{CredentialVault, Secret, VaultScope},
};
use crate::{
    chat_http::{ChatHttpConfig, ChatHttpProvider, HttpProtocol},
    desktop_runtime::{
        protocol::{DesktopError, Result},
        revisions::{ManagedProfile, ManagedProviderFactory, PreparedProfiles},
    },
    run_context::RunContext,
    run_provider::RunProvider,
    run_types::RunError,
};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    sync::{atomic::AtomicBool, Arc, Mutex},
};
pub(crate) type Known = Arc<Mutex<BTreeMap<String, Arc<Secret>>>>;
pub(crate) fn remember(known: &Known, reference: String, secret: Arc<Secret>) -> Result<()> {
    let mut keys = known.lock().map_err(|_| DesktopError("recoveryRequired"))?;
    if let Some(original) = keys.get(&reference) {
        // A rotation allocates a new reference. Never let a replaced value under an
        // existing reference authorize a factory that still holds the old credential.
        if !original.with_bytes(|old| secret.with_bytes(|new| old == new)) {
            return Err(DesktopError("credentialUnavailable"));
        }
        return Ok(());
    }
    if keys.len() >= 144 {
        return Err(DesktopError("storageLimit"));
    }
    keys.insert(reference, secret);
    Ok(())
}
pub(crate) fn guard(value: &Value, known: &Known) -> Result<()> {
    let keys = known.lock().map_err(|_| DesktopError("recoveryRequired"))?;
    if keys
        .values()
        .any(|key| key.with_bytes(|b| contains(value, b)))
    {
        Err(DesktopError("invalidParams"))
    } else {
        Ok(())
    }
}
pub(crate) fn contains(value: &Value, key: &[u8]) -> bool {
    let has = |s: &str| s.as_bytes().windows(key.len()).any(|w| w == key);
    match value {
        Value::String(s) => has(s),
        Value::Array(a) => a.iter().any(|v| contains(v, key)),
        Value::Object(o) => o.iter().any(|(k, v)| has(k) || contains(v, key)),
        _ => false,
    }
}
pub(crate) fn hydrate(
    c: &Catalog,
    scope: &VaultScope,
    vault: &dyn CredentialVault,
    known: &Known,
    cancelled: &AtomicBool,
    required_channel: Option<&str>,
) -> Result<BTreeMap<String, Arc<Secret>>> {
    let mut keys = BTreeMap::new();
    for revision in c.current() {
        if cancelled.load(std::sync::atomic::Ordering::Acquire) {
            return Err(DesktopError("staleGeneration"));
        }

        let acquired = vault.acquire_bound_cancellable(
            scope,
            &revision.credential_ref,
            &super::vault::CredentialBinding::new(scope, &revision.channel),
            cancelled,
        );
        let secret = match acquired {
            Ok(secret) => Arc::new(secret),
            Err(error)
                if required_channel != Some(revision.channel.id.as_str())
                    && matches!(
                        error.0,
                        "credentialMissing"
                            | "vaultDenied"
                            | "vaultUnavailable"
                            | "helperUnavailable"
                            | "helperTimeout"
                            | "helperBusy"
                    ) =>
            {
                continue
            }
            Err(error) => return Err(error),
        };
        if cancelled.load(std::sync::atomic::Ordering::Acquire) {
            return Err(DesktopError("staleGeneration"));
        }
        remember(known, revision.credential_ref.clone(), secret.clone())?;
        keys.insert(revision.credential_ref.clone(), secret);
    }
    guard(
        &serde_json::to_value(c).map_err(|_| DesktopError("invalidParams"))?,
        known,
    )?;
    Ok(keys)
}
pub(crate) fn profiles(
    c: &Catalog,
    keys: &BTreeMap<String, Arc<Secret>>,
    known: &Known,
    policy: &EndpointPolicy,
) -> Result<PreparedProfiles> {
    let mut p = Vec::new();
    let mut current = BTreeMap::new();
    let mut enabled = BTreeMap::new();
    for rev in c.revisions.values() {
        p.push(ManagedProfile {
            profile_id: rev.channel.id.clone(),
            label: rev.channel.name.clone(),
            config_revision: rev.id.clone(),
            models: rev
                .channel
                .models
                .iter()
                .map(|m| m.runtime_model())
                .collect(),
            protocol: rev.channel.protocol,
            authority: serde_json::to_string(rev).map_err(|_| DesktopError("invalidProfile"))?,
            factory: keys.get(&rev.credential_ref).map(|key| {
                Arc::new(Factory {
                    revision: rev.clone(),
                    key: key.clone(),
                    known: known.clone(),
                    policy: policy.clone(),
                }) as Arc<dyn ManagedProviderFactory>
            }),
        });
    }
    for rev in c.current() {
        current.insert(rev.channel.id.clone(), rev.id.clone());
        enabled.insert(
            rev.channel.id.clone(),
            rev.channel
                .models
                .iter()
                .filter(|m| rev.channel.enabled && m.selectable())
                .map(|m| m.model_id.clone())
                .collect(),
        );
    }
    PreparedProfiles::new(p, current, enabled)
}
struct Factory {
    revision: ConnectionRevision,
    key: Arc<Secret>,
    known: Known,
    policy: EndpointPolicy,
}
impl ManagedProviderFactory for Factory {
    fn provider(&self, model: &str, effort: Option<&str>) -> Result<Arc<dyn RunProvider>> {
        let channel = &self.revision.channel;
        if !channel.models.iter().any(|m| {
            m.model_id == model
                && m.capability(channel.protocol) == super::catalog::ModelCapability::Text
        }) {
            return Err(DesktopError("modelCapabilityMismatch"));
        }
        Ok(Arc::new(Provider {
            revision: self.revision.clone(),
            key: self.key.clone(),
            known: self.known.clone(),
            policy: self.policy.clone(),
            model: model.into(),
            effort: effort.map(str::to_owned),
        }))
    }
}
struct Provider {
    revision: ConnectionRevision,
    key: Arc<Secret>,
    known: Known,
    policy: EndpointPolicy,
    model: String,
    effort: Option<String>,
}
impl Provider {
    fn check(&self, v: &Value) -> std::result::Result<(), RunError> {
        guard(v, &self.known).map_err(|_| RunError::HttpConfig)
    }
}
impl RunProvider for Provider {
    fn validate_tool_metadata(&self, v: &Value) -> std::result::Result<(), RunError> {
        self.check(v)
    }
    fn validate_tool_output(&self, s: &str) -> std::result::Result<(), RunError> {
        self.check(&Value::String(s.into()))
    }
    fn execute(
        &self,
        input: &str,
        cancelled: &AtomicBool,
        emit: &mut dyn FnMut(&str) -> std::result::Result<(), RunError>,
    ) -> std::result::Result<(), RunError> {
        self.execute_context(&RunContext::single(input), cancelled, emit)
    }
    fn execute_context(
        &self,
        context: &RunContext,
        cancelled: &AtomicBool,
        emit: &mut dyn FnMut(&str) -> std::result::Result<(), RunError>,
    ) -> std::result::Result<(), RunError> {
        use std::sync::atomic::Ordering;
        if cancelled.load(Ordering::Acquire) {
            return Ok(());
        }
        for m in context.messages() {
            self.check(&Value::String(m.content.clone()))?;
        }
        let prepared =
            super::endpoint::prepare(&self.policy, &self.revision.channel.base_url, || {
                cancelled.load(Ordering::Acquire)
            })
            .map_err(|_| RunError::HttpConfig)?;
        if cancelled.load(Ordering::Acquire) {
            return Ok(());
        }
        let suffix = match self.revision.channel.protocol {
            HttpProtocol::OpenaiChat => "chat/completions",
            HttpProtocol::AnthropicMessages => "messages",
        };
        let key = self
            .key
            .with_bytes(|b| String::from_utf8(b.to_vec()))
            .map_err(|_| RunError::HttpConfig)?;
        let config = ChatHttpConfig::new_with_pins(
            format!("{}/{suffix}", prepared.base),
            key,
            self.model.clone(),
            prepared.pins,
        )?
        .with_protocol(self.revision.channel.protocol, self.effort.as_deref())?;
        let mut output = KnownOutput {
            known: self.known.clone(),
            pending: String::new(),
        };
        ChatHttpProvider::new(config)
            .execute_context(context, cancelled, &mut |text| output.push(text, emit))?;
        if !cancelled.load(Ordering::Acquire) {
            output.finish(emit)?;
        }
        Ok(())
    }
}

struct KnownOutput {
    known: Known,
    pending: String,
}
impl KnownOutput {
    fn push(
        &mut self,
        text: &str,
        emit: &mut dyn FnMut(&str) -> std::result::Result<(), RunError>,
    ) -> std::result::Result<(), RunError> {
        self.pending.push_str(text);
        let keys = self.known.lock().map_err(|_| RunError::HttpConfig)?;
        let mut keep = 0;
        for secret in keys.values() {
            secret.with_bytes(|key| {
                if self.pending.as_bytes().windows(key.len()).any(|w| w == key) {
                    return Err(RunError::HttpProtocol);
                }
                for n in 1..=self.pending.len().min(key.len()) {
                    if self.pending.is_char_boundary(self.pending.len() - n)
                        && self.pending.as_bytes().ends_with(&key[..n])
                    {
                        keep = keep.max(n);
                    }
                }
                Ok(())
            })?;
        }
        drop(keys);
        let split = self.pending.len() - keep;
        Self::emit(&self.pending[..split], emit)?;
        self.pending.drain(..split);
        Ok(())
    }
    fn emit(
        mut text: &str,
        emit: &mut dyn FnMut(&str) -> std::result::Result<(), RunError>,
    ) -> std::result::Result<(), RunError> {
        while !text.is_empty() {
            let mut end = text.len().min(2048);
            while !text.is_char_boundary(end) {
                end -= 1;
            }
            emit(&text[..end])?;
            text = &text[end..];
        }
        Ok(())
    }
    fn finish(
        &self,
        emit: &mut dyn FnMut(&str) -> std::result::Result<(), RunError>,
    ) -> std::result::Result<(), RunError> {
        Self::emit(&self.pending, emit)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn known_material_is_bounded_even_if_external_items_are_removed() {
        let known = Arc::new(Mutex::new(BTreeMap::new()));
        let secret = Arc::new(Secret::new(b"finite-test-key".to_vec()).unwrap());
        for n in 0..144 {
            remember(&known, format!("{n:032x}"), secret.clone()).unwrap();
        }
        assert!(matches!(
            remember(&known, "f".repeat(32), secret.clone()),
            Err(DesktopError("storageLimit"))
        ));
        remember(&known, "0".repeat(32), secret).unwrap();
        assert_eq!(known.lock().unwrap().len(), 144);
    }
}

#[cfg(test)]
mod immutable_credential_tests {
    use super::*;

    #[test]
    fn changed_secret_requires_a_new_reference() {
        let known = Known::default();
        let first = || Arc::new(Secret::new(b"fixture-one".to_vec()).unwrap());
        let second = || Arc::new(Secret::new(b"fixture-two".to_vec()).unwrap());
        remember(&known, "r1".into(), first()).unwrap();
        remember(&known, "r1".into(), first()).unwrap();
        assert_eq!(
            remember(&known, "r1".into(), second()).unwrap_err().0,
            "credentialUnavailable"
        );
        assert!(guard(&serde_json::json!("fixture-one"), &known).is_err());
        remember(&known, "r2".into(), second()).unwrap();
        assert!(guard(&serde_json::json!("fixture-two"), &known).is_err());
    }
}
