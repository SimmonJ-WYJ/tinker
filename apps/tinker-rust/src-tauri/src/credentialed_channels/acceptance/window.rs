//! 窗口联合验收仅使用当前进程新建的夹具与确认过的凭据引用。
use super::{check, commit, open, CredentialVault, DesktopError, Result, Run, TrustedRoot};
use std::io::{Read, Write};

fn exercise(
    root: &TrustedRoot,
    vault: &dyn CredentialVault,
    key: &str,
    handoff: impl FnOnce() -> Result<()>,
) -> Result<()> {
    let platform = open(root)?;
    let scope = platform.vault_scope();
    check(platform.bootstrap()?.revision == 0, "existingProfile")?;
    check(
        vault.owned_references(&scope)?.is_empty(),
        "nonemptyService",
    )?;
    let mut fixture = Run {
        vault,
        scope,
        owned: Vec::new(),
    };
    let staged = fixture.stage(&platform, "channel:create", "window", "create", key)?;
    // 成功暂存后已有本轮引用；提交、交接和验证共用同一条清理路径。
    let setup = commit(&platform, staged).and_then(|()| fixture.read(&platform, "window", key));
    drop(platform);
    let outcome = setup
        .and_then(|()| handoff())
        .and_then(|()| finish(root, &fixture, key));
    if let Err(cleanup) = fixture.cleanup() {
        if let Err(check) = outcome {
            let _ = writeln!(
                std::io::stderr(),
                "窗口验收失败：{check}；清理失败：{cleanup}"
            );
        }
        return Err(cleanup);
    }
    let _ = writeln!(
        std::io::stderr(),
        "Cleaned one acknowledged fixture reference"
    );
    outcome
}

fn wait_for_owner(mut output: impl Write, mut input: impl Read) -> Result<()> {
    writeln!(output, "READY: isolated committed window fixture")?;
    output.flush()?;
    let mut byte = [0];
    input
        .read_exact(&mut byte)
        .map_err(|_| DesktopError("windowCheckAborted"))?;
    check(byte == [b'v'], "windowCheckAborted")
}

fn finish(root: &TrustedRoot, fixture: &Run<'_>, key: &str) -> Result<()> {
    let platform = open(root)?;
    let snapshot = platform.bootstrap()?;
    check(
        platform.vault_scope().namespace() == fixture.scope.namespace(),
        "namespaceChanged",
    )?;
    check(
        snapshot.settings.agent_channel_id == "window"
            && snapshot.settings.agent_model_id == "restart-second",
        "selectionChanged",
    )?;
    fixture.read(&platform, "window", key)
}

