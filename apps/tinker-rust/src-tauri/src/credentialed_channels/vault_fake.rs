//! QA只能持久化有限slot，不能接收任意凭据；生产构建无此模块。
use super::vault::*;
use crate::desktop_runtime::protocol::{DesktopError, Result};
use std::{path::PathBuf, sync::Mutex};
pub const QA_SECRET_ONE: &str = "tinker-qa-finite-key-one";
pub const QA_SECRET_TWO: &str = "tinker-qa-finite-key-two";
pub struct FakeVault {
    path: PathBuf,
    lock: Mutex<()>,
}
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Slot {
    version: u32,
    namespace: String,
    reference: String,
    slot: u8,
}
impl FakeVault {
    pub fn open(path: PathBuf) -> Result<Self> {
        crate::formal_platform::store::directory(&path, true)?;
        Ok(Self {
            path,
            lock: Mutex::new(()),
        })
    }
    fn path(&self, scope: &VaultScope, reference: &str) -> Result<PathBuf> {
        super::catalog::opaque_reference(reference)?;
        crate::formal_platform::store::directory(&self.path, true)?;
        Ok(self
            .path
            .join(format!("{}-{reference}.json", scope.namespace())))
    }
    fn references(&self, scope: &VaultScope) -> Result<Vec<String>> {
        let prefix = format!("{}-", scope.namespace());
        let mut refs = Vec::new();
        for entry in std::fs::read_dir(&self.path).map_err(|_| DesktopError("vaultUnavailable"))? {
            let name = entry
                .map_err(|_| DesktopError("vaultUnavailable"))?
                .file_name();
            if let Some(reference) = name
                .to_str()
                .and_then(|n| n.strip_prefix(&prefix))
                .and_then(|n| n.strip_suffix(".json"))
            {
                super::catalog::opaque_reference(reference)?;
                refs.push(reference.into());
                if refs.len() > 144 {
                    return Err(DesktopError("storageLimit"));
                }
            }
        }
        Ok(refs)
    }
}
impl CredentialVault for FakeVault {
    fn put(&self, scope: &VaultScope, reference: &str, secret: &Secret) -> Result<()> {
        let slot = secret
            .with_bytes(|b| {
                if b == QA_SECRET_ONE.as_bytes() {
                    Some(1)
                } else if b == QA_SECRET_TWO.as_bytes() {
                    Some(2)
                } else {
                    None
                }
            })
            .ok_or(DesktopError("invalidQaCredential"))?;
        let _guard = self
            .lock
            .lock()
            .map_err(|_| DesktopError("vaultUnavailable"))?;
        let path = self.path(scope, reference)?;
        if self.references(scope)?.len() >= 144 {
            return Err(DesktopError("storageLimit"));
        }
        let bytes = serde_json::to_vec(&Slot {
            version: 1,
            namespace: scope.namespace().into(),
            reference: reference.into(),
            slot,
        })
        .map_err(|_| DesktopError("vaultUnavailable"))?;
        crate::formal_platform::store::write_new(&path, &bytes)
            .map_err(|_| DesktopError("vaultWriteFailed"))?;
        crate::formal_platform::store::sync_dir(&self.path)
            .map_err(|_| DesktopError("vaultWriteUncertain"))
    }
    fn acquire(&self, scope: &VaultScope, reference: &str) -> Result<Secret> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| DesktopError("vaultUnavailable"))?;
        let path = self.path(scope, reference)?;
        if !path
            .try_exists()
            .map_err(|_| DesktopError("vaultUnavailable"))?
        {
            return Err(DesktopError("credentialMissing"));
        }
        let bytes = crate::formal_platform::store::read_regular(&path, 1024)
            .map_err(|_| DesktopError("vaultUnavailable"))?;
        let slot: Slot =
            serde_json::from_slice(&bytes).map_err(|_| DesktopError("vaultUnavailable"))?;
        if slot.version != 1 || slot.namespace != scope.namespace() || slot.reference != reference {
            return Err(DesktopError("vaultUnavailable"));
        }
        let value = match slot.slot {
            1 => QA_SECRET_ONE,
            2 => QA_SECRET_TWO,
            _ => return Err(DesktopError("vaultUnavailable")),
        };
        Secret::new(value.as_bytes().to_vec())
    }
    fn owned_references(&self, scope: &VaultScope) -> Result<Vec<String>> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| DesktopError("vaultUnavailable"))?;
        self.references(scope)
    }
    fn remove(&self, scope: &VaultScope, reference: &str) -> Result<()> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| DesktopError("vaultUnavailable"))?;
        let path = self.path(scope, reference)?;
        crate::formal_platform::store::read_regular(&path, 1024)
            .map_err(|_| DesktopError("vaultUnavailable"))?;
        std::fs::remove_file(path).map_err(|_| DesktopError("vaultUnavailable"))?;
        crate::formal_platform::store::sync_dir(&self.path)
            .map_err(|_| DesktopError("vaultUnavailable"))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fake_persists_only_finite_slot_and_never_arbitrary_secret() {
        let path = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("credential-fake-{}", std::process::id()));
        std::fs::create_dir(&path).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        let scope = VaultScope::new("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into()).unwrap();
        let reference = "11111111111111111111111111111111";
        let v = FakeVault::open(path.clone()).unwrap();
        assert!(v
            .put(
                &scope,
                reference,
                &Secret::new(b"arbitrary-key".to_vec()).unwrap()
            )
            .is_err());
        v.put(
            &scope,
            reference,
            &Secret::new(QA_SECRET_ONE.as_bytes().to_vec()).unwrap(),
        )
        .expect("finite fake must persist");
        drop(v);
        let v = FakeVault::open(path.clone()).unwrap();
        assert!(v
            .acquire(&scope, reference)
            .unwrap()
            .with_bytes(|b| b == QA_SECRET_ONE.as_bytes()));
        assert!(v
            .put(
                &scope,
                reference,
                &Secret::new(QA_SECRET_TWO.as_bytes().to_vec()).unwrap()
            )
            .is_err());
        for file in std::fs::read_dir(&path).unwrap() {
            let bytes = std::fs::read(file.unwrap().path()).unwrap();
            assert!(!String::from_utf8_lossy(&bytes).contains(QA_SECRET_ONE));
        }
        std::fs::remove_dir_all(path).unwrap();
    }
}
