use super::*;
#[test]
fn credentialed_empty_boot_is_a_real_atomic_platform() {
    let path = std::env::temp_dir().canonicalize().unwrap().join(format!(
        "tinker-tauri-channels-preview-platform-{}",
        std::process::id()
    ));
    let root = TrustedRoot::create_channels_temporary(&path).unwrap();
    let platform = CredentialedPlatform::open(
        &root,
        EndpointPolicy::Https,
        HostEnvironment::new("darwin", false, false).unwrap(),
    )
    .expect("credentialed empty platform must boot");
    let snapshot = platform.bootstrap().unwrap();
    assert!(snapshot.settings.agent_channel_id.is_empty());
    assert!(snapshot.settings.agent_effort.is_empty());
    assert_eq!(platform.channels().unwrap(), json!([]));
    assert!(root
        .path()
        .join("formal-platform-v1/snapshot.json")
        .is_file());
    drop(platform);
    std::fs::remove_dir_all(path).unwrap();
}
use crate::credentialed_channels::vault_fake::{FakeVault, QA_SECRET_ONE, QA_SECRET_TWO};
use std::{
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};
static NEXT: AtomicU64 = AtomicU64::new(0);
struct Fixture {
    path: PathBuf,
    root: TrustedRoot,
    vault: FakeVault,
}
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "tinker-tauri-channels-preview-fault-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let root = TrustedRoot::create_channels_temporary(&path).unwrap();
        let vault_path = path.join("qa-vault");
        std::fs::create_dir(&vault_path).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&vault_path, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        Self {
            path,
            root,
            vault: FakeVault::open(vault_path).unwrap(),
        }
    }
    fn open(&self) -> CredentialedPlatform {
        CredentialedPlatform::open(
            &self.root,
            EndpointPolicy::Https,
            HostEnvironment::new("darwin", false, false).unwrap(),
        )
        .unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}