#[cfg(all(
    target_os = "macos",
    feature = "keychain-acceptance",
    not(feature = "formal-native-qa")
))]
pub(super) fn native() -> Result<()> {
    let root = super::fresh_root()?;
    let key = super::random_reference()?;
    eprintln!("Synthetic profile: {}", root.path().display());
    exercise(&root, &super::super::vault_host::HelperVault, &key, || {
        wait_for_owner(std::io::stdout().lock(), std::io::stdin().lock())
    })?;
    writeln!(
        std::io::stdout(),
        "PASS: persisted window selection and bound Keychain read"
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::{open, tests::fixture};
    use crate::credentialed_channels::{vault::CredentialVault, vault_fake::QA_SECRET_ONE};

    fn select_second(p: &super::super::CredentialedPlatform) -> super::Result<()> {
        super::super::commit(
            p,
            crate::formal_platform::PlatformRequest {
                version: 1,
                channel: "settings:update".into(),
                args: vec![
                    serde_json::json!({"agentChannelId":"window", "agentModelId":"restart-second"}),
                ],
                mutation: Some(crate::formal_platform::protocol::Mutation {
                    mutation_id: "select-second".into(),
                    expected_revision: p.bootstrap().unwrap().revision,
                }),
            },
        )
    }

    #[test]
    fn failed_ready_write_cleans_acknowledged_reference() {
        let (root, vault) = fixture();
        let result = super::exercise(&root, &vault, QA_SECRET_ONE, || {
            super::wait_for_owner(&mut [][..], &b"v"[..])
        });
        assert!(result.is_err());
        assert!(vault
            .owned_references(&open(&root).unwrap().vault_scope())
            .unwrap()
            .is_empty());
        std::fs::remove_dir_all(root.path()).unwrap();
    }

    #[test]
    fn failed_selection_verification_preserves_unacknowledged_reference() {
        use crate::credentialed_channels::vault::Secret;
        let (root, vault) = fixture();
        let scope = open(&root).unwrap().vault_scope();
        let guard = super::super::random_reference().unwrap();
        let result = super::exercise(&root, &vault, QA_SECRET_ONE, || {
            vault.put(
                &scope,
                &guard,
                &Secret::new(QA_SECRET_ONE.as_bytes().to_vec())?,
            )
        });
        assert_eq!(result, Err(super::DesktopError("referencesRemain")));
        assert_eq!(vault.owned_references(&scope).unwrap(), [guard]);
        std::fs::remove_dir_all(root.path()).unwrap();
    }

    #[test]
    fn failed_bound_read_before_or_after_handoff_cleans_acknowledged_write() {
        use super::{DesktopError, Result};
        use crate::credentialed_channels::{
            vault::{CredentialBinding, Secret, VaultScope},
            vault_fake::FakeVault,
        };
        use std::sync::atomic::{AtomicBool, Ordering};
        struct FailedRead(FakeVault, AtomicBool);
        impl CredentialVault for FailedRead {
            fn put_bound(
                &self,
                s: &VaultScope,
                r: &str,
                b: &CredentialBinding,
                k: &Secret,
            ) -> Result<()> {
                self.0.put_bound(s, r, b, k)
            }
            fn acquire_bound(
                &self,
                s: &VaultScope,
                r: &str,
                b: &CredentialBinding,
            ) -> Result<Secret> {
                if self.1.load(Ordering::Relaxed) {
                    return Err(DesktopError("credentialBindingMismatch"));
                }
                self.0.acquire_bound(s, r, b)
            }
            fn put(&self, _: &VaultScope, _: &str, _: &Secret) -> Result<()> {
                panic!("unbound write")
            }
            fn acquire(&self, _: &VaultScope, _: &str) -> Result<Secret> {
                panic!("unbound read")
            }
            fn remove(&self, scope: &VaultScope, reference: &str) -> Result<()> {
                self.0.remove(scope, reference)
            }
            fn owned_references(&self, scope: &VaultScope) -> Result<Vec<String>> {
                self.0.owned_references(scope)
            }
        }
        for fail_during_setup in [true, false] {
            let (root, vault) = fixture();
            let vault = FailedRead(vault, AtomicBool::new(fail_during_setup));
            let result = super::exercise(&root, &vault, QA_SECRET_ONE, || {
                assert!(!fail_during_setup, "handoff after failed setup");
                select_second(&open(&root)?)?;
                vault.1.store(true, Ordering::Relaxed);
                Ok(())
            });
            let remaining = vault
                .owned_references(&open(&root).unwrap().vault_scope())
                .unwrap();
            std::fs::remove_dir_all(root.path()).unwrap();
            assert_eq!(result, Err(DesktopError("credentialBindingMismatch")));
            assert!(
                remaining.is_empty(),
                "acknowledged reference survived failed read"
            );
        }
    }

    #[test]
    fn window_fixture_commits_before_handoff_and_releases_only_its_item() {
        let (root, vault) = fixture();
        super::exercise(&root, &vault, QA_SECRET_ONE, || {
            let existing = super::exercise(&root, &vault, QA_SECRET_ONE, || {
                panic!("unexpected handoff")
            });
            assert_eq!(existing, Err(super::DesktopError("existingProfile")));
            let p = open(&root)?;
            assert_eq!(p.bootstrap()?.settings.agent_model_id, "synthetic");
            assert_eq!(
                p.catalog()?.current().next().unwrap().channel.models.len(),
                2
            );
            select_second(&p)
        })
        .unwrap();
        assert!(vault
            .owned_references(&open(&root).unwrap().vault_scope())
            .unwrap()
            .is_empty());
        std::fs::remove_dir_all(root.path()).unwrap();
    }
}
