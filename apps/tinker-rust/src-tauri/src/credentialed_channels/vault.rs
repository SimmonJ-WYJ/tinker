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
pub trait CredentialVault: Send + Sync {
    fn put(&self, scope: &VaultScope, reference: &str, secret: &Secret) -> Result<()>;
    fn acquire(&self, scope: &VaultScope, reference: &str) -> Result<Secret>;
    fn owned_references(&self, scope: &VaultScope) -> Result<Vec<String>>;
    fn remove(&self, scope: &VaultScope, reference: &str) -> Result<()>;
}
