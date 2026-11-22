//! 仅在显式验收构建和测试中使用；输入与目录都来自本轮合成夹具。
use super::{
    catalog::{random_reference, ChannelWrite, CredentialChange, EndpointPolicy},
    vault::{CredentialBinding, CredentialVault, Secret, VaultScope},
};
use crate::{
    desktop_runtime::protocol::{DesktopError, Result},
    formal_platform::{
        credentialed::CredentialedPlatform, protocol::Mutation, HostEnvironment, PlatformRequest,
        TrustedRoot,
    },
};
use serde_json::json;
mod window;

fn fresh_root() -> Result<TrustedRoot> {
    let path = std::fs::canonicalize("/tmp")?.join(format!(
        "tinker-tauri-channels-preview-keychain-{}",
        random_reference()?
    ));
    TrustedRoot::create_channels_temporary(path)
}

fn open(root: &TrustedRoot) -> Result<CredentialedPlatform> {
    CredentialedPlatform::open(
        root,
        EndpointPolicy::Https,
        HostEnvironment::new("darwin", false, false)?,
    )
}

fn check(ok: bool, code: &'static str) -> Result<()> {
    if ok {
        Ok(())
    } else {
        Err(DesktopError(code))
    }
}

struct Run<'a> {
    vault: &'a dyn CredentialVault,
    scope: VaultScope,
    owned: Vec<String>,
}

impl Run<'_> {
    fn stage(
        &mut self,
        p: &CredentialedPlatform,
        op: &str,
        id: &str,
        mutation: &str,
        key: &str,
    ) -> Result<PlatformRequest> {
        eprintln!("Stage synthetic mutation: {mutation}");
        let request = PlatformRequest {
            version: 1,
            channel: op.into(),
            args: vec![
                json!({"channel":{"id":id,"name":"Acceptance","protocol":"openai-chat","baseUrl":"https://keychain.invalid/v1","enabled":true,"models":[{"modelId":"synthetic","label":"Synthetic"},{"modelId":"restart-second","label":"Restart Second"}]},"credential":"keep"}),
            ],
            mutation: Some(Mutation {
                mutation_id: mutation.into(),
                expected_revision: p.bootstrap()?.revision,
            }),
        };
        let staged = p.stage(
            request,
            "acceptance",
            &Secret::new(key.as_bytes().to_vec())?,
            self.vault,
        )?;
        let write: ChannelWrite = serde_json::from_value(staged.args[0].clone())
            .map_err(|_| DesktopError("invalidStageReceipt"))?;
        let CredentialChange::Replace(reference) = write.credential else {
            return Err(DesktopError("invalidStageReceipt"));
        };
        self.owned.push(reference);
        Ok(staged)
    }

    fn read(&self, p: &CredentialedPlatform, id: &str, expected: &str) -> Result<()> {
        let catalog = p.catalog()?;
        let revision = catalog
            .current()
            .find(|r| r.channel.id == id)
            .ok_or(DesktopError("missingSelection"))?;
        check(
            self.owned.contains(&revision.credential_ref),
            "unownedReference",
        )?;
        use std::io::Write;
        let _ = writeln!(std::io::stderr(), "Read bound synthetic channel: {id}");
        let key = self.vault.acquire_bound(
            &self.scope,
            &revision.credential_ref,
            &CredentialBinding::new(&self.scope, &revision.channel),
        )?;
        check(
            key.with_bytes(|bytes| bytes == expected.as_bytes()),
            "credentialMismatch",
        )
    }

    fn cleanup(&self) -> Result<()> {
        let mut result = Ok(());
        for r in &self.owned {
            if let Err(e) = self.vault.remove(&self.scope, r) {
                if result.is_ok() {
                    result = Err(e);
                }
            }
        }
        result?;
        check(
            self.vault.owned_references(&self.scope)?.is_empty(),
            "referencesRemain",
        )
    }

    fn scenario(
        &mut self,
        root: &TrustedRoot,
        p: CredentialedPlatform,
        first: &str,
        second: &str,
    ) -> Result<()> {
        let create = self.stage(&p, "channel:create", "first", "create", first)?;
        commit(&p, create)?;
        self.read(&p, "first", first)?;
        let guard = self.stage(&p, "channel:create", "guard", "guard", first)?;
        commit(&p, guard)?;
        let abandoned = self.stage(&p, "channel:update", "first", "abandon", second)?;
        drop(p);
        let p = open(root)?;
        check(
            p.vault_scope().namespace() == self.scope.namespace(),
            "namespaceChanged",
        )?;
        let snapshot = p.bootstrap()?;
        check(
            snapshot.revision == 2
                && snapshot.settings.agent_channel_id == "first"
                && snapshot.settings.agent_model_id == "synthetic",
            "selectionChanged",
        )?;
        check(
            matches!(
                p.prepare(abandoned, "acceptance"),
                Err(DesktopError("stageMissing"))
            ),
            "abandonedStageAccepted",
        )?;
        self.read(&p, "first", first)?;
        let rotate = self.stage(&p, "channel:update", "first", "rotate", second)?;
        commit(&p, rotate.clone())?;
        drop(p);
        let p = open(root)?;
        check(
            p.vault_scope().namespace() == self.scope.namespace(),
            "namespaceChanged",
        )?;
        eprintln!("Replay committed mutation after store reopen");
        let replay = p.prepare(rotate, "reopened")?;
        check(replay.is_replay(), "duplicateCommit")?;
        let reply = p.commit(replay, |_| Err(DesktopError("duplicateExecution")))?;
        check(reply.revision == 3, "unexpectedRevision")?;
        self.read(&p, "first", second)?;
        commit(
            &p,
            PlatformRequest {
                version: 1,
                channel: "channel:delete".into(),
                args: vec![json!("first")],
                mutation: Some(Mutation {
                    mutation_id: "delete".into(),
                    expected_revision: 3,
                }),
            },
        )?;
        drop(p);
        let p = open(root)?;
        let snapshot = p.bootstrap()?;
        check(
            snapshot.revision == 4
                && snapshot.settings.agent_channel_id == "guard"
                && p.catalog()?.current().count() == 1,
            "deleteChangedGuard",
        )?;
        self.read(&p, "guard", first)
    }
}

