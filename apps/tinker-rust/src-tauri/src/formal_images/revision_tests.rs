//! 以合成 PNG 核对分叉边界、同名文件及崩溃恢复后的输入身份。
use super::*;
use std::collections::BTreeSet;

fn complete(
    store: &ImageStore,
    sid: &str,
    request: &str,
    source: Option<&str>,
    color: u8,
) -> ImageAsset {
    let action = if source.is_some() {
        ImageAction::Edit
    } else {
        ImageAction::Generate
    };
    let ImageAdmission::New(job) = store
        .admit_routed(
            sid,
            request,
            "synthetic request",
            source,
            u64::from(color),
            None,
            None,
            &managed_route(action),
        )
        .unwrap()
    else {
        panic!()
    };
    job.finish(Ok((pixel(color), 1, 1)), &AtomicBool::new(false))
        .unwrap()
        .asset
        .unwrap()
}

#[test]
fn revision_of_imported_input_stages_only_exact_png_and_recovers_across_reopen() {
    let root = root();
    let sid = "older";
    let child = "draft";
    let store = ImageStore::open(&root).unwrap();
    let first = store.import_png(sid, "same.png", &pixel(1), 1).unwrap();
    let supplied = store.import_png(sid, "same.png", &pixel(2), 2).unwrap();
    let result = complete(&store, sid, "target", Some(&supplied.id), 3);
    complete(&store, sid, "later", Some(&first.id), 4);
    let edit = store.revision_edit(sid, "target", true).unwrap();
    assert_eq!(edit.input_id, supplied.id);
    assert_eq!(edit.route, managed_route(ImageAction::Edit));
    assert!(store
        .revision_edit("other-project-session", "target", true)
        .is_err());
    assert!(store
        .fork_revision_assets("other-project-session", child, &BTreeSet::new(), &edit)
        .is_err());
    for invalid in ["target", "later"] {
        assert!(store
            .fork_revision_assets(sid, child, &BTreeSet::from([invalid.into()]), &edit)
            .is_err());
        assert!(!store.session(child).unwrap().exists());
    }
    store
        .fork_revision_assets(sid, child, &BTreeSet::new(), &edit)
        .unwrap();
    drop(store);
    let store = ImageStore::open(&root).unwrap();
    store
        .fork_revision_assets(sid, child, &BTreeSet::new(), &edit)
        .unwrap();
    let reference = edit.reference_in(child);
    let (turns, imports) = store.snapshot(child).unwrap();
    assert!(turns.is_empty());
    assert_eq!(imports.len(), 1);
    assert_eq!(imports[0].id, reference.image_id);
    assert_ne!(reference.image_id, supplied.id);
    assert_eq!(
        reference.local_path,
        format!("{child}/{}", reference.filename)
    );
    assert_eq!(reference.display_name.as_deref(), Some("same.png"));
    assert!(reference.source_message_id.is_none());
    assert_eq!(
        store
            .attachment(child, &reference.filename)
            .unwrap()
            .read_bytes()
            .unwrap(),
        pixel(2)
    );
    assert!(store.attachment(child, &result.filename).is_err());
    assert!(store
        .attachment(child, &format!("{}.png", image_id(child, "target")))
        .is_err());
    assert_eq!(store.snapshot(sid).unwrap().0.len(), 2);
    std::fs::write(
        store.session(child).unwrap().join(&reference.filename),
        pixel(1),
    )
    .unwrap();
    assert!(store
        .fork_revision_assets(sid, child, &BTreeSet::new(), &edit)
        .is_err());
    assert!(store
        .attachment(child, &reference.filename)
        .unwrap()
        .read_bytes()
        .is_err());
    assert_eq!(
        store
            .attachment(sid, &supplied.filename)
            .unwrap()
            .read_bytes()
            .unwrap(),
        pixel(2)
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn revision_of_generated_input_requires_its_exact_earlier_receipt_and_child_local_origin() {
    let root = root();
    let store = ImageStore::open(&root).unwrap();
    let generated = complete(&store, "source", "generate", None, 7);
    complete(&store, "source", "target", Some(&generated.id), 8);
    let edit = store.revision_edit("source", "target", true).unwrap();
    assert!(store.revision_edit("source", "generate", true).is_err());
    assert!(store
        .fork_revision_assets("source", "child", &BTreeSet::new(), &edit)
        .is_err());
    let prefix = BTreeSet::from(["generate".into()]);
    store
        .fork_revision_assets("source", "child", &prefix, &edit)
        .unwrap();
    let reference = edit.reference_in("child");
    let (turns, imports) = store.snapshot("child").unwrap();
    assert!(imports.is_empty());
    assert_eq!(turns.len(), 1);
    assert_eq!(turns[0].asset.as_ref().unwrap().id, reference.image_id);
    assert_eq!(
        reference.source_message_id.as_deref(),
        Some("native-image-child-generate-assistant")
    );
    assert_eq!(
        store
            .attachment("child", &reference.filename)
            .unwrap()
            .read_bytes()
            .unwrap(),
        pixel(7)
    );
    let all_history = BTreeSet::from(["generate".into(), "target".into()]);
    store
        .fork_assets("source", "passive", &all_history)
        .unwrap();
    assert!(store.revision_edit("passive", "target", true).is_err());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn revision_rejects_ambiguous_source_indexes_or_changed_input_bytes_before_install() {
    let root = root();
    let store = ImageStore::open(&root).unwrap();
    let reference = store
        .import_png("source", "input.png", &pixel(2), 2)
        .unwrap();
    complete(&store, "source", "target", Some(&reference.id), 5);
    let edit = store.revision_edit("source", "target", true).unwrap();
    let dir = store.session("source").unwrap();
    let mut ambiguous = SessionImages::open(&dir, "source").unwrap();
    ambiguous.imports.push(reference.clone());
    assert!(ambiguous.revision_edit("source", "target", true).is_err());
    std::fs::write(dir.join(&reference.filename), pixel(11)).unwrap();
    assert!(store
        .fork_revision_assets("source", "child", &BTreeSet::new(), &edit)
        .is_err());
    assert!(!store.session("child").unwrap().exists());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn restored_history_cannot_grant_a_route_but_a_new_local_edit_can_be_revised() {
    let original = root();
    let restored = root();
    let another = root();
    let session = "synthetic";
    let source = ImageStore::open(&original).unwrap();
    let input = source
        .import_png(session, "owned.png", &pixel(2), 2)
        .unwrap();
    complete(&source, session, "historic", Some(&input.id), 3);
    let mut budget = usize::MAX;
    let archive = source.export_portable(session, &mut budget).unwrap();
    let store = ImageStore::open(&restored).unwrap();
    store.stage_portable(session, &archive).unwrap();
    assert!(store.revision_edit(session, "historic", false).is_err());
    complete(&store, session, "local", Some(&input.id), 4);
    drop(store);
    let store = ImageStore::open(&restored).unwrap();
    assert!(store.revision_edit(session, "local", false).is_ok());
    assert!(store.revision_edit(session, "historic", false).is_err());
    let again = store.export_portable(session, &mut budget).unwrap();
    let receiver = ImageStore::open(&another).unwrap();
    receiver.stage_portable(session, &again).unwrap();
    assert!(receiver.revision_edit(session, "local", false).is_err());
    std::fs::write(
        store
            .session(session)
            .unwrap()
            .join("local-routed-boundary-v1.json"),
        b"broken",
    )
    .unwrap();
    assert!(store.revision_edit(session, "local", false).is_err());
    assert_eq!(store.history(session).unwrap().len(), 2);
    for dir in [original, restored, another] {
        std::fs::remove_dir_all(dir).unwrap();
    }
}
