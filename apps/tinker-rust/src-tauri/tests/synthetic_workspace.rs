use std::sync::atomic::AtomicBool;
use tinker_rust_foundation::{
    formal_platform::TrustedRoot, synthetic_workspace::SyntheticWorkspace, tool_types::*,
};
#[test]
fn reads_are_repeatable_bounded_and_only_manifest_keys() {
    let dir = std::fs::canonicalize(std::env::temp_dir())
        .unwrap()
        .join(format!(
            "tinker-tauri-formal-preview-fixture-{}",
            std::process::id()
        ));
    let root = TrustedRoot::create_temporary(&dir).unwrap();
    let workspace = SyntheticWorkspace::create(&root).unwrap();
    let mut call = ToolCall {
        round: 0,
        call_id: "read1".into(),
        name: ToolName::WorkspaceRead,
        arguments: ToolArguments {
            path: "notes/intro.txt".into(),
        },
    };
    let first = workspace.execute(&call, &AtomicBool::new(false)).unwrap();
    assert!(first.content.contains("synthetic"));
    assert_eq!(
        first,
        workspace.execute(&call, &AtomicBool::new(false)).unwrap()
    );
    for path in [
        "../intro.txt",
        "/etc/passwd",
        "notes/unknown.txt",
        "notes/intro.txt\0",
    ] {
        call.arguments.path = path.into();
        assert!(workspace.execute(&call, &AtomicBool::new(false)).is_err());
    }
}
#[test]
fn tampering_is_rejected_and_renaming_does_not_reopen_paths() {
    let dir = std::fs::canonicalize(std::env::temp_dir())
        .unwrap()
        .join(format!(
            "tinker-tauri-formal-preview-tamper-{}",
            std::process::id()
        ));
    let root = TrustedRoot::create_temporary(&dir).unwrap();
    let w = SyntheticWorkspace::create(&root).unwrap();
    let path = root
        .path()
        .join(w.workspace_revision())
        .join("notes/intro.txt");
    let call = ToolCall {
        round: 0,
        call_id: "c1".into(),
        name: ToolName::WorkspaceRead,
        arguments: ToolArguments {
            path: "notes/intro.txt".into(),
        },
    };
    let expected = w.execute(&call, &AtomicBool::new(false)).unwrap();
    let moved = path.with_extension("old");
    std::fs::rename(&path, &moved).unwrap();
    std::fs::write(&path, "foreign content").unwrap();
    assert_eq!(w.execute(&call, &AtomicBool::new(false)).unwrap(), expected);
    std::fs::write(moved, "foreign content").unwrap();
    assert!(w.execute(&call, &AtomicBool::new(false)).is_err());
}