fn create_request(id: &str, revision: u64) -> PlatformRequest {
    PlatformRequest {
        version: 1,
        channel: "channel:create".into(),
        args: vec![
            json!({"channel":{"id":id,"name":"Synthetic","protocol":"openai-chat","baseUrl":"https://api.example.test/v1","enabled":true,"models":[{"modelId":"model","label":"Model"}]},"credential":"keep"}),
        ],
        mutation: Some(protocol::Mutation {
            mutation_id: format!("create-{id}"),
            expected_revision: revision,
        }),
    }
}
fn secret() -> Secret {
    Secret::new(QA_SECRET_ONE.as_bytes().to_vec()).unwrap()
}
fn save(p: &CredentialedPlatform, f: &Fixture, id: &str, revision: u64) -> PlatformRequest {
    let request = p
        .stage(create_request(id, revision), "doc-one", &secret(), &f.vault)
        .unwrap();
    let prepared = p.prepare(request.clone(), "doc-one").unwrap();
    p.commit(prepared, |_| Ok(())).unwrap();
    request
}
#[test]
fn stage_commit_receipt_and_settings_share_one_durable_authority() {
    let f = Fixture::new();
    let p = f.open();
    let request = save(&p, &f, "one", 0);
    let snap = p.bootstrap().unwrap();
    assert_eq!(snap.settings.agent_channel_id, "one");
    assert_eq!(snap.settings.agent_model_id, "model");
    assert!(snap.settings.agent_effort.is_empty());
    let receipt = p
        .commit(p.prepare(request.clone(), "new-document").unwrap(), |_| {
            panic!("receipt must not reinstall")
        })
        .unwrap();
    assert_eq!(receipt.revision, 1);
    let bytes = std::fs::read_to_string(f.path.join("formal-platform-v1/snapshot.json")).unwrap();
    assert!(bytes.contains("credentialCatalog"));
    assert!(!bytes.contains(QA_SECRET_ONE));
    assert!(!bytes.contains("apiKey"));
    assert!(!format!("{receipt:?}").contains(QA_SECRET_ONE));
    drop(p);
    let p = f.open();
    assert_eq!(p.catalog().unwrap().revisions.len(), 1);
    assert_eq!(
        p.commit(p.prepare(request, "reload").unwrap(), |_| panic!())
            .unwrap()
            .revision,
        1
    );
}
#[test]
fn stages_bind_generation_intent_expiry_and_capacity_before_commit() {
    let f = Fixture::new();
    let p = f.open();
    let request = p
        .stage(create_request("one", 0), "doc-one", &secret(), &f.vault)
        .unwrap();
    assert!(matches!(
        p.prepare(request.clone(), "doc-two"),
        Err(DesktopError("stageMismatch"))
    ));
    let mut changed = request.clone();
    changed.args[0]["channel"]["name"] = json!("Changed");
    assert!(matches!(
        p.prepare(changed, "doc-one"),
        Err(DesktopError("stageMismatch"))
    ));
    {
        let mut i = p.inner.lock().unwrap();
        i.stages.values_mut().next().unwrap().expires = Instant::now() - Duration::from_secs(1);
    }
    assert!(matches!(
        p.prepare(request, "doc-one"),
        Err(DesktopError("stageExpired"))
    ));
    for n in 0..16 {
        p.stage(
            create_request(&format!("c{n}"), 0),
            "doc-one",
            &secret(),
            &f.vault,
        )
        .unwrap();
    }
    assert!(matches!(
        p.stage(create_request("extra", 0), "doc-one", &secret(), &f.vault),
        Err(DesktopError("stageLimit"))
    ));
}
#[test]
fn prewrite_postrename_and_install_failure_freeze_old_receipts() {
    for fault in [0, 1, 2] {
        let f = Fixture::new();
        let p = f.open();
        let old = save(&p, &f, "one", 0);
        let request = p
            .stage(create_request("two", 1), "doc-one", &secret(), &f.vault)
            .unwrap();
        let prepared = p.prepare(request, "doc-one").unwrap();
        if fault == 0 {
            std::fs::write(
                f.path.join("formal-platform-v1/snapshot.pending"),
                b"external candidate",
            )
            .unwrap();
        }
        if fault == 1 {
            p.inner.lock().unwrap().store.fail_after_rename = true;
        }
        assert!(p
            .commit(prepared, |_| if fault == 2 {
                Err(DesktopError("installFailed"))
            } else {
                Ok(())
            })
            .is_err());
        assert!(matches!(
            p.prepare(old, "doc-one"),
            Err(DesktopError("recoveryRequired"))
        ));
        assert!(p.bootstrap().is_ok());
        assert!(p.channels().is_ok());
        assert_eq!(f.vault.owned_references(&p.scope).unwrap().len(), 2);
        if fault != 0 {
            drop(p);
            assert_eq!(f.open().catalog().unwrap().channels.len(), 2);
        }
    }
}
#[test]
fn prepared_mutation_cannot_cross_root_or_outlive_stage() {
    let f = Fixture::new();
    let p = f.open();
    let request = p
        .stage(create_request("one", 0), "doc-one", &secret(), &f.vault)
        .unwrap();
    let prepared = p.prepare(request.clone(), "doc-one").unwrap();
    let other = Fixture::new();
    let q = other.open();
    assert!(
        q.commit(prepared, |_| Ok(())).is_err(),
        "prepared authority must bind root"
    );
    let prepared = p.prepare(request, "doc-one").unwrap();
    {
        let mut i = p.inner.lock().unwrap();
        i.stages.values_mut().next().unwrap().expires = Instant::now() - Duration::from_secs(1);
    }
    assert!(
        p.commit(prepared, |_| Ok(())).is_err(),
        "commit must recheck stage expiry"
    );
}
#[test]
fn provider_change_requires_replacement_and_rotation_keeps_historical_metadata() {
    let f = Fixture::new();
    let p = f.open();
    save(&p, &f, "one", 0);
    let mut update = create_request("one", 1);
    update.channel = "channel:update".into();
    update.mutation.as_mut().unwrap().mutation_id = "rotate".into();
    update.args[0]["channel"]["baseUrl"] = json!("https://other.example.test/v1");
    assert!(matches!(
        p.prepare(update.clone(), "doc-one"),
        Err(DesktopError("credentialReplacementRequired"))
    ));
    let replacement = Secret::new(QA_SECRET_TWO.as_bytes().to_vec()).unwrap();
    let update = p.stage(update, "doc-one", &replacement, &f.vault).unwrap();
    p.commit(p.prepare(update, "doc-one").unwrap(), |_| Ok(()))
        .unwrap();
    assert_eq!(p.catalog().unwrap().revisions.len(), 2);
    let old = p.catalog().unwrap().revisions["revision-create-one"]
        .credential_ref
        .clone();
    f.vault.remove(&p.scope, &old).unwrap();
    drop(p);
    let p = f.open();
    assert_eq!(p.catalog().unwrap().revisions.len(), 2);
}
#[test]
fn unsupported_provider_and_raw_secret_fields_fail_before_vault_or_receipt() {
    let f = Fixture::new();
    let p = f.open();
    let mut request = create_request("one", 0);
    request.args[0]["channel"]["protocol"] = json!("unknown");
    assert!(p.stage(request, "doc", &secret(), &f.vault).is_err());
    let mut request = create_request("one", 0);
    request.args[0]["apiKey"] = json!(QA_SECRET_ONE);
    assert!(p.stage(request, "doc", &secret(), &f.vault).is_err());
    assert!(f.vault.owned_references(&p.scope).unwrap().is_empty());
    assert_eq!(p.bootstrap().unwrap().revision, 0);
}
struct FaultVault {
    code: &'static str,
    count: usize,
    puts: AtomicU64,
}
impl CredentialVault for FaultVault {
    fn put_bound(
        &self,
        s: &VaultScope,
        r: &str,
        _: &crate::credentialed_channels::vault::CredentialBinding,
        k: &Secret,
    ) -> Result<()> {
        self.put(s, r, k)
    }
    fn acquire_bound(
        &self,
        s: &VaultScope,
        r: &str,
        _: &crate::credentialed_channels::vault::CredentialBinding,
    ) -> Result<Secret> {
        self.acquire(s, r)
    }

