use super::*;
use crate::electron_import::SourceProject;
fn project(id: &str, name: &str) -> SourceProject {
    SourceProject {
        source_project_id: id.into(),
        name: name.into(),
        created_at: 10,
        updated_at: 20,
        has_directory_hint: true,
    }
}
#[test]
fn imported_project_identity_survives_reimport_orphan_promotion_directory_move_and_restart() {
    let base = std::env::temp_dir().canonicalize().unwrap();
    let tag = crate::credentialed_channels::catalog::random_reference().unwrap();
    let path = base.join(format!("tinker-tauri-formal-preview-test-project-{tag}"));
    let root = TrustedRoot::create_temporary(path.clone()).unwrap();
    let open = || {
        FormalPlatform::open(
            &root,
            &local_mock_profiles("http://127.0.0.1:23456/v1/chat/completions").unwrap(),
            HostEnvironment::new("darwin", false, false).unwrap(),
        )
        .unwrap()
    };
    let p = open();
    let legacy = path.join("formal-platform-v1/snapshot.json");
    let before = std::fs::read(&legacy).unwrap();
    let refs = ["first", "second", "lost"].map(str::to_owned).into();
    let projects = vec![project("first", "Same"), project("second", "Same")];
    let catalog = p.import_projects(&projects, &refs).unwrap();
    assert_eq!(catalog.imported, 3);
    let first = &catalog.ids["first"];
    let second = &catalog.ids["second"];
    let lost = &catalog.ids["lost"];
    assert_eq!(p.rename_project(first, "Same").unwrap().id, *first);
    assert_ne!(first, second);
    assert_ne!(first, lost);
    assert_eq!(
        p.project_workspace(first)
            .unwrap()
            .directory_status
            .as_deref(),
        Some("unbound")
    );
    assert_eq!(
        p.project_workspace(lost).unwrap().project_origin.as_deref(),
        Some("orphan")
    );
    assert_eq!(p.import_projects(&projects, &refs).unwrap().imported, 0);
    assert_eq!(
        p.import_projects(&[project("lost", "Recovered title")], &refs)
            .unwrap()
            .updated,
        1
    );
    assert_eq!(
        p.project_workspace(lost).unwrap().project_origin.as_deref(),
        Some("imported")
    );
    let folder = base.join(format!("tinker-qa-picked-{tag}"));
    std::fs::create_dir(&folder).unwrap();
    let identity = super::project_catalog::directory_identity(&folder).unwrap();
    assert_eq!(
        p.bind_project_folder(first, &folder, identity)
            .unwrap()
            .directory_status
            .as_deref(),
        Some("bound")
    );
    assert_eq!(
        p.project_workspace(second)
            .unwrap()
            .directory_status
            .as_deref(),
        Some("unbound")
    );
    assert!(!serde_json::to_string(&p.bootstrap().unwrap())
        .unwrap()
        .contains(folder.to_str().unwrap()));
    // 本机改名/绑定与源元数据分开；更新目录提示不撤销用户明确选择。
    p.rename_project(first, "My local title").unwrap();
    let mut updated = project("first", "Renamed upstream");
    updated.updated_at = 22;
    assert_eq!(
        p.import_projects(&[updated.clone()], &refs)
            .unwrap()
            .updated,
        1
    );
    updated.has_directory_hint = false;
    assert_eq!(
        p.import_projects(&[updated.clone()], &refs)
            .unwrap()
            .updated,
        1
    );
    assert_eq!(p.import_projects(&[updated], &refs).unwrap().updated, 0);
    let after = p.project_workspace(first).unwrap();
    assert_eq!(after.name, "My local title");
    assert_eq!(after.has_directory_hint, Some(false));
    assert_eq!(after.directory_status.as_deref(), Some("bound"));
    let moved = folder.with_extension("moved");
    std::fs::rename(&folder, &moved).unwrap();
    std::fs::create_dir(&folder).unwrap();
    assert_eq!(
        p.project_workspace(first)
            .unwrap()
            .directory_status
            .as_deref(),
        Some("unavailable")
    );
    assert!(p.bind_project_folder(first, &folder, identity).is_err());
    assert!(p
        .bind_project_folder(
            first,
            &path,
            super::project_catalog::directory_identity(&path).unwrap()
        )
        .is_err());
    drop(p);
    let p = open();
    assert_eq!(p.bootstrap().unwrap().workspaces.len(), 4);
    assert_eq!(
        p.project_workspace(first)
            .unwrap()
            .directory_status
            .as_deref(),
        Some("unavailable")
    );
    assert_eq!(std::fs::read(legacy).unwrap(), before);
    drop(p);
    std::fs::remove_dir(&moved).unwrap();
    std::fs::remove_dir(&folder).unwrap();
    std::fs::remove_dir_all(path).unwrap();
}

