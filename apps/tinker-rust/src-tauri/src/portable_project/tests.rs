use super::*;
use crate::formal_platform::{self, local_mock_profiles, FormalPlatform, HostEnvironment};
use serde_json::json;
use std::{fs, net::TcpListener};

struct Target(TrustedRoot);
impl Target {
    fn new() -> Self {
        let path = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "tinker-tauri-formal-preview-portable-{}",
            crate::credentialed_channels::catalog::random_reference().unwrap()
        ));
        Self(TrustedRoot::create_temporary(path).unwrap())
    }
    fn open(&self, endpoint: &str) -> (DesktopRuntime, FormalPlatform, ImageStore) {
        let profiles = || local_mock_profiles(endpoint).unwrap();
        let p = FormalPlatform::open(
            &self.0,
            &profiles(),
            HostEnvironment::new("darwin", false, false).unwrap(),
        )
        .unwrap();
        let r = DesktopRuntime::open(self.0.path(), profiles()).unwrap();
        let i = ImageStore::open(self.0.path()).unwrap();
        recover(&self.0, &r, &p, &i).unwrap();
        (r, p, i)
    }
}
impl Drop for Target {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(self.0.path());
    }
}
fn session(r: &DesktopRuntime, workspace: &str, title: &str) {
    let reply=r.dispatch(json!({"version":1,"id":"create","method":"sessions.create","params":{"workspaceId":workspace,"title":title,"reuseDraft":false,"profileId":"local-mock"}})).unwrap();
    assert!(reply.error.is_none(), "{:?}", reply.error);
}
fn fixture(t: &Target, endpoint: &str) -> (String, Vec<u8>) {
    let (r, p, i) = t.open(endpoint);
    let project = p.create_project("归档 fixture", None).unwrap();
    session(&r, &project.id, "source");
    formal_documents::import_selected(
        &t.0,
        &project.id,
        "synthetic.md",
        b"first line\nsecond line",
    )
    .unwrap();
    let archive = export(&t.0, &r, &p, &i, &project.id).unwrap();
    (project.id, archive)
}

#[test]
fn uncertain_catalog_commit_recovers_checked_assets_and_preserves_local_edits() {
    let probe = TcpListener::bind("127.0.0.1:0").unwrap();
    probe.set_nonblocking(true).unwrap();
    let endpoint = format!("http://{}/v1/chat/completions", probe.local_addr().unwrap());
    let source = Target::new();
    let (id, bytes) = fixture(&source, &endpoint);
    let body = std::str::from_utf8(&bytes[HEADER..]).unwrap();
    assert!(!body.contains(source.0.path().to_str().unwrap()));
    assert!(!body.contains(formal_platform::MOCK_KEY));
    assert!(!body.contains(&endpoint));
    let destination = Target::new();
    let (r, p, i) = destination.open(&endpoint);
    let local = p.create_project("Local", None).unwrap();
    session(&r, &local.id, "local session-1");
    formal_platform::tests::fail_after_rename(&p);
    assert_eq!(
        restore(&destination.0, &r, &p, &i, &bytes).unwrap_err().0,
        "storeIo"
    );
    assert!(p.portable_project(&id).unwrap().is_none());
    assert!(r.export_portable_sessions(&id).unwrap().is_empty());
    assert_eq!(r.export_portable_sessions(&local.id).unwrap().len(), 1);
    drop((r, p, i));
    let (r, p, i) = destination.open(&endpoint);
    assert!(p.portable_project(&id).unwrap().is_some());
    let sessions = r.export_portable_sessions(&id).unwrap();
    assert_eq!(sessions.len(), 1);
    assert!(sessions[0].session_id().starts_with("portable-"));
    assert_eq!(
        r.export_portable_sessions(&local.id).unwrap()[0].session_id(),
        "session-1"
    );
    assert_eq!(
        formal_documents::list(&destination.0, &id).unwrap().len(),
        1
    );
    p.rename_project(&id, "Edited locally").unwrap();
    assert!(
        restore(&destination.0, &r, &p, &i, &bytes)
            .unwrap()
            .already_restored
    );
    assert_eq!(
        p.portable_project(&id).unwrap().unwrap().name,
        "Edited locally"
    );
    assert_eq!(
        probe.accept().unwrap_err().kind(),
        io::ErrorKind::WouldBlock
    );
}

#[test]
fn tampering_unsupported_versions_bad_records_and_project_conflicts_are_prepublication_failures() {
    let endpoint = "http://127.0.0.1:23456/v1/chat/completions";
    let source = Target::new();
    let (id, bytes) = fixture(&source, endpoint);
    let dest = Target::new();
    let (r, p, i) = dest.open(endpoint);
    let reject = |bytes: &[u8]| restore(&dest.0, &r, &p, &i, bytes).unwrap_err().0;
    let mut broken = bytes.clone();
    broken[8..12].copy_from_slice(&2u32.to_be_bytes());
    assert_eq!(reject(&broken), "unsupportedVersion");
    broken = bytes.clone();
    broken[HEADER] ^= 1;
    assert_eq!(reject(&broken), "archiveChecksumMismatch");
    let mut raw: serde_json::Value = serde_json::from_slice(&bytes[HEADER..]).unwrap();
    raw["documents"][0]["document"]["filename"] = json!("../escape.md");
    let bad: Payload = serde_json::from_value(raw).unwrap();
    let bad = encode(&bad).unwrap();
    assert_eq!(
        preflight(&dest.0, &r, &p, &i, &bad).err().unwrap().0,
        "corruptSnapshot"
    );
    assert_eq!(reject(&bad), "corruptSnapshot");
    let mut raw: serde_json::Value = serde_json::from_slice(&bytes[HEADER..]).unwrap();
    raw["sessions"][0]["session"]["sessionId"] = json!(format!("portable-{}", "A".repeat(40)));
    let ambiguous = encode(&serde_json::from_value(raw).unwrap()).unwrap();
    assert!(preflight(&dest.0, &r, &p, &i, &ambiguous).is_err());
    assert!(restore(&dest.0, &r, &p, &i, &ambiguous).is_err());
    let mut escaped = vec![0; HEADER];
    let key = formal_platform::MOCK_KEY;
    escaped.extend(format!(r#""\u{:04x}{}""#, key.as_bytes()[0], &key[1..]).bytes());
    assert!(guard_text(&p, &escaped).is_err());
    assert!(p.portable_project(&id).unwrap().is_none());
    assert!(r.export_portable_sessions(&id).unwrap().is_empty());
    assert!(!dest
        .0
        .path()
        .join("portable-project-v1/pending.tinkerproject")
        .exists());
    let full = Target::new();
    let (full_runtime, full_platform, full_images) = full.open(endpoint);
    formal_platform::tests::fill_snapshot_budget(&full_platform);
    assert_eq!(
        preflight(&full.0, &full_runtime, &full_platform, &full_images, &bytes)
            .err()
            .unwrap()
            .0,
        "storageLimit"
    );
    assert_eq!(
        restore(&full.0, &full_runtime, &full_platform, &full_images, &bytes)
            .unwrap_err()
            .0,
        "storageLimit"
    );
    assert!(!full
        .0
        .path()
        .join("portable-project-v1/pending.tinkerproject")
        .exists());
    assert!(full_runtime
        .export_portable_sessions(&id)
        .unwrap()
        .is_empty());
    p.create_project("归档 fixture", None).unwrap();
    assert_eq!(reject(&bytes), "projectConflict");
    let (r, p, i) = source.open(endpoint);
    assert_eq!(
        restore(&source.0, &r, &p, &i, &bytes).unwrap_err().0,
        "projectConflict"
    );
}
