use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};
use tinker_rust_foundation::{
    history_library::{HistoryLibrary, HistoryReadError},
    session_history::HistoryOptions,
};
static NEXT: AtomicU64 = AtomicU64::new(0);
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!(
            "tinker-history-host-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&p).unwrap();
        Self(p)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn data() -> String {
    (1..=5).map(|i|format!("{}\n",serde_json::json!({"type":"assistant","uuid":format!("fixture-{i}"),"parent_tool_use_id":null,"message":{"content":[{"type":"text","text":format!("fixture text {i}")}]}}))).collect()
}
#[test]
fn sdk_file_is_readonly_and_pages_have_stable_source_cursors() {
    let fixture = Fixture::new();
    let file = fixture.0.join("session-1.jsonl");
    let bytes = data();
    fs::write(&file, &bytes).unwrap();
    let library = HistoryLibrary::new(&fixture.0);
    let page = library
        .read(
            "session-1",
            HistoryOptions {
                limit: 2,
                before_line: None,
            },
        )
        .unwrap();
    assert_eq!(page.protocol_version, 1);
    assert_eq!(page.entries[0].line_number, 4);
    assert_eq!(page.entries[1].text, "fixture text 5");
    let older = library
        .read(
            "session-1",
            HistoryOptions {
                limit: 2,
                before_line: page.next_before_line,
            },
        )
        .unwrap();
    assert_eq!(older.entries[0].line_number, 2);
    assert_eq!(fs::read(&file).unwrap(), bytes.as_bytes());
}
#[test]
fn missing_history_is_not_created_and_invalid_identifiers_cannot_escape_root() {
    let fixture = Fixture::new();
    let missing = fixture.0.join("not-created");
    let library = HistoryLibrary::new(&missing);
    assert_eq!(
        library
            .read("history", HistoryOptions::default())
            .unwrap_err(),
        HistoryReadError::NotFound
    );
    assert!(!missing.exists());
    for id in [
        "",
        "..",
        "../outside",
        "/absolute",
        "name.jsonl",
        "with space",
    ] {
        assert_eq!(
            library.read(id, HistoryOptions::default()).unwrap_err(),
            HistoryReadError::InvalidOptions
        );
    }
    assert_eq!(
        library
            .read(&"x".repeat(65), HistoryOptions::default())
            .unwrap_err(),
        HistoryReadError::InvalidOptions
    );
}
#[test]
fn malformed_content_has_fixed_error_codes_without_private_contents() {
    let fixture = Fixture::new();
    fs::write(fixture.0.join("broken.jsonl"), "private fixture bad JSON\n").unwrap();
    let error = HistoryLibrary::new(&fixture.0)
        .read("broken", HistoryOptions::default())
        .unwrap_err();
    assert_eq!(error, HistoryReadError::Corrupt);
    assert_eq!(error.code(), "historyCorrupt");
    assert!(!format!("{error:?}").contains("private"));
}
#[cfg(unix)]
#[test]
fn symlinked_root_or_source_and_directories_are_rejected() {
    use std::os::unix::fs::symlink;
    let fixture = Fixture::new();
    let real = fixture.0.join("real");
    fs::create_dir(&real).unwrap();
    fs::write(real.join("ok.jsonl"), data()).unwrap();
    symlink(&real, fixture.0.join("linked")).unwrap();
    assert_eq!(
        HistoryLibrary::new(fixture.0.join("linked"))
            .read("ok", HistoryOptions::default())
            .unwrap_err(),
        HistoryReadError::UnsafePath
    );
    symlink(real.join("ok.jsonl"), real.join("link.jsonl")).unwrap();
    assert_eq!(
        HistoryLibrary::new(&real)
            .read("link", HistoryOptions::default())
            .unwrap_err(),
        HistoryReadError::UnsafePath
    );
    fs::create_dir(real.join("directory.jsonl")).unwrap();
    assert_eq!(
        HistoryLibrary::new(real)
            .read("directory", HistoryOptions::default())
            .unwrap_err(),
        HistoryReadError::UnsafePath
    );
}