    fn put(&self, _: &VaultScope, _: &str, _: &Secret) -> Result<()> {
        self.puts.fetch_add(1, Ordering::Relaxed);
        Err(DesktopError(self.code))
    }
    fn acquire(&self, _: &VaultScope, _: &str) -> Result<Secret> {
        Err(DesktopError(self.code))
    }
    fn owned_references(&self, _: &VaultScope) -> Result<Vec<String>> {
        Ok((0..self.count).map(|n| format!("{n:032x}")).collect())
    }
    fn remove(&self, _: &VaultScope, _: &str) -> Result<()> {
        panic!("must not remove")
    }
}
#[test]
fn full_owned_vault_refuses_stage_without_put_and_vault_faults_never_commit() {
    let f = Fixture::new();
    let p = f.open();
    let full = FaultVault {
        code: "unexpectedPut",
        count: 144,
        puts: AtomicU64::new(0),
    };
    assert!(matches!(
        p.stage(create_request("one", 0), "doc", &secret(), &full),
        Err(DesktopError("storageLimit"))
    ));
    assert_eq!(full.puts.load(Ordering::Relaxed), 0);
    for (n, code) in ["credentialMissing", "vaultDenied", "vaultTimeout"]
        .iter()
        .enumerate()
    {
        let v = FaultVault {
            code,
            count: 0,
            puts: AtomicU64::new(0),
        };
        let e = p.stage(
            create_request(&format!("failure{n}"), 0),
            "doc",
            &secret(),
            &v,
        );
        assert!(matches!(e,Err(DesktopError(c)) if c==*code));
        assert_eq!(p.bootstrap().unwrap().revision, 0);
        assert!(p.catalog().unwrap().channels.is_empty());
    }
}
#[test]
fn managed_no_effort_selection_is_explicit_and_persistable() {
    let f = Fixture::new();
    let p = f.open();
    save(&p, &f, "one", 0);
    let request = PlatformRequest {
        version: 1,
        channel: "agent:set-reasoning-effort".into(),
        args: vec![json!(workspace::DEFAULT_WORKSPACE_SLUG), json!("")],
        mutation: Some(protocol::Mutation {
            mutation_id: "effort-none".into(),
            expected_revision: 1,
        }),
    };
    p.commit(p.prepare(request, "doc").unwrap(), |_| Ok(()))
        .expect("explicit no-effort must persist");
    drop(p);
    assert!(f
        .open()
        .bootstrap()
        .unwrap()
        .settings
        .agent_effort
        .is_empty());
}
#[test]
fn future_corrupt_and_partial_catalogs_reject_before_pending_cleanup() {
    for value in [
        json!({"version":2}),
        json!({"version":1,"storeNamespace":"bad"}),
        json!(null),
    ] {
        let f = Fixture::new();
        let p = f.open();
        drop(p);
        let snapshot = f.path.join("formal-platform-v1/snapshot.json");
        let mut state: Value = serde_json::from_slice(&std::fs::read(&snapshot).unwrap()).unwrap();
        state["credentialCatalog"] = value;
        std::fs::write(&snapshot, serde_json::to_vec(&state).unwrap()).unwrap();
        let pending = f.path.join("formal-platform-v1/snapshot.pending");
        store::write_new(&pending, b"unvalidated pending").unwrap();
        assert!(CredentialedPlatform::open(
            &f.root,
            EndpointPolicy::Https,
            HostEnvironment::new("darwin", false, false).unwrap()
        )
        .is_err());
        assert_eq!(std::fs::read(&pending).unwrap(), b"unvalidated pending");
        assert!(f
            .vault
            .owned_references(&VaultScope::new("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into()).unwrap())
            .unwrap()
            .is_empty());
    }
}
#[test]
fn saved_disabled_models_remain_visible_but_cannot_be_selected() {
    let f = Fixture::new();
    let p = f.open();
    let mut request = create_request("one", 0);
    request.args[0]["channel"]["models"][0]["enabled"] = json!(false);
    let request = p
        .stage(request, "doc", &secret(), &f.vault)
        .expect("disabled model metadata must be retained");
    p.commit(p.prepare(request, "doc").unwrap(), |_| Ok(()))
        .unwrap();
    assert!(p.bootstrap().unwrap().settings.agent_model_id.is_empty());
    assert_eq!(p.channels().unwrap()[0]["models"][0]["enabled"], false);
}

#[test]
fn exhausted_receipts_refuse_stage_before_put_without_freezing() {
    let f = Fixture::new();
    let p = f.open();
    let mut i = p.inner.lock().unwrap();
    for n in 0..MAX_RECEIPTS {
        let mut request = create_request("unused", 0);
        request.mutation.as_mut().unwrap().mutation_id = format!("receipt-{n}");
        i.state
            .receipts
            .insert(format!("receipt-{n}"), Receipt::new(request, 1).unwrap());
    }
    drop(i);
    let vault = FaultVault {
        code: "unexpectedPut",
        count: 0,
        puts: AtomicU64::new(0),
    };
    assert!(matches!(
        p.stage(create_request("new", 0), "doc", &secret(), &vault),
        Err(DesktopError("storageLimit"))
    ));
    assert_eq!(vault.puts.load(Ordering::Relaxed), 0);
    assert!(!p.inner.lock().unwrap().frozen);
}

#[test]
fn snapshot_byte_capacity_refuses_put_without_freezing() {
    let f = Fixture::new();
    let p = f.open();
    let avatar = format!("data:image/png;base64,{}", "a".repeat(60000));
    for n in 0..30 {
        let r = PlatformRequest {
            version: 1,
            channel: "user-profile:update".into(),
            args: vec![json!({"avatar":avatar})],
            mutation: Some(protocol::Mutation {
                mutation_id: format!("large-{n}"),
                expected_revision: n,
            }),
        };
        match p.prepare(r, "doc") {
            Ok(prepared) => {
                p.commit(prepared, |_| Ok(())).unwrap();
            }
            Err(DesktopError("storageLimit")) => break,
            Err(e) => panic!("unexpected {}", e.0),
        }
    }
    let revision = p.bootstrap().unwrap().revision;
    assert!(revision > 0 && revision < 30);
    let mut r = create_request("capacity", revision);
    r.args[0]["channel"]["models"] = json!((0..128)
        .map(|n| json!({"modelId":format!("{n}{}","x".repeat(200)),"label":"y".repeat(240)}))
        .collect::<Vec<_>>());
    let vault = FaultVault {
        code: "unexpectedPut",
        count: 0,
        puts: AtomicU64::new(0),
    };
    assert!(matches!(
        p.stage(r, "doc", &secret(), &vault),
        Err(DesktopError("storageLimit"))
    ));
    assert_eq!(vault.puts.load(Ordering::Relaxed), 0);
    assert!(!p.inner.lock().unwrap().frozen);
}

#[test]
fn project_commit_cannot_be_overwritten_by_prepared_channel_and_effort_is_per_workspace() {
    use crate::formal_platform::project_catalog::ProjectCatalog;
    let f = Fixture::new();
    let p = f.open();
    let mut req = create_request("owned", 0);
    req.args[0]["channel"]["models"][0]["supportedEfforts"] = json!(["low", "high"]);
    let staged = p.stage(req, "doc-one", &secret(), &f.vault).unwrap();
    let prepared = p.prepare(staged.clone(), "doc-one").unwrap();
    let first = p.create_project("Synthetic A", None).unwrap();
    assert_eq!(
        p.commit(prepared, |_| panic!("stale catalog must not be installed"))
            .err()
            .unwrap()
            .0,
        "revisionConflict"
    );
    p.commit(p.prepare(staged, "doc-one").unwrap(), |_| Ok(()))
        .unwrap();
    let second = p.create_project("Synthetic B", None).unwrap();
    let read = |platform: &CredentialedPlatform, slug: &str| {
        platform
            .read(PlatformRequest {
                version: 1,
                channel: "agent:get-reasoning-effort".into(),
                args: vec![json!(slug)],
                mutation: None,
            })
            .unwrap()
            .value
    };
    let before = read(&p, &second.slug);
    let effort = PlatformRequest {
        version: 1,
        channel: "agent:set-reasoning-effort".into(),
        args: vec![json!(first.slug), json!("low")],
        mutation: Some(protocol::Mutation {
            mutation_id: "effort".into(),
            expected_revision: 1,
        }),
    };
    p.commit(p.prepare(effort, "doc-one").unwrap(), |_| Ok(()))
        .unwrap();
    assert_eq!(read(&p, &first.slug), "low");
    assert_eq!(read(&p, &second.slug), before);
    drop(p);
    let p = f.open();
    assert_eq!(read(&p, &first.slug), "low");
    assert_eq!(read(&p, &second.slug), before);
    assert_eq!(p.bootstrap().unwrap().workspaces.len(), 3);
}
