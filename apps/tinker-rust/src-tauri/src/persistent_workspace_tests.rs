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
        Self(std::env::temp_dir().join(format!(
            "tinker-adapter-fixture-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        )))
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
#[test]
fn old_snapshot_fields_and_commands_remain_compatible_after_restart() {
    let fixture = Fixture::new();
    let mut app = PersistentWorkspace::open(&fixture.0).unwrap();
    let input = "  中文\n🚀  ";
    app.save(input.into()).unwrap();
    drop(app);
    let value = serde_json::to_value(
        PersistentWorkspace::open(&fixture.0)
            .unwrap()
            .snapshot()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(value["protocolVersion"], 1);
    assert_eq!(value["draft"], input);
    assert_eq!(value["storageKind"], "file");
    assert_eq!(value["revision"], 1);
    assert!(value["architecture"].is_string());
}
#[test]
fn unavailable_model_and_blank_input_still_persist_before_returning_old_error() {
    let fixture = Fixture::new();
    let mut app = PersistentWorkspace::open(&fixture.0).unwrap();
    assert_eq!(app.submit("task".into()), Err(AppError::ModelNotMigrated));
    assert_eq!(app.snapshot().unwrap().draft, "task");
    assert_eq!(app.submit(" \n ".into()), Err(AppError::EmptyInput));
    drop(app);
    let mut reopened = PersistentWorkspace::open(&fixture.0).unwrap();
    assert_eq!(reopened.snapshot().unwrap().draft, " \n ");
    assert_eq!(
        reopened.save("界".repeat(22_000)),
        Err(AppError::InputTooLarge)
    );
    assert_eq!(reopened.snapshot().unwrap().draft, " \n ");
}
#[test]
fn corrupt_primary_is_read_only_until_explicit_recovery() {
    let fixture = Fixture::new();
    let mut app = PersistentWorkspace::open(&fixture.0).unwrap();
    app.save("backup".into()).unwrap();
    app.save("latest".into()).unwrap();
    fs::write(fixture.0.join("draft.json"), b"broken").unwrap();
    let snapshot = app.snapshot().unwrap();
    assert!(snapshot.recovery_required);
    assert_eq!(snapshot.draft, "backup");
    assert_eq!(
        app.save("overwrite".into()),
        Err(AppError::Storage(StoreError::RecoveryRequired))
    );
    assert_eq!(
        app.recover(9),
        Err(AppError::Storage(StoreError::RevisionConflict))
    );
    app.recover(snapshot.revision).unwrap();
    app.save("recovered".into()).unwrap();
    assert_eq!(app.snapshot().unwrap().draft, "recovered");
    let archive = fs::read_dir(&fixture.0)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .find(|path| path.to_string_lossy().contains(".corrupt-"))
        .unwrap();
    assert_eq!(fs::read(archive).unwrap(), b"broken");
}
