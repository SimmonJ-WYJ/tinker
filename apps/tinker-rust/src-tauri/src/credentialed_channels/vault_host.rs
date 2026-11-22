//! 真正宿主只经已认证同binary私有管道访问Keychain；无公开decrypt分派。
use super::vault::{CredentialBinding, CredentialVault, Secret, VaultScope};
use crate::desktop_runtime::protocol::{DesktopError, Result};
use std::sync::atomic::{AtomicBool, Ordering};
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    namespace: String,
    action: Action,
}
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", deny_unknown_fields)]
enum Action {
    Put {
        reference: String,
        binding: CredentialBinding,
        secret: String,
    },
    Acquire {
        reference: String,
        binding: CredentialBinding,
    },
    References,
    Remove {
        reference: String,
    },
}
pub(crate) struct HelperVault;
impl HelperVault {
    fn call(
        &self,
        s: &VaultScope,
        action: Action,
        cancel: &AtomicBool,
    ) -> Result<serde_json::Value> {
        let request = serde_json::to_vec(&Request {
            namespace: s.namespace().into(),
            action,
        })
        .map_err(|_| DesktopError("vaultUnavailable"))?;
        let bytes = super::process::vault(&request, &|| cancel.load(Ordering::Acquire))?;
        let value: serde_json::Value =
            serde_json::from_slice(&bytes).map_err(|_| DesktopError("vaultUnavailable"))?;
        if let Some(error) = value.get("error") {
            return Err(DesktopError(match error.as_str() {
                Some("credentialMissing") => "credentialMissing",
                Some("credentialBindingMismatch") => "credentialBindingMismatch",
                #[cfg(all(feature = "keychain-acceptance", not(feature = "formal-native-qa")))]
                Some("vaultMissingEntitlement") => "vaultMissingEntitlement",
                Some("vaultDenied") => "vaultDenied",
                Some("credentialReferenceExists") => "credentialReferenceExists",
                Some("storageLimit") => "storageLimit",
                _ => "vaultUnavailable",
            }));
        }
        value
            .get("value")
            .cloned()
            .ok_or(DesktopError("vaultUnavailable"))
    }
}
impl CredentialVault for HelperVault {
    fn put_bound_cancellable(
        &self,
        s: &VaultScope,
        r: &str,
        b: &CredentialBinding,
        k: &Secret,
        c: &AtomicBool,
    ) -> Result<()> {
        b.validate(s)?;
        self.call(
            s,
            Action::Put {
                reference: r.into(),
                binding: b.clone(),
                secret: k
                    .with_bytes(|b| String::from_utf8(b.to_vec()))
                    .map_err(|_| DesktopError("invalidCredential"))?,
            },
            c,
        )
        .map(|_| ())
    }
    fn acquire_bound_cancellable(
        &self,
        s: &VaultScope,
        r: &str,
        b: &CredentialBinding,
        c: &AtomicBool,
    ) -> Result<Secret> {
        b.validate(s)?;
        let value = self.call(
            s,
            Action::Acquire {
                reference: r.into(),
                binding: b.clone(),
            },
            c,
        )?;
        Secret::new(
            value
                .as_str()
                .ok_or(DesktopError("vaultUnavailable"))?
                .as_bytes()
                .to_vec(),
        )
    }
    fn put_bound(&self, s: &VaultScope, r: &str, b: &CredentialBinding, k: &Secret) -> Result<()> {
        self.put_bound_cancellable(s, r, b, k, &AtomicBool::new(false))
    }
    fn acquire_bound(&self, s: &VaultScope, r: &str, b: &CredentialBinding) -> Result<Secret> {
        self.acquire_bound_cancellable(s, r, b, &AtomicBool::new(false))
    }
    fn put(&self, _: &VaultScope, _: &str, _: &Secret) -> Result<()> {
        Err(DesktopError("credentialBindingRequired"))
    }
    fn acquire(&self, _: &VaultScope, _: &str) -> Result<Secret> {
        Err(DesktopError("credentialBindingRequired"))
    }
    fn owned_references(&self, s: &VaultScope) -> Result<Vec<String>> {
        serde_json::from_value(self.call(s, Action::References, &AtomicBool::new(false))?)
            .map_err(|_| DesktopError("vaultUnavailable"))
    }
    fn remove(&self, s: &VaultScope, r: &str) -> Result<()> {
        self.call(
            s,
            Action::Remove {
                reference: r.into(),
            },
            &AtomicBool::new(false),
        )
        .map(|_| ())
    }
}
pub(super) fn child() -> Result<()> {
    use std::io::{Read, Write};
    // QA和测试binary没有Keychain入口，即使开启全部features也不能改变此角色。
    if std::env::current_exe()
        .map_err(|_| DesktopError("helperUnauthorized"))?
        .file_name()
        .and_then(|s| s.to_str())
        != Some("tinker-channels-preview")
    {
        return Err(DesktopError("helperUnauthorized"));
    }
    let parent = super::auth_macos::parent()?;
    let mut hello = [0u8; 33];
    std::io::stdin()
        .read_exact(&mut hello)
        .map_err(|_| DesktopError("helperUnauthorized"))?;
    if hello[32] != b'\n' {
        return Err(DesktopError("helperUnauthorized"));
    }
    super::catalog::opaque_reference(
        std::str::from_utf8(&hello[..32]).map_err(|_| DesktopError("helperUnauthorized"))?,
    )?;
    super::auth_macos::recheck(parent)?;
    std::io::stdout()
        .write_all(&hello)
        .map_err(|_| DesktopError("helperUnavailable"))?;
    std::io::stdout()
        .flush()
        .map_err(|_| DesktopError("helperUnavailable"))?;
    let mut bytes = Vec::new();
    std::io::stdin()
        .take(65537)
        .read_to_end(&mut bytes)
        .map_err(|_| DesktopError("helperUnavailable"))?;
    if bytes.len() > 65536 {
        return Err(DesktopError("helperLimit"));
    }
    let request: Request =
        serde_json::from_slice(&bytes).map_err(|_| DesktopError("helperUnauthorized"))?;
    let scope = VaultScope::new(request.namespace)?;
    let proof = super::vault_macos::OwnedHelperProof::after_private_handshake(parent)?;
    let vault = super::vault_macos::MacosVault::in_owned_helper(proof);
    let result = (|| match request.action {
        Action::Put {
            reference,
            binding,
            secret,
        } => {
            let secret = Secret::new(secret.into_bytes())?;
            vault.put_bound(&scope, &reference, &binding, &secret)?;
            Ok(serde_json::Value::Null)
        }
        Action::Acquire { reference, binding } => {
            vault.acquire_bound(&scope, &reference, &binding).map(|s| {
                s.with_bytes(|b| serde_json::Value::String(String::from_utf8_lossy(b).into_owned()))
            })
        }
        Action::References => serde_json::to_value(vault.owned_references(&scope)?)
            .map_err(|_| DesktopError("vaultUnavailable")),
        Action::Remove { reference } => {
            vault.remove(&scope, &reference)?;
            Ok(serde_json::Value::Null)
        }
    })();
    super::auth_macos::recheck(parent)?;
    let result = match result {
        Ok(value) => serde_json::json!({"value":value}),
        Err(error) => serde_json::json!({"error":error.0}),
    };
    let output = serde_json::to_vec(&result).map_err(|_| DesktopError("vaultUnavailable"))?;
    if output.len() > 65536 {
        return Err(DesktopError("helperLimit"));
    }
    std::io::stdout()
        .write_all(&output)
        .map_err(|_| DesktopError("helperUnavailable"))
}