fn commit(p: &CredentialedPlatform, request: PlatformRequest) -> Result<()> {
    let prepared = p.prepare(request, "acceptance")?;
    p.commit(prepared, |_| Ok(())).map(|_| ())
}

fn exercise(
    root: &TrustedRoot,
    vault: &dyn CredentialVault,
    first: &str,
    second: &str,
) -> Result<()> {
    let p = open(root)?;
    let scope = p.vault_scope();
    check(p.bootstrap()?.revision == 0, "existingProfile")?;
    eprintln!("Checking fresh synthetic service");
    check(
        vault.owned_references(&scope)?.is_empty(),
        "nonemptyService",
    )?;
    let mut run = Run {
        vault,
        scope,
        owned: vec![],
    };
    if let Err(error) = run.scenario(root, p, first, second) {
        // 失败时保留包括当前有效引用在内的完整现场，避免破坏后续恢复。
        eprintln!("Lifecycle failed: {error}. Preserved synthetic profile and referenced items.");
        return Err(error);
    }
    eprintln!(
        "Cleaning {} acknowledged test reference(s)",
        run.owned.len()
    );
    let cleanup = run.cleanup();
    if let Err(e) = cleanup {
        eprintln!("Exact-reference cleanup incomplete: {e}");
    }
    cleanup
}

#[cfg(all(
    target_os = "macos",
    feature = "keychain-acceptance",
    not(feature = "formal-native-qa")
))]
pub(crate) fn command() -> Option<Result<()>> {
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--accept-synthetic-keychain")) {
        return None;
    }
    match (args.next(), args.next()) {
        (None, None) => Some(native()),
        (Some(mode), None) if mode == "--window-restart" => Some(window::native()),
        _ => None,
    }
}