#[test]
fn uncertain_first_project_commit_freezes_current_writer_and_reopens_only_the_published_copy() {
    let path = std::env::temp_dir().canonicalize().unwrap().join(format!(
        "tinker-tauri-formal-preview-test-project-uncertain-{}",
        crate::credentialed_channels::catalog::random_reference().unwrap()
    ));
    let root = TrustedRoot::create_temporary(path.clone()).unwrap();
    let open = || {
        FormalPlatform::open(
            &root,
            &local_mock_profiles("http://127.0.0.1:23456/v1/chat/completions").unwrap(),
            HostEnvironment::new("darwin", false, false).unwrap(),
        )
        .unwrap()
    };
    let p = open();
    let legacy = path.join("formal-platform-v1/snapshot.json");
    let before = std::fs::read(&legacy).unwrap();
    tests::fail_after_rename(&p);
    assert_eq!(p.create_project("First", None).unwrap_err().0, "storeIo");
    assert_eq!(p.bootstrap().unwrap().workspaces.len(), 1);
    assert_eq!(
        p.create_project("Never acknowledged", None).unwrap_err().0,
        "recoveryRequired"
    );
    drop(p);
    let p = open();
    assert_eq!(p.bootstrap().unwrap().workspaces.len(), 2);
    assert_eq!(p.bootstrap().unwrap().workspaces[1].name, "First");
    assert_eq!(std::fs::read(legacy).unwrap(), before);
    drop(p);
    std::fs::remove_dir_all(path).unwrap();
}

#[test]
fn unsafe_project_is_excluded_without_exposing_its_identity_or_changing_unrelated_projects() {
    let path = std::env::temp_dir().canonicalize().unwrap().join(format!(
        "tinker-tauri-formal-preview-test-reject-project-{}",
        crate::credentialed_channels::catalog::random_reference().unwrap()
    ));
    let root = TrustedRoot::create_temporary(path.clone()).unwrap();
    let p = FormalPlatform::open(
        &root,
        &local_mock_profiles("http://127.0.0.1:23456/v1/chat/completions").unwrap(),
        HostEnvironment::new("darwin", false, false).unwrap(),
    )
    .unwrap();
    let projects = [
        project("safe", "Readable"),
        project("sensitive-name", MOCK_KEY),
        project(MOCK_KEY, "Sensitive id"),
    ];
    let refs = ["safe", "sensitive-name", MOCK_KEY, "orphan"]
        .map(str::to_owned)
        .into();
    let result = p.import_projects(&projects, &refs).unwrap();
    assert_eq!(result.imported, 2);
    assert_eq!(result.rejected, 2);
    assert!(!result.ids.contains_key(MOCK_KEY));
    assert!(!result.ids.contains_key("sensitive-name"));
    assert!(result.ids.contains_key("orphan"));
    assert!(result.ids.contains_key("safe"));
    let saved =
        std::fs::read_to_string(path.join("formal-project-platform-v1/snapshot.json")).unwrap();
    assert!(!saved.contains(MOCK_KEY));
    assert!(!saved.contains("sensitive-name"));
    drop(p);
    std::fs::remove_dir_all(path).unwrap();
}
