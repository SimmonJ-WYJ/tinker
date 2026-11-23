use super::storage::{project_name, record_name, slot};
use super::*;
use std::fs::{self, File};
use std::path::PathBuf;
fn project_path(root: &TrustedRoot, workspace: &str) -> Result<PathBuf> {
    Ok(root.path().join(project_name(workspace)?))
}
#[cfg(unix)]
use std::os::unix::fs::symlink;

struct Fixture(TrustedRoot);

impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "tinker-tauri-formal-preview-documents-{}",
            crate::credentialed_channels::catalog::random_reference().unwrap()
        ));
        Self(TrustedRoot::create_temporary(path).unwrap())
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(self.0.path()).unwrap();
    }
}

fn selection(summary: &DocumentSummary, start_line: usize, end_line: usize) -> DocumentSelection {
    DocumentSelection {
        document_id: summary.document_id.clone(),
        start_line,
        end_line,
    }
}

#[test]
fn imports_only_selected_text_and_resolves_immutable_one_based_lines_after_restart() {
    let f = Fixture::new();
    let file = f.0.path().join("一期 notes.MD");
    fs::write(&file, "\u{feff}heading\r\nselected 中文\r\nlast\n").unwrap();
    let doc = import_selected(
        &f.0,
        "project-A",
        "一期 notes.MD",
        &fs::read(&file).unwrap(),
    )
    .unwrap();
    fs::remove_file(file).unwrap();
    let reopened = TrustedRoot::open_temporary(f.0.path()).unwrap();
    assert_eq!(
        list(&reopened, "project-A").unwrap(),
        std::slice::from_ref(&doc)
    );
    let excerpt = read(&reopened, "project-A", &selection(&doc, 2, 2)).unwrap();
    assert_eq!(excerpt.document, doc);
    assert_eq!((excerpt.start_line, excerpt.end_line), (2, 2));
    assert_eq!(excerpt.text, "selected 中文");
    assert_eq!(doc.line_count, 3);
    assert!(list(&reopened, "project-a").unwrap().is_empty());
    assert_eq!(
        read(&reopened, "project-a", &selection(&doc, 1, 1))
            .unwrap_err()
            .0,
        "documentNotFound"
    );
}

#[test]
fn repeat_import_reuses_snapshot_but_changed_selection_keeps_old_reference() {
    let f = Fixture::new();
    let root = &f.0;
    let first = import_selected(root, "p", "notes.txt", b"first").unwrap();
    let dir = project_path(root, "p").unwrap();
    crate::formal_platform::store::write_new(&dir.join(PENDING), b"incomplete").unwrap();
    assert_eq!(list(root, "p").unwrap(), std::slice::from_ref(&first));
    assert_eq!(
        import_selected(root, "p", "notes.txt", b"first").unwrap(),
        first
    );
    let next = import_selected(root, "p", "notes.txt", b"second").unwrap();
    assert_ne!(first.document_id, next.document_id);
    assert_eq!(
        read(root, "p", &selection(&first, 1, 1)).unwrap().text,
        "first"
    );
    assert_eq!(list(root, "p").unwrap().len(), 2);
    assert!(!dir.join(PENDING).exists());
}

#[test]
fn rejects_bad_files_and_ranges_without_publishing_any_partial_document() {
    let f = Fixture::new();
    let root = &f.0;
    for (name, bytes, error) in [
        (
            "scan.pdf",
            b"%PDF-1.7".as_slice(),
            "unsupportedDocumentFormat",
        ),
        ("../outside.txt", b"text", "invalidDocument"),
        ("wrong.md", &[0xff], "invalidDocument"),
        ("fake.txt", b"%PDF-1.5", "invalidDocument"),
        ("blank.txt", b" \r\n", "invalidDocument"),
        ("binary.txt", b"a\0b", "invalidDocument"),
    ] {
        assert_eq!(
            import_selected(root, "p", name, bytes).unwrap_err().0,
            error
        );
    }
    for bytes in [
        vec![b'x'; MAX_DOCUMENT_BYTES + 1],
        vec![b'x'; MAX_LINE_BYTES + 1],
        b"a\n".repeat(MAX_DOCUMENT_LINES + 1),
    ] {
        assert_eq!(
            import_selected(root, "p", "limit.txt", &bytes)
                .unwrap_err()
                .0,
            "documentTooLarge"
        );
    }
    assert!(list(root, "p").unwrap().is_empty());
    assert!(!project_path(root, "p").unwrap().exists());
    let doc = import_selected(root, "p", "long.txt", &b"hello\n".repeat(100)).unwrap();
    for (start, end) in [(0, 1), (5, 2), (100, 101), (1, 81), (1, usize::MAX)] {
        assert_eq!(
            read(root, "p", &selection(&doc, start, end)).unwrap_err().0,
            "invalidDocumentRange"
        );
    }
    let doc = import_selected(
        root,
        "p",
        "wide.txt",
        &(("x".repeat(4200) + "\n").repeat(2)).into_bytes(),
    )
    .unwrap();
    assert_eq!(
        read(root, "p", &selection(&doc, 1, 2)).unwrap_err().0,
        "invalidDocumentRange"
    );
    assert_eq!(
        read(root, "p", &selection(&doc, 2, 2)).unwrap().text.len(),
        4200
    );
}