#[cfg(all(
    target_os = "macos",
    feature = "keychain-acceptance",
    not(feature = "formal-native-qa")
))]
fn native() -> Result<()> {
    let root = fresh_root()?;
    eprintln!("Synthetic profile: {}", root.path().display());
    let result = exercise(
        &root,
        &super::vault_host::HelperVault,
        &random_reference()?,
        &random_reference()?,
    );
    if result.is_ok() {
        std::fs::remove_dir_all(root.path())?;
        println!("PASS: Keychain lifecycle, store reopen, receipt replay, scoped cleanup");
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::credentialed_channels::vault_fake::{FakeVault, QA_SECRET_ONE, QA_SECRET_TWO};
    pub(super) fn fixture() -> (TrustedRoot, FakeVault) {
        let root = fresh_root().unwrap();
        let path = root.path().join("qa-vault");
        use std::os::unix::fs::DirBuilderExt;
        std::fs::DirBuilder::new()
            .mode(0o700)
            .create(&path)
            .unwrap();
        let vault = FakeVault::open(path).unwrap();
        (root, vault)
    }
    #[test]
    fn staged_rotation_ack_loss_reopen_and_exact_cleanup() {
        let (root, vault) = fixture();
        let result = exercise(&root, &vault, QA_SECRET_ONE, QA_SECRET_TWO);
        let remaining = std::fs::read_dir(root.path().join("qa-vault"))
            .unwrap()
            .count();
        std::fs::remove_dir_all(root.path()).unwrap();
        result.unwrap();
        assert_eq!(remaining, 0);
    }
    // 第二次实际写入成功后模拟丢失应答。保留现场，重开时只能采用已提交的引用。
    struct LoseAck(FakeVault);
    impl CredentialVault for LoseAck {
        fn put_bound(
            &self,
            s: &VaultScope,
            r: &str,
            b: &CredentialBinding,
            k: &Secret,
        ) -> Result<()> {
            self.0.put_bound(s, r, b, k)?;
            if self.0.owned_references(s)?.len() == 2 {
                return Err(DesktopError("vaultWriteUncertain"));
            }
            Ok(())
        }
        fn acquire_bound(&self, s: &VaultScope, r: &str, b: &CredentialBinding) -> Result<Secret> {
            self.0.acquire_bound(s, r, b)
        }
        fn put(&self, _: &VaultScope, _: &str, _: &Secret) -> Result<()> {
            panic!("unbound write")
        }
        fn acquire(&self, _: &VaultScope, _: &str) -> Result<Secret> {
            panic!("unbound read")
        }
        fn owned_references(&self, s: &VaultScope) -> Result<Vec<String>> {
            self.0.owned_references(s)
        }
        fn remove(&self, s: &VaultScope, r: &str) -> Result<()> {
            self.0.remove(s, r)
        }
    }

    #[test]
    fn lost_vault_reply_preserves_committed_key_and_never_adopts_unknown_reference() {
        let (root, vault) = fixture();
        let vault = LoseAck(vault);
        assert_eq!(
            exercise(&root, &vault, QA_SECRET_ONE, QA_SECRET_TWO),
            Err(DesktopError("vaultWriteUncertain"))
        );
        let reopened = open(&root).unwrap();
        assert_eq!(reopened.bootstrap().unwrap().revision, 1);
        let catalog = reopened.catalog().unwrap();
        assert_eq!(catalog.channels.len(), 1);
        let remaining = vault.owned_references(&reopened.vault_scope()).unwrap();
        assert_eq!(remaining.len(), 2);
        let current = catalog.current().next().unwrap();
        assert!(remaining.contains(&current.credential_ref));
        assert_eq!(
            reopened.bootstrap().unwrap().settings.agent_channel_id,
            "first"
        );
        let scope = reopened.vault_scope();
        let restored = vault
            .acquire_bound(
                &scope,
                &current.credential_ref,
                &CredentialBinding::new(&scope, &current.channel),
            )
            .unwrap();
        assert!(restored.with_bytes(|bytes| bytes == QA_SECRET_ONE.as_bytes()));
        std::fs::remove_dir_all(root.path()).unwrap();
    }
}
