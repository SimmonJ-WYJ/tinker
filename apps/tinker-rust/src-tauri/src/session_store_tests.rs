use super::*;
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};
static NEXT: AtomicU64 = AtomicU64::new(0);
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "tinker-store-fixture-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
#[test]
fn unicode_draft_survives_reopen_and_revision_increases() {
    let fixture = Fixture::new();
    let root = fixture.0.join("store");
    let store = SessionStore::open(&root).unwrap();
    let first = store.save("draft", "  修改这张图\n", 0).unwrap();
    assert_eq!(first.revision, 1);
    drop(store);
    let store = SessionStore::open(&root).unwrap();
    let loaded = store.load("draft").unwrap();
    assert_eq!(loaded.record, first);
    assert!(!loaded.recovery_required);
    assert_eq!(store.save("draft", "", 1).unwrap().revision, 2);
}
#[test]
fn byte_limit_and_stale_revision_preserve_saved_data() {
    let fixture = Fixture::new();
    let store = SessionStore::open(&fixture.0).unwrap();
    store.save("draft", "原稿", 0).unwrap();
    assert_eq!(
        store.save("draft", &"中".repeat(21_846), 1).unwrap_err(),
        StoreError::TooLarge
    );
    assert_eq!(
        store.save("draft", "late", 0).unwrap_err(),
        StoreError::RevisionConflict
    );
    assert_eq!(store.load("draft").unwrap().record.draft, "原稿");
    assert!(store.save("draft", &"x".repeat(MAX_DRAFT_BYTES), 1).is_ok());
}
#[test]
fn truncated_primary_recovers_backup_read_only_until_explicit_repair() {
    let fixture = Fixture::new();
    let store = SessionStore::open(&fixture.0).unwrap();
    store.save("draft", "revision one", 0).unwrap();
    store.save("draft", "revision two", 1).unwrap();
    fs::write(fixture.0.join("draft.json"), b"{truncated").unwrap();
    let recovered = store.load("draft").unwrap();
    assert!(recovered.recovery_required);
    assert_eq!(recovered.record.draft, "revision one");
    assert_eq!(
        store.save("draft", "replacement", 1).unwrap_err(),
        StoreError::RecoveryRequired
    );
    let repaired = store.recover("draft", 1).unwrap();
    assert!(!repaired.recovery_required);
    assert_eq!(repaired.record.draft, "revision one");
    assert!(fs::read_dir(&fixture.0)
        .unwrap()
        .flatten()
        .any(|entry| entry.file_name().to_string_lossy().contains(".corrupt-")));
    assert_eq!(store.save("draft", "new revision", 1).unwrap().revision, 2);
}
#[test]
fn future_version_never_falls_back_or_overwrites() {
    let fixture = Fixture::new();
    let store = SessionStore::open(&fixture.0).unwrap();
    store.save("draft", "one", 0).unwrap();
    store.save("draft", "two", 1).unwrap();
    let future = br#"{"schemaVersion":99,"sessionId":"draft","revision":3,"draft":"future"}"#;
    fs::write(fixture.0.join("draft.json"), future).unwrap();
    assert_eq!(
        store.load("draft").unwrap_err(),
        StoreError::UnsupportedVersion
    );
    assert_eq!(
        store.save("draft", "lost", 2).unwrap_err(),
        StoreError::UnsupportedVersion
    );
    assert_eq!(fs::read(fixture.0.join("draft.json")).unwrap(), future);
}
#[test]
fn corrupt_files_do_not_silently_become_empty_sessions() {
    let fixture = Fixture::new();
    let store = SessionStore::open(&fixture.0).unwrap();
    fs::write(fixture.0.join("draft.json"), b"bad").unwrap();
    fs::write(fixture.0.join("draft.bak"), b"also bad").unwrap();
    assert_eq!(store.load("draft").unwrap_err(), StoreError::Corrupt);
    assert_eq!(fs::read(fixture.0.join("draft.json")).unwrap(), b"bad");
}
#[test]
fn missing_primary_uses_existing_backup_instead_of_empty() {
    let fixture = Fixture::new();
    let store = SessionStore::open(&fixture.0).unwrap();
    store.save("draft", "one", 0).unwrap();
    store.save("draft", "two", 1).unwrap();
    fs::remove_file(fixture.0.join("draft.json")).unwrap();
    let loaded = store.load("draft").unwrap();
    assert!(loaded.recovery_required);
    assert_eq!(loaded.record.draft, "one");
    assert!(!store.load("new-session").unwrap().recovery_required);
}
#[test]
fn orphan_temporary_files_are_not_committed() {
    let fixture = Fixture::new();
    let store = SessionStore::open(&fixture.0).unwrap();
    store.save("draft", "durable", 0).unwrap();
    fs::write(fixture.0.join(".draft.write-interrupted.tmp"), b"{partial").unwrap();
    assert_eq!(store.load("draft").unwrap().record.draft, "durable");
}
#[test]
fn backup_write_failure_leaves_primary_unchanged() {
    let fixture = Fixture::new();
    let store = SessionStore::open(&fixture.0).unwrap();
    store.save("draft", "durable", 0).unwrap();
    fs::create_dir(fixture.0.join("draft.bak")).unwrap();
    assert!(store.save("draft", "not committed", 1).is_err());
    assert_eq!(store.load("draft").unwrap().record.draft, "durable");
}
#[test]
fn store_lock_rejects_second_writer_and_releases_on_drop() {
    let fixture = Fixture::new();
    let first = SessionStore::open(&fixture.0).unwrap();
    assert_eq!(
        SessionStore::open(&fixture.0).unwrap_err(),
        StoreError::Locked
    );
    drop(first);
    assert!(SessionStore::open(&fixture.0).is_ok());
}
#[test]
fn identifiers_cannot_escape_root() {
    let fixture = Fixture::new();
    let store = SessionStore::open(&fixture.0).unwrap();
    for id in ["../outside", "/tmp/other", "a/b", "", ".", "..", "a\\b"] {
        assert_eq!(store.load(id).unwrap_err(), StoreError::UnsafePath);
        assert_eq!(store.save(id, "no", 0).unwrap_err(), StoreError::UnsafePath);
    }
}
#[test]
fn oversized_files_fail_before_json_parsing() {
    let fixture = Fixture::new();
    let store = SessionStore::open(&fixture.0).unwrap();
    fs::write(fixture.0.join("draft.json"), vec![b'x'; MAX_FILE_BYTES + 1]).unwrap();
    assert_eq!(store.load("draft").unwrap_err(), StoreError::TooLarge);
}
#[cfg(unix)]
#[test]
fn symlinked_session_and_root_are_rejected() {
    use std::os::unix::fs::symlink;
    let fixture = Fixture::new();
    let outside = Fixture::new();
    let file = outside.0.join("outside.json");
    fs::write(&file, b"preserve").unwrap();
    let store = SessionStore::open(&fixture.0).unwrap();
    symlink(&file, fixture.0.join("draft.json")).unwrap();
    assert_eq!(store.load("draft").unwrap_err(), StoreError::UnsafePath);
    assert_eq!(fs::read(&file).unwrap(), b"preserve");
    let linked = outside.0.join("link");
    symlink(&fixture.0, &linked).unwrap();
    assert_eq!(
        SessionStore::open(linked).unwrap_err(),
        StoreError::UnsafePath
    );
}
#[test]
fn simultaneous_saves_accept_only_one_expected_revision() {
    use std::sync::{Arc, Barrier};
    let fixture = Fixture::new();
    let store = Arc::new(SessionStore::open(&fixture.0).unwrap());
    let barrier = Arc::new(Barrier::new(3));
    let handles: Vec<_> = ["first", "second"]
        .into_iter()
        .map(|draft| {
            let store = Arc::clone(&store);
            let barrier = Arc::clone(&barrier);
            std::thread::spawn(move || {
                barrier.wait();
                store.save("draft", draft, 0)
            })
        })
        .collect();
    barrier.wait();
    let results: Vec<_> = handles
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .collect();
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|result| matches!(result, Err(StoreError::RevisionConflict)))
            .count(),
        1
    );
    assert_eq!(store.load("draft").unwrap().record.revision, 1);
}
#[test]
fn mismatched_session_record_never_overwrites_original() {
    let fixture = Fixture::new();
    let store = SessionStore::open(&fixture.0).unwrap();
    let bytes = br#"{"schemaVersion":1,"sessionId":"other","revision":1,"draft":"wrong"}"#;
    fs::write(fixture.0.join("draft.json"), bytes).unwrap();
    assert_eq!(
        store.save("draft", "new", 1).unwrap_err(),
        StoreError::Corrupt
    );
    assert_eq!(fs::read(fixture.0.join("draft.json")).unwrap(), bytes);
}
#[cfg(unix)]
#[test]
fn permission_denial_preserves_committed_draft() {
    use std::os::unix::fs::PermissionsExt;
    let fixture = Fixture::new();
    let store = SessionStore::open(&fixture.0).unwrap();
    store.save("draft", "preserved", 0).unwrap();
    fs::set_permissions(&fixture.0, fs::Permissions::from_mode(0o500)).unwrap();
    let result = store.save("draft", "replacement", 1);
    fs::set_permissions(&fixture.0, fs::Permissions::from_mode(0o700)).unwrap();
    assert_eq!(result.unwrap_err(), StoreError::Io);
    assert_eq!(store.load("draft").unwrap().record.draft, "preserved");
}
#[test]
fn child_process_exits_without_drop() {
    let Some(root) = std::env::var_os("TINKER_STORE_LOCK_FIXTURE") else {
        return;
    };
    let store = SessionStore::open(PathBuf::from(root)).unwrap();
    store
        .save("draft", "committed before process exit", 0)
        .unwrap();
    // 只退出隔离测试子进程，故意跳过 Drop，验证操作系统释放文件锁。
    std::process::exit(0);
}
#[test]
fn committed_record_and_lock_survive_process_exit_without_drop() {
    let fixture = Fixture::new();
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "session_store::tests::child_process_exits_without_drop",
        ])
        .env("TINKER_STORE_LOCK_FIXTURE", &fixture.0)
        .status()
        .unwrap();
    assert!(status.success());
    let store = SessionStore::open(&fixture.0).unwrap();
    assert_eq!(
        store.load("draft").unwrap().record.draft,
        "committed before process exit"
    );
}