#[cfg(unix)]
#[test]
fn damaged_or_linked_records_and_path_shaped_identifiers_fail_closed() {
    let f = Fixture::new();
    let root = &f.0;
    assert!(list(root, "../p").is_err());
    let doc = import_selected(root, "p", "a.md", b"safe").unwrap();
    let mut s = selection(&doc, 1, 1);
    s.document_id = "../preview.json".into();
    assert!(read(root, "p", &s).is_err());
    let record = project_path(root, "p")
        .unwrap()
        .join(record_name(slot(&doc.document_id).unwrap()));
    let previous = fs::read_to_string(&record).unwrap();
    fs::write(&record, previous.replace("safe", "fake")).unwrap();
    assert!(read(root, "p", &selection(&doc, 1, 1)).is_err());
    fs::remove_file(&record).unwrap();
    symlink(root.path().join("preview.json"), record).unwrap();
    assert!(list(root, "p").is_err());
}

#[test]
fn quota_allows_retries_at_capacity_and_isolates_other_projects() {
    let f = Fixture::new();
    for i in 0..MAX_PROJECT_DOCUMENTS {
        import_selected(&f.0, "p", &format!("{i}.txt"), b"same").unwrap();
    }
    let last = import_selected(&f.0, "p", "0.txt", b"same").unwrap();
    assert_eq!(last.filename, "0.txt");
    assert_eq!(
        import_selected(&f.0, "p", "extra.txt", b"same")
            .unwrap_err()
            .0,
        "documentQuotaExceeded"
    );
    assert!(import_selected(&f.0, "q", "extra.txt", b"same").is_ok());
}

#[test]
fn project_write_lock_fails_without_publishing_and_retry_succeeds() {
    let f = Fixture::new();
    let root = &f.0;
    let original = import_selected(root, "p", "a.txt", b"unchanged").unwrap();
    let writer = File::open(project_path(root, "p").unwrap()).unwrap();
    writer.try_lock().unwrap();
    assert_eq!(
        import_selected(root, "p", "b.txt", b"new").unwrap_err().0,
        "storeLocked"
    );
    assert_eq!(list(root, "p").unwrap(), [original]);
    drop(writer);
    let b = import_selected(root, "p", "b.txt", b"new").unwrap();
    assert_eq!(read(root, "p", &selection(&b, 1, 1)).unwrap().text, "new");
}

#[test]
fn project_byte_quota_preserves_prior_versions_and_accepts_reimport_at_limit() {
    let f = Fixture::new();
    let root = &f.0;
    let mut line = vec![b'x'; 4095];
    line.push(b'\n');
    let input = line.repeat(MAX_DOCUMENT_BYTES / line.len());
    assert_eq!(input.len(), MAX_DOCUMENT_BYTES);
    let count = MAX_PROJECT_BYTES / input.len();
    for index in 0..count {
        import_selected(root, "p", &format!("{index}.txt"), &input).unwrap();
    }
    assert_eq!(
        import_selected(root, "p", "additional.txt", b"x")
            .unwrap_err()
            .0,
        "documentQuotaExceeded"
    );
    assert!(import_selected(root, "p", "0.txt", &input).is_ok());
    assert_eq!(list(root, "p").unwrap().len(), count);
}

#[test]
fn parent_sync_failure_is_retried_even_after_project_directory_exists() {
    use std::cell::Cell;
    let f = Fixture::new();
    let path = project_path(&f.0, "p").unwrap();
    let calls = Cell::new(0);
    for _ in 0..2 {
        let result = disk::ProjectDir::open_with_sync(&f.0, "p", true, |_| {
            calls.set(calls.get() + 1);
            Err(DesktopError("storeIo"))
        });
        assert!(matches!(result, Err(DesktopError("storeIo"))));
        assert!(path.is_dir());
        assert_eq!(fs::read_dir(&path).unwrap().count(), 0);
    }
    assert_eq!(calls.get(), 2);
    assert!(import_selected(&f.0, "p", "safe.txt", b"ok").is_ok());
}

#[test]
fn swapped_workspace_directory_cannot_redirect_a_held_writer() {
    let f = Fixture::new();
    let original = import_selected(&f.0, "p", "first.txt", b"original").unwrap();
    let writer = disk::ProjectDir::open(&f.0, "p", true).unwrap().unwrap();
    let path = project_path(&f.0, "p").unwrap();
    let detached = f.0.path().join("detached-fixture");
    crate::formal_platform::store::write_new(&path.join(PENDING), b"original pending").unwrap();
    fs::rename(&path, &detached).unwrap();
    fs::create_dir(&path).unwrap();
    fs::write(path.join(PENDING), b"replacement must survive").unwrap();
    assert!(writer.verify_current().is_err());
    assert!(writer.read(&record_name(0)).unwrap().is_some());
    assert!(writer.clear_pending().is_err());
    assert_eq!(
        fs::read(detached.join(PENDING)).unwrap(),
        b"original pending"
    );
    assert_eq!(
        fs::read(path.join(PENDING)).unwrap(),
        b"replacement must survive"
    );
    assert!(writer.publish(&record_name(1), b"not published").is_err());
    assert!(!path.join(record_name(1)).exists());
    assert!(!detached.join(record_name(1)).exists());
    assert!(detached
        .join(record_name(slot(&original.document_id).unwrap()))
        .is_file());
}
