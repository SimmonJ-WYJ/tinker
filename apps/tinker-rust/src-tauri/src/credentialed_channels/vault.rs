//! 凭据只经私有类型传递；无Debug/Serialize，不接受renderer自选namespace。
use super::catalog::opaque_reference;
use crate::desktop_runtime::protocol::{DesktopError, Result};
use std::sync::atomic::{compiler_fence, Ordering};
pub struct Secret(Vec<u8>);
impl Secret {
    pub fn new(bytes: Vec<u8>) -> Result<Self> {
        let secret = Self(bytes);
        if secret.0.is_empty()
            || secret.0.len() > 8192
            || std::str::from_utf8(&secret.0).is_err()
            || secret.0.iter().any(|v| v.is_ascii_control())
        {
            return Err(DesktopError("invalidCredential"));
        }
        Ok(secret)
    }
    pub fn with_bytes<T>(&self, read: impl FnOnce(&[u8]) -> T) -> T {
        read(&self.0)
    }
}
impl Drop for Secret {
    fn drop(&mut self) {
        for byte in &mut self.0 {
            unsafe { std::ptr::write_volatile(byte, 0) }
        }
        compiler_fence(Ordering::SeqCst);
    }
}
#[derive(Clone)]
pub struct VaultScope {
    namespace: String,
}
impl VaultScope {
    pub(crate) fn new(namespace: String) -> Result<Self> {
        opaque_reference(&namespace)?;
        Ok(Self { namespace })
    }
    pub fn namespace(&self) -> &str {
        &self.namespace
    }
    pub fn service(&self) -> String {
        format!("com.tinker.channels-preview.{}", self.namespace)
    }
}
/// 保护条目内的连接身份；调用者必须在释放秘密前与当前非秘密目录比对。
#[derive(Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CredentialBinding {
    namespace: String,
    channel_id: String,
    protocol: crate::chat_http::HttpProtocol,
    base_url: String,
}
impl CredentialBinding {
    pub(crate) fn new(scope: &VaultScope, channel: &super::catalog::ChannelSpec) -> Self {
        Self {
            namespace: scope.namespace().into(),
            channel_id: channel.id.clone(),
            protocol: channel.protocol,
            base_url: channel.base_url.clone(),
        }
    }
    pub(crate) fn validate(&self, scope: &VaultScope) -> Result<()> {
        if self.namespace != scope.namespace() {
            return Err(DesktopError("credentialBindingMismatch"));
        }
        crate::formal_platform::protocol::identifier(&self.channel_id)?;
        if self.base_url.len() > 2048 || self.base_url.chars().any(char::is_control) {
            return Err(DesktopError("credentialBindingMismatch"));
        }
        Ok(())
    }
}
pub trait CredentialVault: Send + Sync {
    fn put_bound_cancellable(
        &self,
        s: &VaultScope,
        r: &str,
        b: &CredentialBinding,
        k: &Secret,
        c: &std::sync::atomic::AtomicBool,
    ) -> Result<()> {
        if c.load(Ordering::Acquire) {
            return Err(DesktopError("staleGeneration"));
        }
        self.put_bound(s, r, b, k)
    }
    fn acquire_bound_cancellable(
        &self,
        s: &VaultScope,
        r: &str,
        b: &CredentialBinding,
        c: &std::sync::atomic::AtomicBool,
    ) -> Result<Secret> {
        if c.load(Ordering::Acquire) {
            return Err(DesktopError("staleGeneration"));
        }
        self.acquire_bound(s, r, b)
    }

    fn put_bound(
        &self,
        _scope: &VaultScope,
        _reference: &str,
        _binding: &CredentialBinding,
        _secret: &Secret,
    ) -> Result<()> {
        Err(DesktopError("credentialBindingRequired"))
    }
    fn acquire_bound(
        &self,
        _scope: &VaultScope,
        _reference: &str,
        _binding: &CredentialBinding,
    ) -> Result<Secret> {
        Err(DesktopError("credentialBindingRequired"))
    }

    fn put(&self, scope: &VaultScope, reference: &str, secret: &Secret) -> Result<()>;
    fn acquire(&self, scope: &VaultScope, reference: &str) -> Result<Secret>;
    fn owned_references(&self, scope: &VaultScope) -> Result<Vec<String>>;
    fn remove(&self, scope: &VaultScope, reference: &str) -> Result<()>;
}

/// 没有可证明的owned helper时，普通宿主拒绝存取，绝不选择QA后备。
pub(crate) struct UnavailableVault;
impl CredentialVault for UnavailableVault {
    fn put_bound(&self, _: &VaultScope, _: &str, _: &CredentialBinding, _: &Secret) -> Result<()> {
        Err(DesktopError("vaultUnavailable"))
    }
    fn acquire_bound(&self, _: &VaultScope, _: &str, _: &CredentialBinding) -> Result<Secret> {
        Err(DesktopError("vaultUnavailable"))
    }

    fn put(&self, _: &VaultScope, _: &str, _: &Secret) -> Result<()> {
        Err(DesktopError("vaultUnavailable"))
    }
    fn acquire(&self, _: &VaultScope, _: &str) -> Result<Secret> {
        Err(DesktopError("vaultUnavailable"))
    }
    fn owned_references(&self, _: &VaultScope) -> Result<Vec<String>> {
        Err(DesktopError("vaultUnavailable"))
    }
    fn remove(&self, _: &VaultScope, _: &str) -> Result<()> {
        Err(DesktopError("vaultUnavailable"))
    }
}
