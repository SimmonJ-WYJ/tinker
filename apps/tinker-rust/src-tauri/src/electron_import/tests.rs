use super::*;
use serde_json::{json, Value};
use std::{fs, os::unix::fs::symlink, path::PathBuf};
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let p = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "tinker-import-source-{}",
            crate::credentialed_channels::catalog::random_reference().unwrap()
        ));
        fs::create_dir(&p).unwrap();
        fs::create_dir(p.join("agent-sessions")).unwrap();
        let f = Self(p);
        f.index(json!([{"id":"session-a","sdkSessionId":"sdk-a","title":"Synthetic","createdAt":1,"updatedAt":4}]));
        f
    }
    fn index(&self, rows: Value) {
        self.write(
            "agent-sessions.json",
            &serde_json::to_vec(&json!({"version":1,"sessions":rows})).unwrap(),
        );
    }
    fn write(&self, rel: &str, data: &[u8]) {
        let path = self.0.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, data).unwrap();
    }
    fn lines(&self, rel: &str, rows: Vec<Value>) {
        self.write(
            rel,
            rows.iter()
                .map(|r| format!("{r}\n"))
                .collect::<String>()
                .as_bytes(),
        );
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
#[test]
fn copies_mixed_history_and_only_user_attached_app_owned_files() {
    let f = Fixture::new();
    let blob = b"original UTF-8 note";
    f.write("agent-workspaces/_no-workspace/session-a/roadmap.md", blob);
    let raw="<attached_files>\n- roadmap.md: /old/machine/agent-workspaces/_no-workspace/session-a/roadmap.md\n- private.txt: /somewhere/private.txt\n</attached_files>\n\nUse the note.";
    f.lines("agent-sessions/session-a.jsonl",vec![json!({"role":"user","id":"m1","createdAt":2,"content":raw}),json!({"type":"assistant","uuid":"m2","message":{"content":[{"type":"thinking","thinking":"hidden"},{"type":"text","text":"Summary."}]}}),json!({"type":"system","content":"hidden"})]);
    let batch = read_selected(&f.0).unwrap();
    assert_eq!(batch.sessions.len(), 1);
    let s = &batch.sessions[0];
    assert_eq!(
        s.messages
            .iter()
            .map(|m| m.text.as_str())
            .collect::<Vec<_>>(),
        ["Use the note.", "Summary."]
    );
    assert_eq!(s.attachments.len(), 1);
    assert_eq!(s.attachments[0].bytes, blob);
    assert_eq!(s.messages[0].attachment_ids, [s.attachments[0].id.clone()]);
    assert!(batch.warnings.iter().any(|w| w.code == "unsafeSource"));
    assert_eq!(
        read_selected(&f.0).unwrap().sessions[0].attachments[0].id,
        s.attachments[0].id
    );
}
#[test]
fn sdk_fallback_is_exact_unique_and_only_used_without_primary() {
    let f = Fixture::new();
    let rows = vec![json!({"type":"user","message":{"content":"raw fallback"}})];
    f.lines("sdk-config/projects/-one/sdk-a.jsonl", rows.clone());
    assert_eq!(
        read_selected(&f.0).unwrap().sessions[0].messages[0].text,
        "raw fallback"
    );
    f.lines("sdk-config/projects/-two/sdk-a.jsonl", rows);
    let batch = read_selected(&f.0).unwrap();
    assert!(batch.sessions.is_empty());
    assert!(batch.warnings.iter().any(|w| w.code == "ambiguousHistory"));
    f.lines(
        "agent-sessions/session-a.jsonl",
        vec![json!({"role":"user","content":"primary"})],
    );
    assert_eq!(
        read_selected(&f.0).unwrap().sessions[0].messages[0].text,
        "primary"
    );
}
#[test]
fn symlinked_index_and_hardlinked_transcript_are_never_opened_as_history() {
    let f = Fixture::new();
    f.write("unrelated.txt", br#"{"role":"user","content":"unrelated"}"#);
    fs::hard_link(
        f.0.join("unrelated.txt"),
        f.0.join("agent-sessions/session-a.jsonl"),
    )
    .unwrap();
    let batch = read_selected(&f.0).unwrap();
    assert_eq!(batch.skipped, 1);
    assert!(batch.sessions.is_empty());
    fs::rename(f.0.join("agent-sessions.json"), f.0.join("other.json")).unwrap();
    symlink("other.json", f.0.join("agent-sessions.json")).unwrap();
    assert_eq!(
        read_selected(&f.0).err(),
        Some(DesktopError("unsafeImportPath"))
    );
}

#[test]
fn only_matched_successful_generation_and_user_edit_transfer_the_same_asset() {
    let f = Fixture::new();
    let png = crate::picked_image::encode_png(1, 1, png::ColorType::Rgb, &[4, 8, 12]).unwrap();
    f.write("attachments/session-a/output.png", &png);
    let displayed =
        json!({"localPath":"session-a/output.png","filename":"render.png","mediaType":"image/png"});
    let raw =
        json!({"imageId":"output","generatedImage":displayed,"channelName":"private-fixture"})
            .to_string();
    let mut edit = displayed.clone();
    edit["imageId"] = json!("output");
    f.lines("agent-sessions/session-a.jsonl",vec![
        json!({"type":"user","uuid":"first","timestamp":"2024-03-01T09:00:00.125+09:00","message":{"content":"Draw."}}),
        json!({"type":"user","uuid":"forged","message":{"content":[{"type":"tool_result","tool_use_id":"unknown","content":raw}]}}),
        json!({"type":"assistant","uuid":"calling","message":{"content":[{"type":"tool_use","name":"mcp__asci-image__generate_image","id":"call","input":{"ignored":"true"}}]}}),
        json!({"type":"user","uuid":"r","message":{"content":[{"type":"tool_result","tool_use_id":"call","content":[{"type":"text","text":raw}]}]}}),
        json!({"type":"user","uuid":"again","imageEditReference":edit,"message":{"content":"Edit."}}),
        json!({"type":"user","uuid":"hidden","isSidechain":true,"message":{"content":"hidden"}}),
    ]);
    let b = read_selected(&f.0).unwrap();
    let s = &b.sessions[0];
    assert_eq!(s.messages.len(), 3);
    assert_eq!(s.messages[0].created_at, 1_709_251_200_125);
    assert_eq!(s.messages[1].role, "assistant");
    assert_eq!(s.messages[1].text, "");
    assert_eq!(s.messages[1].attachment_ids, s.messages[2].attachment_ids);
    assert_eq!(s.attachments.len(), 1);
    assert_eq!(s.attachments[0].bytes, png);
    assert!(!serde_json::to_string(s)
        .unwrap()
        .contains("private-fixture"));
}

#[test]
fn project_attachments_require_selected_workspace_and_safe_file_types() {
    let f = Fixture::new();
    f.index(json!([{"id":"session-a","workspaceId":"project","title":"Project","createdAt":1,"updatedAt":3}]));
    f.write(
        "agent-workspaces.json",
        br#"{"version":2,"workspaces":[{"id":"project","slug":"alpha"}]}"#,
    );
    let leaf = "agent-workspaces/alpha/session-a";
    f.write(&format!("{leaf}/notes.txt"), b"text");
    f.write(&format!("{leaf}/bad.md"), &[255, 254]);
    f.write(&format!("{leaf}/CLAUDE.md"), b"not a user attachment");
    f.write(
        "agent-workspaces/beta/session-a/neighbor.txt",
        b"must stay private",
    );
    f.lines("agent-sessions/session-a.jsonl",vec![json!({"role":"user","content":format!("<attached_files>\n- notes.txt: /moved/{leaf}/notes.txt\n- neighbor.txt: /moved/agent-workspaces/beta/session-a/neighbor.txt\n- bad.md: /moved/{leaf}/bad.md\n- CLAUDE.md: /moved/{leaf}/CLAUDE.md\n- binary.pdf: /moved/{leaf}/binary.pdf\n- missing.txt: /moved/{leaf}/missing.txt\n- missing2.txt: /moved/{leaf}/missing2.txt\n</attached_files>\n\n<referenced_directory path=\"private-path\">\n- private-file\n</referenced_directory>\n\nRead.")})]);
    let b = read_selected(&f.0).unwrap();
    let s = &b.sessions[0];
    assert_eq!(s.messages[0].text, "Read.");
    assert_eq!(s.attachments.len(), 1);
    assert_eq!(s.attachments[0].media_type, "text/plain");
    for (code, n) in [
        ("invalidAttachment", 1),
        ("missingAttachment", 2),
        ("unsupportedAttachment", 1),
        ("unsafeSource", 2),
    ] {
        assert_eq!(
            b.warnings.iter().find(|w| w.code == code).map(|w| w.count),
            Some(n)
        );
    }
}
#[test]
fn limit_version_truncation_and_unsafe_ids_are_explicit() {
    let f = Fixture::new();
    f.index(json!([{"id":"../../other"},{"id":"session-a","title":"Indexed","createdAt":1,"updatedAt":2}]));
    f.write(
        "agent-sessions/session-a.jsonl",
        b"{\"role\":\"user\",\"content\":\"kept\",\"id\":\"a\"}\n{\"partial\":",
    );
    let b = read_selected(&f.0).unwrap();
    assert_eq!(b.skipped, 1);
    assert_eq!(b.sessions[0].messages[0].text, "kept");
    assert!(b.warnings.iter().any(|w| w.code == "incompleteHistory"));
    assert!(!serde_json::to_string(&b.warnings).unwrap().contains("../"));
    f.lines(
        "agent-sessions/session-a.jsonl",
        vec![json!({"role":"user","content":"x".repeat(crate::run_types::MAX_INPUT_BYTES+1)})],
    );
    let b = read_selected(&f.0).unwrap();
    assert!(b.sessions.is_empty());
    f.write("agent-sessions.json", br#"{"version":2,"sessions":[]}"#);
    assert_eq!(
        read_selected(&f.0).err(),
        Some(DesktopError("unsupportedImportVersion"))
    );
    f.index(Value::Array(vec![Value::Null; 129]));
    assert_eq!(read_selected(&f.0).err(), Some(DesktopError("importLimit")));
}

#[test]
fn selection_identity_is_checked_before_opening_even_the_index() {
    use std::os::unix::fs::MetadataExt;
    let original = Fixture::new();
    let meta = fs::metadata(&original.0).unwrap();
    assert!(read_selected_identity(&original.0, (meta.dev(), meta.ino())).is_ok());
    let swapped = Fixture::new();
    swapped.write("agent-sessions.json", b"not json");
    assert_eq!(
        read_selected_identity(&swapped.0, (meta.dev(), meta.ino())).err(),
        Some(DesktopError("unsafeImportPath"))
    );
}

#[test]
fn traversal_or_symlinked_workspace_attachments_never_leave_the_selected_session() {
    let f = Fixture::new();
    f.write("elsewhere/notes.txt", b"external marker");
    let dir = f.0.join("agent-workspaces/_no-workspace");
    fs::create_dir_all(&dir).unwrap();
    symlink(f.0.join("elsewhere"), dir.join("session-a")).unwrap();
    let content="<attached_files>\n- notes.txt: /old/agent-workspaces/_no-workspace/session-a/notes.txt\n- notes.txt: /old/../agent-workspaces/_no-workspace/session-a/notes.txt\n</attached_files>\n\nDescribe.";
    f.lines(
        "agent-sessions/session-a.jsonl",
        vec![json!({"role":"user","content":content})],
    );
    let b = read_selected(&f.0).unwrap();
    assert!(b.sessions[0].attachments.is_empty());
    assert_eq!(b.sessions[0].messages[0].text, "Describe.");
    assert_eq!(
        b.warnings
            .iter()
            .find(|w| w.code == "unsafeSource")
            .unwrap()
            .count,
        2
    );
}

#[test]
fn raw_fallback_keeps_plain_messages_and_excludes_injected_host_prompts() {
    let f = Fixture::new();
    f.lines("sdk-config/projects/-test/sdk-a.jsonl",vec![
    json!({"type":"user","uuid":"injected","message":{"content":"**Current time: now**\n\n<workspace_state>private host config</workspace_state>\n\nopaque user input"}}),
    json!({"type":"user","uuid":"u","message":{"content":"plain subsequent question"}}),
    json!({"type":"assistant","uuid":"a","message":{"content":[{"type":"text","text":"plain reply"}]}})]);
    let b = read_selected(&f.0).unwrap();
    let s = &b.sessions[0];
    assert_eq!(s.messages.len(), 2);
    assert!(b.warnings.iter().any(|w| w.code == "unsupportedRecord"));
    assert!(!serde_json::to_string(s)
        .unwrap()
        .contains("private host config"));
}

#[test]
fn source_projects_import_from_v1_v2_or_unversioned_without_retaining_directory_paths() {
    for version in [None, Some(1), Some(2)] {
        let f = Fixture::new();
        let mut index = json!({"workspaces":[{"id":"p-1","slug":"first","name":"Same name","createdAt":1,"updatedAt":2},{"id":"p-2","slug":"second","name":"Same name","createdAt":2,"updatedAt":3}]});
        if let Some(n) = version {
            index["version"] = json!(n);
        }
        f.write(
            "agent-workspaces.json",
            &serde_json::to_vec(&index).unwrap(),
        );
        f.write("agent-workspaces/first/config.json",br#"{"permissionMode":"bypassPermissions","attachedDirectories":["/private/never-traverse"]}"#);
        fs::remove_file(f.0.join("agent-sessions.json")).unwrap();
        let b = read_selected(&f.0).unwrap();
        assert!(b.sessions.is_empty());
        assert_eq!(b.projects.len(), 2);
        assert_eq!(
            (
                b.projects[0].name.as_str(),
                b.projects[0].has_directory_hint
            ),
            ("Same name", true)
        );
        assert!(!b.projects[1].has_directory_hint);
        assert_ne!(
            b.projects[0].source_project_id,
            b.projects[1].source_project_id
        );
        let visible = serde_json::to_string(&b.projects).unwrap();
        assert!(!visible.contains("never-traverse"));
        assert!(!visible.contains("permissionMode"));
        assert_eq!(
            fs::read(f.0.join("agent-workspaces.json")).unwrap(),
            serde_json::to_vec(&index).unwrap()
        );
    }
}

#[test]
fn source_projects_keep_dangling_ids_separate_from_global_sessions_and_refuse_ambiguous_disks() {
    let f = Fixture::new();
    let projects = json!({"version":2,"workspaces":[
        {"id":"duplicate","slug":"first","name":"Conflicting","createdAt":1,"updatedAt":1},
        {"id":"duplicate","slug":"second","name":"Other","createdAt":1,"updatedAt":1},
        {"id":"a","slug":"collision","name":"A","createdAt":1,"updatedAt":1},
        {"id":"b","slug":"collision","name":"B","createdAt":1,"updatedAt":1}
    ]});
    f.write(
        "agent-workspaces.json",
        &serde_json::to_vec(&projects).unwrap(),
    );
    f.write(
        "agent-workspaces/collision/config.json",
        br#"{"attachedDirectories":["/never/open/this"]}"#,
    );
    let mut sessions = vec![];
    for (sid, pid) in [
        ("s1", Some("duplicate")),
        ("s2", Some("missing")),
        ("s3", None),
        ("s4", Some("a")),
        ("s5", Some("../unsafe")),
    ] {
        let row = json!({"id":sid,"title":"T","createdAt":1,"updatedAt":2,"workspaceId":pid});
        sessions.push(row);
        f.lines(
            &format!("agent-sessions/{sid}.jsonl"),
            vec![json!({"role":"user","id":"q","content":"Q"})],
        );
    }
    f.index(Value::Array(sessions));
    let b = read_selected(&f.0).unwrap();
    assert_eq!(b.sessions.len(), 4);
    assert_eq!(b.skipped, 1);
    assert!(b.sessions.iter().all(|s| s.source_session_id != "s5"));
    assert!(b.warnings.iter().any(|w| w.code == "unavailableProject"));
    assert_eq!(b.projects.len(), 2);
    assert!(b.projects.iter().all(|p| !p.has_directory_hint));
    assert_eq!(
        b.session_projects.get("s1").map(String::as_str),
        Some("duplicate")
    );
    assert_eq!(
        b.session_projects.get("s2").map(String::as_str),
        Some("missing")
    );
    assert_eq!(b.session_projects.get("s4").map(String::as_str), Some("a"));
    assert!(!b.session_projects.contains_key("s3"));
    assert!(!b.session_projects.contains_key("s5"));
    assert!(b.warnings.iter().any(|w| w.code == "duplicateProject"));
    assert_eq!(
        b.warnings
            .iter()
            .filter(|w| w.code == "missingProject")
            .map(|w| w.count)
            .sum::<usize>(),
        2
    );
}

#[test]
fn source_projects_unresolved_metadata_does_not_change_imported_session_fingerprints() {
    let f = Fixture::new();
    f.index(json!([{"id":"s","workspaceId":"p","title":"Keep me","createdAt":5,"updatedAt":7}]));
    f.lines(
        "agent-sessions/s.jsonl",
        vec![json!({"id":"msg","role":"user","content":"Retain exactly.","createdAt":6})],
    );
    let missing = read_selected(&f.0).unwrap();
    assert!(missing.projects.is_empty());
    let expected=br#"{"sourceSessionId":"s","title":"Keep me","createdAt":5,"updatedAt":7,"archived":false,"pinned":false,"messages":[{"id":"msg","role":"user","text":"Retain exactly.","createdAt":6,"attachmentIds":[]}],"attachments":[]}"#;
    assert_eq!(serde_json::to_vec(&missing.sessions[0]).unwrap(), expected);
    for raw in ["{corrupt", r#"{"version":3,"workspaces":[]}"#] {
        f.write("agent-workspaces.json", raw.as_bytes());
        let b = read_selected(&f.0).unwrap();
        assert!(b.projects.is_empty());
        assert_eq!(b.session_projects, missing.session_projects);
        assert!(b.warnings.iter().any(|v| v.code == "invalidProjectIndex"));
        assert_eq!(serde_json::to_vec(&b.sessions[0]).unwrap(), expected);
    }
    f.write("agent-workspaces.json",br#"{"version":2,"workspaces":[{"id":"p","name":"Repaired name","slug":"its-project","createdAt":1,"updatedAt":2}]}"#);
    let repaired = read_selected(&f.0).unwrap();
    assert_eq!(repaired.projects.len(), 1);
    assert_eq!(repaired.session_projects, missing.session_projects);
    assert_eq!(serde_json::to_vec(&repaired.sessions[0]).unwrap(), expected);
}

#[test]
fn source_projects_refuse_linked_configuration_and_oversized_indexes() {
    let f = Fixture::new();
    let meta = json!({"id":"p","name":"Safe project","slug":"one","createdAt":1,"updatedAt":2});
    f.write(
        "agent-workspaces.json",
        &serde_json::to_vec(&json!({"version":2,"workspaces":[meta.clone()]})).unwrap(),
    );
    f.write(
        "unrelated/config.json",
        br#"{"attachedDirectories":["/outside"]}"#,
    );
    let local = f.0.join("agent-workspaces/one");
    fs::create_dir_all(&local).unwrap();
    symlink(f.0.join("unrelated/config.json"), local.join("config.json")).unwrap();
    let symlinked = read_selected(&f.0).unwrap();
    assert_eq!(symlinked.projects.len(), 1);
    assert!(!symlinked.projects[0].has_directory_hint);
    assert!(symlinked
        .warnings
        .iter()
        .any(|w| w.code == "invalidDirectoryHint"));
    f.write(
        "agent-workspaces.json",
        &serde_json::to_vec(&json!({"version":2,"workspaces":vec![meta;129]})).unwrap(),
    );
    let oversized = read_selected(&f.0).unwrap();
    assert!(oversized.projects.is_empty());
    assert!(oversized
        .warnings
        .iter()
        .any(|w| w.code == "invalidProjectIndex"));
}

#[test]
fn source_projects_enforce_shared_name_and_identifier_limits_per_entry() {
    let f = Fixture::new();
    let long_name = "é".repeat(512);
    let long_id = "z".repeat(128);
    let record = |id: &str, slug: &str, name: &str| json!({"id":id,"name":name,"slug":slug,"createdAt":1,"updatedAt":2});
    let index = json!({"version":2,"workspaces":[record(&long_id,"allowed",&long_name),record("long-name","bad-name",&("ت".repeat(513))),record(&"x".repeat(129),"bad-id","Too-long identifier")]});
    f.write(
        "agent-workspaces.json",
        &serde_json::to_vec(&index).unwrap(),
    );
    let b = read_selected(&f.0).unwrap();
    assert_eq!(b.projects.len(), 1);
    assert_eq!(b.projects[0].source_project_id, long_id);
    assert_eq!(b.projects[0].name, long_name);
    assert_eq!(
        b.warnings
            .iter()
            .find(|w| w.code == "invalidProject")
            .unwrap()
            .count,
        2
    );
}
