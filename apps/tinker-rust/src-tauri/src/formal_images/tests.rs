use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Read, Write},
    net::TcpListener,
    thread,
};
fn root() -> std::path::PathBuf {
    use std::os::unix::fs::DirBuilderExt;
    static SERIAL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let p = std::env::temp_dir().canonicalize().unwrap().join(format!(
        "tinker-native-images-{}-{}-{}",
        SERIAL.fetch_add(1, Ordering::Relaxed),
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::DirBuilder::new().mode(0o700).create(&p).unwrap();
    p
}
fn pixel(value: u8) -> Vec<u8> {
    let mut bytes = Vec::new();
    let mut encoder = png::Encoder::new(&mut bytes, 1, 1);
    encoder.set_color(png::ColorType::Rgb);
    encoder.set_depth(png::BitDepth::Eight);
    {
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(&[value, 0, 0]).unwrap();
    }
    bytes
}
#[test]
fn generate_edit_failure_and_reopen_post_only_explicit_images() {
    let root = root();
    let server = TcpListener::bind("127.0.0.1:0").unwrap();
    let provider = LoopbackImageProvider::new(server.local_addr().unwrap()).unwrap();
    let runner = thread::spawn(move || {
        for i in 0..3 {
            let (mut sock, _) = server.accept().unwrap();
            let mut reader = BufReader::new(&sock);
            let mut start = String::new();
            reader.read_line(&mut start).unwrap();
            assert!(start.starts_with(if i == 0 {
                "POST /v1/images/generations "
            } else {
                "POST /v1/images/edits "
            }));
            let mut length = 0;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" {
                    break;
                }
                if let Some(n) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    length = n.trim().parse().unwrap();
                }
            }
            let mut body = vec![0; length];
            reader.read_exact(&mut body).unwrap();
            let request: Value = serde_json::from_slice(&body).unwrap();
            if i > 0 {
                assert_eq!(
                    request["referenceImage"]["b64_json"],
                    STANDARD.encode(pixel(1))
                );
            } else {
                assert!(request.get("referenceImage").is_none());
            }
            let response = if i == 2 {
                json!({"error":"hidden upstream details"})
            } else {
                json!({"data":[{"b64_json":STANDARD.encode(pixel(i+1))}]})
            }
            .to_string();
            let status = if i == 2 { "500 Failure" } else { "200 OK" };
            write!(sock,"HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response}",response.len()).unwrap();
        }
    });
    let store = ImageStore::open(&root).unwrap();
    let original = store
        .execute("session", "create", "poster", None, 10, &provider)
        .unwrap()
        .asset
        .unwrap();
    let id = &original.id;
    let new = store
        .execute("session", "edit", "blue", Some(id), 11, &provider)
        .unwrap();
    assert_eq!(
        new.asset.unwrap().reference_ids.as_slice(),
        std::slice::from_ref(id)
    );
    let error = store
        .execute("session", "failed", "fail", Some(id), 12, &provider)
        .unwrap();
    assert_eq!(error.status, ImageStatus::Failed);
    runner.join().unwrap();
    drop(store);
    let reopened = ImageStore::open(&root).unwrap();
    assert_eq!(reopened.history("session").unwrap().len(), 3);
    assert!(reopened.history("other").unwrap().is_empty());
    assert_eq!(
        reopened
            .execute("session", "create", "poster", None, 99, &provider)
            .unwrap()
            .asset
            .unwrap()
            .id,
        *id
    );
    assert!(reopened
        .execute("session", "create", "different", None, 99, &provider)
        .is_err());
    assert!(reopened
        .execute("other", "edit", "blue", Some(id), 99, &provider)
        .is_err());
    assert_eq!(
        reopened
            .attachment("session", &original.filename)
            .unwrap()
            .read_base64()
            .unwrap(),
        STANDARD.encode(pixel(1))
    );
    assert!(reopened.attachment("other", &original.filename).is_err());
    let mut budget = 2 * MAX_PNG;
    let mut archived = reopened.export_portable("session", &mut budget).unwrap();
    archived.remap_session("session", "relocated").unwrap();
    reopened.stage_portable("relocated", &archived).unwrap();
    let restored = reopened.history("relocated").unwrap();
    let original = restored[0].asset.as_ref().unwrap();
    assert_ne!(&original.id, id);
    let edited = restored[1].asset.as_ref().unwrap();
    assert_eq!(edited.reference_ids, std::slice::from_ref(&original.id));
    assert_eq!(restored[2].base_image_id.as_ref(), Some(&original.id));
    assert_eq!(
        reopened
            .attachment("relocated", &edited.filename)
            .unwrap()
            .read_bytes()
            .unwrap(),
        pixel(2)
    );

    drop(reopened);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn invalid_inputs_never_open_an_external_endpoint_or_read_an_arbitrary_file() {
    assert!(LoopbackImageProvider::new("192.0.2.1:3000".parse().unwrap()).is_err());
    assert!(LoopbackImageProvider::new("127.0.0.1:0".parse().unwrap()).is_err());
    let root = root();
    let store = ImageStore::open(&root).unwrap();
    let offline = LoopbackImageProvider::new("127.0.0.1:1".parse().unwrap()).unwrap();
    assert!(store
        .execute("../session", "create", "ok", None, 1, &offline)
        .is_err());
    assert!(store
        .execute("session", "create", " ", None, 1, &offline)
        .is_err());
    assert!(store
        .execute("session", "create", "ok", Some("../image.png"), 1, &offline)
        .is_err());
    assert!(store.history("session").unwrap().is_empty());
    let dir = store.session("session").unwrap();
    assert!(!dir.exists());
    std::os::unix::fs::symlink(root.join("elsewhere"), &dir).unwrap();
    assert!(store.history("session").is_err());
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn restart_maps_an_uncertain_receipt_to_interrupted_without_sending() {
    let root = root();
    let store = ImageStore::open(&root).unwrap();
    let dir = store.session("session").unwrap();
    disk::private_dir(&dir).unwrap();
    let pending = ImageTurn {
        admitted_locally: false,
        route: None,
        request_id: "uncertain".into(),
        prompt: "still accepted".into(),
        base_image_id: None,
        status: ImageStatus::Pending,
        created_at: 10,
        asset: None,
        error: None,
    };
    disk::save_turns(&dir, &[pending], false).unwrap();
    drop(store);
    let store = ImageStore::open(&root).unwrap();
    let offline = LoopbackImageProvider::new("127.0.0.1:1".parse().unwrap()).unwrap();
    assert_eq!(
        store.history("session").unwrap()[0].status,
        ImageStatus::Interrupted
    );
    let replay = store
        .execute("session", "uncertain", "still accepted", None, 12, &offline)
        .unwrap();
    assert_eq!(replay.status, ImageStatus::Interrupted);
    assert_eq!(replay.created_at, 10);
    assert_eq!(store.history("session").unwrap().len(), 1);
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn concurrent_duplicate_does_not_dispatch_twice_and_cancel_drops_pending_http() {
    use std::{
        sync::mpsc,
        time::{Duration, Instant},
    };
    let root = root();
    let store = ImageStore::open(&root).unwrap();
    let server = TcpListener::bind("127.0.0.1:0").unwrap();
    let provider = LoopbackImageProvider::new(server.local_addr().unwrap()).unwrap();
    let cancelled = Arc::new(AtomicBool::new(false));
    let (started, started_rx) = mpsc::channel();
    let worker = thread::spawn({
        let store = store.clone();
        let provider = provider.clone();
        let token = cancelled.clone();
        move || store.execute_cancellable("s", "one", "p", None, 1, &provider, &token)
    });
    let observed = thread::spawn(move || {
        let (sock, _) = server.accept().unwrap();
        let mut headers = BufReader::new(sock);
        let mut n = 0;
        loop {
            let mut line = String::new();
            assert!(headers.read_line(&mut line).unwrap() > 0);
            if line == "\r\n" {
                break;
            }
            if let Some(v) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                n = v.trim().parse().unwrap();
            }
        }
        headers.read_exact(&mut vec![0; n]).unwrap();
        started.send(()).unwrap();
        headers
            .get_ref()
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        assert_eq!(headers.read(&mut [0]).unwrap(), 0);
        server.set_nonblocking(true).unwrap();
        assert_eq!(
            server.accept().unwrap_err().kind(),
            std::io::ErrorKind::WouldBlock
        );
    });
    started_rx.recv_timeout(Duration::from_secs(3)).unwrap();
    assert_eq!(
        store
            .execute("s", "one", "p", None, 2, &provider)
            .unwrap()
            .status,
        ImageStatus::Pending
    );
    assert_eq!(store.history("s").unwrap()[0].status, ImageStatus::Pending);
    let stop = Instant::now();
    cancelled.store(true, Ordering::Release);
    assert_eq!(
        worker.join().unwrap().unwrap().status,
        ImageStatus::Interrupted
    );
    assert!(stop.elapsed() < Duration::from_secs(2));
    observed.join().unwrap();
    let receipt = store.execute("s", "one", "p", None, 3, &provider).unwrap();
    assert_eq!(receipt.status, ImageStatus::Interrupted);
    assert!(receipt.asset.is_none());
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn raster_validation_rejects_corrupt_truncated_and_oversized_responses() {
    assert_eq!(provider::dimensions(&pixel(15)).unwrap(), (1, 1));
    let mut corrupt = pixel(15);
    let idat = corrupt.windows(4).position(|s| s == b"IDAT").unwrap();
    corrupt[idat + 4] ^= 0xff;
    assert!(provider::dimensions(&corrupt).is_err());
    assert!(provider::dimensions(b"<svg/>").is_err());
    assert!(provider::dimensions(&pixel(15)[..18]).is_err());
    assert!(provider::dimensions(&vec![0; provider::MAX_PNG + 1]).is_err());
}

#[test]
fn attachment_stat_only_reads_metadata_and_preview_checks_content_integrity() {
    let root = root();
    let store = ImageStore::open(&root).unwrap();
    let dir = store.session("one").unwrap();
    disk::private_dir(&dir).unwrap();
    let id = image_id("one", "create");
    let filename = format!("{id}.png");
    let bytes = pixel(1);
    disk::put(&dir, &filename, &bytes).unwrap();
    let asset = ImageAsset {
        id,
        filename: filename.clone(),
        model: provider::MODEL.into(),
        channel_id: provider::CHANNEL.into(),
        prompt: "p".into(),
        base_image_id: None,
        reference_ids: vec![],
        width: 1,
        height: 1,
        content_sha256: digest(&bytes),
    };
    let t = ImageTurn {
        admitted_locally: false,
        route: None,
        request_id: "create".into(),
        prompt: "p".into(),
        base_image_id: None,
        created_at: 1,
        status: ImageStatus::Succeeded,
        asset: Some(asset),
        error: None,
    };
    disk::save_turns(&dir, &[t], false).unwrap();
    let file = store.attachment("one", &filename).unwrap();
    assert_eq!(file.read_base64().unwrap(), STANDARD.encode(&bytes));
    assert!(store.attachment("two", &filename).is_err());
    assert!(store.attachment("one", &format!("../{filename}")).is_err());
    let actual = dir.join(&filename);
    std::fs::write(&actual, b"corrupt").unwrap();
    assert_eq!(file.size().unwrap(), 7);
    assert_eq!(
        file.read_base64().unwrap_err(),
        DesktopError("corruptImage")
    );
    let alternate = root.join("private-copy");
    std::fs::hard_link(&actual, &alternate).unwrap();
    assert_eq!(file.size().unwrap_err(), DesktopError("unsafePath"));
    std::fs::remove_file(&actual).unwrap();
    std::os::unix::fs::symlink(&alternate, &actual).unwrap();
    assert_eq!(file.size().unwrap_err(), DesktopError("unsafePath"));
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn import_is_a_session_asset_not_a_provider_turn_and_reopens_with_integrity() {
    let root = root();
    let store = ImageStore::open(&root).unwrap();
    let bytes = pixel(61);
    let one = store
        .import_png("one", "Green photo.jpg", &bytes, 410)
        .unwrap();
    assert_eq!(one.display_name, "Green photo.jpg");
    assert!(one.filename.ends_with(".png"));
    assert_eq!(one.width, 1);
    let repeat = store
        .import_png("one", "Green photo.jpg", &bytes, 415)
        .unwrap();
    assert_eq!(one.id, repeat.id);
    assert_eq!(repeat.created_at, 410);
    let other = store
        .import_png("other", "Green photo.jpg", &bytes, 410)
        .unwrap();
    assert_ne!(other.id, one.id);
    assert!(store
        .import_png("one", "../private.png", &bytes, 1)
        .is_err());
    assert!(store.import_png("one", "bad.png", b"not PNG", 1).is_err());
    assert!(store.history("one").unwrap().is_empty());
    drop(store);
    let reopened = ImageStore::open(&root).unwrap();
    assert_eq!(reopened.imports("one").unwrap().len(), 1);
    let asset = reopened.attachment("one", &one.filename).unwrap();
    assert_eq!(asset.read_bytes().unwrap(), bytes);
    assert!(reopened.attachment("other", &one.filename).is_err());
    assert!(reopened.history("one").unwrap().is_empty());
    std::fs::write(
        reopened.session("one").unwrap().join(&one.filename),
        b"damaged",
    )
    .unwrap();
    assert!(asset.read_bytes().is_err());
    drop(reopened);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn importing_then_editing_keeps_legacy_records_and_original_bytes() {
    // 已有传统数据后导入、派生及续作，回退到旧版仍读取原有 turns.json。
    let root = root();
    let store = ImageStore::open(&root).unwrap();
    let sid = "existing";
    let dir = store.session(sid).unwrap();
    disk::private_dir(&dir).unwrap();
    let prior = ImageTurn {
        admitted_locally: false,
        route: None,
        request_id: "previous".into(),
        prompt: "original receipt".into(),
        base_image_id: None,
        created_at: 100,
        status: ImageStatus::Interrupted,
        asset: None,
        error: None,
    };
    disk::save_turns(&dir, &[prior], false).unwrap();
    let legacy = std::fs::read(dir.join("turns.json")).unwrap();
    let source = store
        .import_png(sid, "sample.png", &pixel(18), 101)
        .unwrap();
    let server = TcpListener::bind("127.0.0.1:0").unwrap();
    let provider = LoopbackImageProvider::new(server.local_addr().unwrap()).unwrap();
    let runner = thread::spawn(move || {
        for expected in [18, 19] {
            let (mut sock, _) = server.accept().unwrap();
            let mut reader = BufReader::new(&sock);
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            assert!(line.starts_with("POST /v1/images/edits "));
            let mut length = 0;
            loop {
                line.clear();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" {
                    break;
                }
                if let Some(n) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    length = n.trim().parse().unwrap();
                }
            }
            let mut bytes = vec![0; length];
            reader.read_exact(&mut bytes).unwrap();
            let input: Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(
                input["referenceImage"]["b64_json"],
                STANDARD.encode(pixel(expected))
            );
            let result =
                json!({"data":[{"b64_json":STANDARD.encode(pixel(expected+1))}]}).to_string();
            write!(sock,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{result}",result.len()).unwrap();
        }
    });
    let edit = store
        .execute(sid, "edit-one", "change", Some(&source.id), 102, &provider)
        .unwrap();
    assert_eq!(edit.status, ImageStatus::Succeeded);
    let child = edit.asset.unwrap();
    drop(store);
    let reopened = ImageStore::open(&root).unwrap();
    let second = reopened
        .execute(sid, "edit-two", "another", Some(&child.id), 103, &provider)
        .unwrap()
        .asset
        .unwrap();
    assert_eq!(second.base_image_id.as_ref(), Some(&child.id));
    runner.join().unwrap();
    assert_eq!(
        reopened
            .attachment(sid, &source.filename)
            .unwrap()
            .read_bytes()
            .unwrap(),
        pixel(18)
    );
    assert_eq!(reopened.history(sid).unwrap().len(), 3);
    assert_eq!(reopened.imports(sid).unwrap().len(), 1);
    assert_eq!(std::fs::read(dir.join("turns.json")).unwrap(), legacy);
    assert_eq!(disk::load_turns(&dir, sid, None).unwrap().len(), 1);
    assert!(reopened
        .execute("other", "edit", "foreign", Some(&source.id), 104, &provider)
        .is_err());
    drop(reopened);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn import_replaces_an_abandoned_partial_stage_without_overwriting_a_committed_version() {
    let root = root();
    let store = ImageStore::open(&root).unwrap();
    let bytes = pixel(234);
    let committed = store
        .import_png("session", "initial.png", &bytes, 1)
        .unwrap();
    let aborted = store.session("session").unwrap();
    let name = "copy.png";
    let incoming = format!(
        "ref-{}.png",
        &digest(format!("session\0{name}\0{}", digest(&bytes)).as_bytes())[..32]
    );
    let stage = aborted.join(format!("{incoming}.next"));
    crate::formal_platform::store::write_new(&stage, b"partial bytes before crash").unwrap();
    let new = store.import_png("session", name, &bytes, 2).unwrap();
    assert!(!stage.exists());
    assert_eq!(
        store
            .attachment("session", &new.filename)
            .unwrap()
            .read_bytes()
            .unwrap(),
        bytes
    );
    assert_eq!(
        store
            .attachment("session", &committed.filename)
            .unwrap()
            .read_bytes()
            .unwrap(),
        bytes
    );
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn user_stop_is_durable_before_worker_returns_and_late_pixels_are_discarded() {
    let root = root();
    let store = ImageStore::open(&root).unwrap();
    let ImageAdmission::New(job) = store.admit("s", "r", "one", None, 1, None, None).unwrap()
    else {
        panic!()
    };
    let cancelled = AtomicBool::new(false);
    assert_eq!(
        store.latest_task("s").unwrap().unwrap().status,
        RunStatus::Running
    );
    store.stop("s", "r", &cancelled).unwrap();
    assert!(cancelled.load(Ordering::Acquire));
    assert!(store.history("s").unwrap()[0].user_stopped());
    let receipt = job.finish(Ok((pixel(1), 1, 1)), &cancelled).unwrap();
    assert!(receipt.user_stopped());
    assert!(receipt.asset.is_none());
    drop(store);
    let store = ImageStore::open(&root).unwrap();
    assert_eq!(
        store.latest_task("s").unwrap().unwrap().status,
        RunStatus::Cancelled
    );
    assert!(disk::load_turns(&store.session("s").unwrap(), "s", None).unwrap()[0].user_stopped());
    assert!(store.retry_source("s", "r", "new").is_err());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn failed_artifact_write_commits_failure_and_retry_keeps_exact_provenance() {
    let root = root();
    let store = ImageStore::open(&root).unwrap();
    let ImageAdmission::New(job) = store.admit("s", "r", "new", None, 1, None, None).unwrap()
    else {
        panic!()
    };
    let filename = format!("{}.png", image_id("s", "r"));
    std::fs::create_dir(store.session("s").unwrap().join(&filename)).unwrap();
    let flag = AtomicBool::new(false);
    assert_eq!(
        job.finish(Ok((pixel(1), 1, 1)), &flag).unwrap().status,
        ImageStatus::Failed
    );
    assert!(store.attachment("s", &filename).is_err());
    let source = store.retry_source("s", "r", "r2").unwrap();
    assert_eq!(source.prompt, "new");
    let ImageAdmission::New(retry) = store
        .admit("s", "r2", "new", None, 2, Some("r"), None)
        .unwrap()
    else {
        panic!()
    };
    retry.finish(Ok((pixel(2), 1, 1)), &flag).unwrap();
    drop(store);
    let store = ImageStore::open(&root).unwrap();
    assert!(matches!(
        store
            .admit("s", "r2", "new", None, 2, Some("r"), None)
            .unwrap(),
        ImageAdmission::Replay(_)
    ));
    assert!(store.admit("s", "r2", "new", None, 2, None, None).is_err());
    assert!(store.retry_source("s", "r", "fresh").is_err());
    assert!(store.retry_source("other", "r", "r2").is_err());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn legacy_and_downgraded_appends_survive_clock_rollback() {
    let root = root();
    let store = ImageStore::open(&root).unwrap();
    let dir = store.session("s").unwrap();
    disk::private_dir(&dir).unwrap();
    let legacy = |request: &str, created_at: u64| ImageTurn {
        admitted_locally: false,
        route: None,
        request_id: request.into(),
        prompt: "p".into(),
        created_at,
        base_image_id: None,
        status: ImageStatus::Failed,
        error: Some("imageProviderFailed".into()),
        asset: None,
    };
    let mut turns = vec![legacy("one", 100), legacy("two", 3)];
    disk::save_turns(&dir, &turns, false).unwrap();
    let summary = store.latest_task("s").unwrap().unwrap();
    assert_eq!(summary.request_id, "two");
    assert!(summary.text_head_at_admission.is_none());
    assert!(store.retry_source("s", "one", "new").is_err());
    assert!(store.retry_source("s", "two", "new").is_ok());
    let ImageAdmission::New(job) = store
        .admit("s", "three", "p", None, 2, None, Some("text"))
        .unwrap()
    else {
        panic!()
    };
    drop(job);
    assert_eq!(
        store
            .latest_task("s")
            .unwrap()
            .unwrap()
            .text_head_at_admission,
        Some(Some("text".into()))
    );
    drop(store);
    turns = disk::load_turns(&dir, "s", None).unwrap();
    turns.extend([legacy("four", 200), legacy("five", 1)]);
    disk::save_turns(&dir, &turns, false).unwrap();
    let store = ImageStore::open(&root).unwrap();
    assert_eq!(store.latest_task("s").unwrap().unwrap().request_id, "five");
    assert!(store.retry_source("s", "three", "new").is_err());
    assert!(store.retry_source("s", "five", "new").is_ok());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn missing_source_bytes_and_uncommitted_index_do_not_admit_a_request() {
    let root = root();
    let store = ImageStore::open(&root).unwrap();
    let dir = store.session("s").unwrap();
    let imported = store.import_png("s", "sample.png", &pixel(1), 0).unwrap();
    std::fs::write(dir.join(&imported.filename), pixel(2)).unwrap();
    assert!(store
        .admit("s", "bad-ref", "edit", Some(&imported.id), 1, None, None)
        .is_err());
    assert!(store.latest_task("s").unwrap().is_none());
    std::fs::create_dir(dir.join("turns.next")).unwrap();
    assert!(store
        .admit("s", "uncommitted", "p", None, 2, None, None)
        .is_err());
    assert!(store.history("s").unwrap().is_empty());
    assert!(store.latest_task("s").unwrap().is_none());
    std::fs::remove_dir(dir.join("turns.next")).unwrap();
    let ImageAdmission::New(job) = store.admit("s", "real", "p", None, 1, None, None).unwrap()
    else {
        panic!()
    };
    drop(job);
    assert_eq!(
        store.latest_task("s").unwrap().unwrap().status,
        RunStatus::Interrupted
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn failed_result_commit_discards_only_new_unpublished_pixels_and_keeps_edit_source() {
    let root = root();
    let store = ImageStore::open(&root).unwrap();
    let dir = store.session("s").unwrap();
    let imported = store.import_png("s", "fixture.png", &pixel(1), 0).unwrap();
    let ImageAdmission::New(job) = store
        .admit("s", "r", "edit", Some(&imported.id), 5, None, None)
        .unwrap()
    else {
        panic!()
    };
    std::fs::create_dir(dir.join("import-edits.json.next")).unwrap();
    assert!(job
        .finish(Ok((pixel(3), 1, 1)), &AtomicBool::new(false))
        .is_err());
    let filename = format!("{}.png", image_id("s", "r"));
    assert!(store.attachment("s", &filename).is_err());
    assert!(
        !dir.join(&filename).exists(),
        "未提交输出应从私有结果目录移除"
    );
    assert_eq!(
        store
            .attachment("s", &imported.filename)
            .unwrap()
            .read_bytes()
            .unwrap(),
        pixel(1)
    );
    drop(store);
    let store = ImageStore::open(&root).unwrap();
    let source = store.retry_source("s", "r", "again").unwrap();
    assert_eq!(source.status, ImageStatus::Interrupted);
    assert_eq!(source.base_image_id, Some(imported.id));
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn legacy_receipt_remains_read_only_and_new_image_records_its_own_admission() {
    let root = root();
    let store = ImageStore::open(&root).unwrap();
    let dir = store.session("s").unwrap();
    disk::private_dir(&dir).unwrap();
    let old = ImageTurn {
        admitted_locally: false,
        route: None,
        request_id: "legacy".into(),
        prompt: "p".into(),
        base_image_id: None,
        created_at: 5,
        status: ImageStatus::Interrupted,
        asset: None,
        error: None,
    };
    disk::save_turns(&dir, &[old], false).unwrap();
    let before = std::fs::read(dir.join("turns.json")).unwrap();
    drop(store);
    let store = ImageStore::open(&root).unwrap();
    let old = store.latest_task("s").unwrap().unwrap();
    assert_eq!(old.text_head_at_admission, None);
    assert_eq!(old.request_id, "legacy");
    assert_eq!(std::fs::read(dir.join("turns.json")).unwrap(), before);
    assert!(!dir.join("task-order.json").exists());
    let ImageAdmission::New(job) = store
        .admit("s", "new-image", "p", None, 2, None, Some("first-new-text"))
        .unwrap()
    else {
        panic!()
    };
    drop(job);
    assert_eq!(
        store
            .latest_task("s")
            .unwrap()
            .unwrap()
            .text_head_at_admission,
        Some(Some("first-new-text".to_string()))
    );
    std::fs::remove_dir_all(root).unwrap();
}

fn managed_route(action: ImageAction) -> ImageRoute {
    ImageRoute {
        channel_id: "synthetic".into(),
        model_id: "qa-image-1".into(),
        revision: "revision-demo".into(),
        protocol: ImageProtocol::OpenaiImages,
        action,
    }
}
#[test]
fn managed_image_restores_pinned_model_parent_and_downgrades_without_touching_legacy() {
    let root = root();
    let store = ImageStore::open(&root).unwrap();
    let flag = AtomicBool::new(false);
    let ImageAdmission::New(old) = store
        .admit("s", "mock", "old", None, 2, None, None)
        .unwrap()
    else {
        panic!()
    };
    let source = old
        .finish(Ok((pixel(1), 1, 1)), &flag)
        .unwrap()
        .asset
        .unwrap();
    let dir = store.session("s").unwrap();
    let legacy_before =
        ["turns.json", "task-order.json"].map(|p| std::fs::read(dir.join(p)).unwrap());
    let route = managed_route(ImageAction::Edit);
    let ImageAdmission::New(edit) = store
        .admit_routed(
            "s",
            "edited",
            "revise",
            Some(&source.id),
            1,
            None,
            Some("text"),
            &route,
        )
        .unwrap()
    else {
        panic!()
    };
    assert_eq!(edit.turn().route(), Some(&route));
    let receipt = edit
        .execute_with(&flag, |prompt, reference, _| {
            assert_eq!(prompt, "revise");
            assert_eq!(reference, Some((source.id.as_str(), pixel(1))));
            Ok((pixel(2), 1, 1))
        })
        .unwrap();
    assert_eq!(receipt.asset.as_ref().unwrap().model, route.model_id);
    assert_eq!(receipt.asset.as_ref().unwrap().channel_id, route.channel_id);
    drop(store);
    let store = ImageStore::open(&root).unwrap();
    let turns = store.history("s").unwrap();
    assert_eq!(turns.last().unwrap().route(), Some(&route));
    assert_eq!(store.route_for("s", "edited").unwrap(), Some(route));
    assert_eq!(
        store.latest_task("s").unwrap().unwrap().request_id,
        "edited"
    );
    assert_eq!(turns.len(), 2);
    assert_eq!(
        store
            .attachment("s", &receipt.asset.unwrap().filename)
            .unwrap()
            .read_bytes()
            .unwrap(),
        pixel(2)
    );
    assert_eq!(
        ["turns.json", "task-order.json"].map(|p| std::fs::read(dir.join(p)).unwrap()),
        legacy_before
    );
    assert_eq!(disk::load_turns(&dir, "s", None).unwrap().len(), 1);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn managed_retry_rejects_changed_route_or_old_mock_and_replays_only_exact_receipt() {
    let root = root();
    let store = ImageStore::open(&root).unwrap();
    let route = managed_route(ImageAction::Generate);
    let flag = AtomicBool::new(false);
    let ImageAdmission::New(job) = store
        .admit_routed("s", "a", "p", None, 1, None, None, &route)
        .unwrap()
    else {
        panic!()
    };
    job.finish(Err(DesktopError("imageProviderFailed")), &flag)
        .unwrap();
    let mut other = route.clone();
    other.revision = "revision-rotated".into();
    assert!(store
        .admit_routed("s", "b", "p", None, 2, Some("a"), None, &other)
        .is_err());
    assert!(store
        .admit("s", "b", "p", None, 2, Some("a"), None)
        .is_err());
    let ImageAdmission::New(retry) = store
        .admit_routed("s", "b", "p", None, 2, Some("a"), None, &route)
        .unwrap()
    else {
        panic!()
    };
    let result = retry.finish(Ok((pixel(1), 1, 1)), &flag).unwrap();
    assert!(result.route().is_some());
    assert!(matches!(
        store
            .admit_routed("s", "b", "p", None, 2, Some("a"), None, &route)
            .unwrap(),
        ImageAdmission::Replay(_)
    ));
    assert!(store
        .admit_routed("s", "b", "p", None, 2, Some("a"), None, &other)
        .is_err());
    assert!(store
        .admit("s", "b", "p", None, 2, Some("a"), None)
        .is_err());
    let ImageAdmission::New(old) = store.admit("s", "old", "p", None, 3, None, None).unwrap()
    else {
        panic!()
    };
    old.finish(Err(DesktopError("imageProviderFailed")), &flag)
        .unwrap();
    assert!(store
        .admit_routed("s", "fresh", "p", None, 4, Some("old"), None, &route)
        .is_err());
    assert!(store.route_for("s", "old").unwrap().is_none());
    assert_eq!(store.history("s").unwrap().len(), 3);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn managed_execution_rejects_an_unrouted_receipt_before_provider_and_stop_drops_a_late_managed_result(
) {
    let root = root();
    let store = ImageStore::open(&root).unwrap();
    let flag = AtomicBool::new(false);
    let ImageAdmission::New(legacy) = store
        .admit("s", "legacy", "p", None, 1, None, None)
        .unwrap()
    else {
        panic!()
    };
    assert!(legacy
        .execute_with(&flag, |_, _, _| panic!("无路由不能打开外部提供方"))
        .is_err());
    let route = managed_route(ImageAction::Generate);
    let ImageAdmission::New(job) = store
        .admit_routed("s", "new", "q", None, 2, None, None, &route)
        .unwrap()
    else {
        panic!()
    };
    store.stop("s", "new", &flag).unwrap();
    assert!(job
        .finish(Ok((pixel(1), 1, 1)), &flag)
        .unwrap()
        .user_stopped());
    drop(store);
    let store = ImageStore::open(&root).unwrap();
    let turn = store.history("s").unwrap().pop().unwrap();
    assert!(turn.user_stopped() && turn.asset.is_none());
    assert_eq!(turn.route(), Some(&route));
    assert!(store.retry_source("s", "new", "again").is_err());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn downgrade_append_is_newer_than_any_legacy_receipt_before_routed_admission() {
    let root = root();
    let store = ImageStore::open(&root).unwrap();
    let dir = store.session("s").unwrap();
    let img = store.import_png("s", "fixture.png", &pixel(1), 0).unwrap();
    let old = ImageTurn {
        admitted_locally: false,
        route: None,
        request_id: "old".into(),
        prompt: "image".into(),
        base_image_id: None,
        created_at: 200,
        status: ImageStatus::Interrupted,
        asset: None,
        error: None,
    };
    disk::save_turns(&dir, std::slice::from_ref(&old), false).unwrap();
    let ImageAdmission::New(job) = store
        .admit_routed(
            "s",
            "routed",
            "later",
            None,
            10,
            None,
            None,
            &managed_route(ImageAction::Generate),
        )
        .unwrap()
    else {
        panic!()
    };
    drop(job);
    drop(store);
    let mut last = old;
    last.request_id = "rollback-edit".into();
    last.base_image_id = Some(img.id);
    last.created_at = 1;
    disk::save_turns(&dir, &[last], true).unwrap();
    let store = ImageStore::open(&root).unwrap();
    let summary = store.latest_task("s").unwrap().unwrap();
    assert_eq!(summary.request_id, "rollback-edit");
    assert!(store.retry_source("s", "routed", "fresh").is_err());
    assert_eq!(
        store.history("s").unwrap().last().unwrap().request_id,
        "rollback-edit"
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn thumbnail_cache_is_scoped_repairable_and_never_substitutes_for_original() {
    let root = root();
    let store = ImageStore::open(&root).unwrap();
    let mut original = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut original, 1024, 512);
        enc.set_color(png::ColorType::Rgb);
        enc.set_depth(png::BitDepth::Eight);
        let mut pixels = vec![0; 1024 * 512 * 3];
        let mut state = 929u32;
        for p in &mut pixels {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            *p = state as u8;
        }
        enc.write_header()
            .unwrap()
            .write_image_data(&pixels)
            .unwrap();
    }
    assert!(original.len() > 512 * 1024);
    let reference = store.import_png("sid", "source.png", &original, 1).unwrap();
    let file = store.attachment("sid", &reference.filename).unwrap();
    assert_eq!(file.sha256(), digest(&original));
    let thumbnail = file.read_thumbnail().unwrap();
    assert_eq!(dimensions(&thumbnail).unwrap(), (256, 128));
    assert_ne!(thumbnail, original);
    let cache = file.dir.join(format!("{}.thumbnail-v1", file.filename));
    assert!(cache.exists());
    std::fs::write(&cache, b"truncated").unwrap();
    assert_eq!(file.read_thumbnail().unwrap(), thumbnail);
    assert!(std::fs::metadata(&cache).unwrap().len() > thumbnail.len() as u64);
    std::fs::OpenOptions::new()
        .write(true)
        .open(&cache)
        .unwrap()
        .set_len((MAX_THUMBNAIL_BYTES + 40) as u64)
        .unwrap();
    assert_eq!(file.read_thumbnail().unwrap(), thumbnail);
    assert_eq!(file.read_bytes().unwrap(), original);
    std::fs::remove_file(&cache).unwrap();
    std::os::unix::fs::symlink(file.dir.join(&file.filename), &cache).unwrap();
    assert_eq!(
        file.read_thumbnail().unwrap_err(),
        DesktopError("unsafePath")
    );
    assert!(cache.symlink_metadata().unwrap().is_symlink());
    std::fs::remove_file(&cache).unwrap();
    assert!(store.attachment("other", &reference.filename).is_err());
    assert!(store
        .attachment("sid", cache.file_name().unwrap().to_str().unwrap())
        .is_err());
    drop(file);
    drop(store);
    let reopened = ImageStore::open(&root).unwrap();
    let file = reopened.attachment("sid", &reference.filename).unwrap();
    assert_eq!(file.read_thumbnail().unwrap(), thumbnail);
    let original_path = file.dir.join(&file.filename);
    let mut tampered = original.clone();
    tampered[50] ^= 1;
    std::fs::write(&original_path, tampered).unwrap();
    assert!(file.read_thumbnail().is_err());
    assert!(file.read_bytes().is_err());
    std::fs::remove_file(original_path).unwrap();
    assert!(file.read_thumbnail().is_err());
    drop(file);
    drop(reopened);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn session_quota_rejects_new_requests_and_imports_but_keeps_existing_pixels_readable() {
    let root = root();
    let store = ImageStore::open(&root).unwrap();
    let original = pixel(3);
    let imported = store.import_png("sid", "existing", &original, 1).unwrap();
    let dir = store.session("sid").unwrap();
    // Sparse, private PNG-sized files simulate interrupted writes without allocating 128 MiB.
    for n in 0..16 {
        let path = dir.join(format!("img-{n:032x}.png"));
        crate::formal_platform::store::options()
            .create_new(true)
            .write(true)
            .open(path)
            .unwrap()
            .set_len(8 * 1024 * 1024)
            .unwrap();
    }
    assert!(matches!(
        store.admit("sid", "req", "create", None, 2, None, None),
        Err(DesktopError("imageStorageLimit"))
    ));
    assert!(matches!(
        store.import_png("sid", "new", &pixel(12), 2),
        Err(DesktopError("imageStorageLimit"))
    ));
    assert!(store.history("sid").unwrap().is_empty());
    assert_eq!(store.imports("sid").unwrap().len(), 1);
    let file = store.attachment("sid", &imported.filename).unwrap();
    assert_eq!(file.read_bytes().unwrap(), original);
    assert_eq!(dimensions(&file.read_thumbnail().unwrap()).unwrap(), (1, 1));
    assert!(store.import_png("other", "new", &pixel(12), 2).is_ok());
    drop(file);
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn session_quota_reserves_active_generation_before_during_and_after_import() {
    let root = root();
    let store = ImageStore::open(&root).unwrap();
    let original = pixel(249);
    let imported = store.import_png("sid", "existing", &original, 1).unwrap();
    let dir = store.session("sid").unwrap();
    // Leave exactly one full-size provider reservation, counting an abandoned stage.
    for i in 0..15 {
        let path = dir.join(format!("img-{i:032x}.png.next"));
        let len = MAX_PNG - if i == 0 { original.len() } else { 0 };
        crate::formal_platform::store::options()
            .create_new(true)
            .write(true)
            .open(path)
            .unwrap()
            .set_len(len as u64)
            .unwrap();
    }
    let ImageAdmission::New(job) = store
        .admit("sid", "req", "make", None, 2, None, None)
        .unwrap()
    else {
        panic!()
    };
    assert!(matches!(
        store.import_png("sid", "new", &original, 3),
        Err(DesktopError("imageStorageLimit"))
    ));
    assert_eq!(
        store
            .import_png("sid", "existing", &original, 3)
            .unwrap()
            .id,
        imported.id
    );
    let file = store.attachment("sid", &imported.filename).unwrap();
    assert!(!file.read_thumbnail().unwrap().is_empty());
    assert!(!dir.join(format!("{}.thumbnail-v1", file.filename)).exists());
    let turn = job
        .finish(Ok((pixel(31), 1, 1)), &AtomicBool::new(false))
        .unwrap();
    assert_eq!(turn.status, ImageStatus::Succeeded);
    assert!(store.import_png("sid", "new", &original, 3).is_ok());
    assert!(matches!(
        store
            .admit("sid", "req", "make", None, 2, None, None)
            .unwrap(),
        ImageAdmission::Replay(_)
    ));
    drop(file);
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn import_index_write_failure_discards_only_the_uncommitted_original() {
    let root = root();
    let store = ImageStore::open(&root).unwrap();
    let dir = store.session("sid").unwrap();
    let original = pixel(126);
    let keep = store.import_png("sid", "keep", &original, 1).unwrap();
    // Deny the index transaction *before* rename, independently of permissions/root.
    std::fs::create_dir(dir.join("imports.json.next")).unwrap();
    assert!(store.import_png("sid", "rejected", &pixel(111), 2).is_err());
    assert_eq!(store.imports("sid").unwrap().len(), 1);
    let all_png = std::fs::read_dir(&dir)
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .filter(|n| n.to_str().unwrap().ends_with(".png"))
        .count();
    assert_eq!(all_png, 1);
    assert_eq!(
        store
            .attachment("sid", &keep.filename)
            .unwrap()
            .read_bytes()
            .unwrap(),
        original
    );
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn portable_images_only_copy_indexed_verified_originals_to_a_fresh_session() {
    let a = root();
    let b = root();
    let c = root();
    let source = ImageStore::open(&a).unwrap();
    let target = ImageStore::open(&b).unwrap();
    let broken = ImageStore::open(&c).unwrap();
    let png = pixel(74);
    let asset = source.import_png("ours", "selected.png", &png, 1).unwrap();
    source
        .import_png("other", "another.png", &pixel(4), 2)
        .unwrap();
    assert!(source.export_portable("ours", &mut 0).is_err());
    let mut budget = usize::MAX;
    let images = source.export_portable("ours", &mut budget).unwrap();
    assert_eq!(images.image_count(), 1);
    let json = serde_json::to_string(&images).unwrap();
    let field = format!(r#""{}":"{}""#, asset.filename, STANDARD.encode(&png));
    assert!(json.contains(&field));
    let duplicate = json.replace(&field, &format!("{field},{field}"));
    assert!(serde_json::from_str::<PortableImages>(&duplicate).is_err());
    target.stage_portable("ours", &images).unwrap();
    assert_eq!(
        target
            .attachment("ours", &asset.filename)
            .unwrap()
            .read_bytes()
            .unwrap(),
        png
    );
    assert!(target.stage_portable("ours", &images).is_err());
    let mut relocated = images.clone();
    relocated.remap_session("ours", "restored").unwrap();
    target.stage_portable("restored", &relocated).unwrap();
    let relocated_import = &target.imports("restored").unwrap()[0];
    assert_ne!(relocated_import.id, asset.id);
    assert_eq!(
        target
            .attachment("restored", &relocated_import.filename)
            .unwrap()
            .read_bytes()
            .unwrap(),
        png
    );
    let mut archive = serde_json::to_value(&images).unwrap();
    archive["pngs"][&asset.filename] = json!(STANDARD.encode(pixel(32)));
    assert_eq!(
        broken
            .stage_portable("ours", &serde_json::from_value(archive).unwrap())
            .unwrap_err()
            .0,
        "corruptImages"
    );
    for root in [a, b, c] {
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn portable_history_reference_remaps_only_the_session_and_rejects_changed_provenance() {
    let dir = root();
    let store = ImageStore::open(&dir).unwrap();
    let image = pixel(84);
    let source = imports::HistoryImageSource {
        message_id: "second-of-two".into(),
        attachment_id: "owned".into(),
    };
    let prepared = store
        .import_reference("before", "photo.png", &image, 1, Some(source))
        .unwrap();
    let mut budget = usize::MAX;
    let mut portable = store.export_portable("before", &mut budget).unwrap();
    let mut tampered = serde_json::to_value(&portable).unwrap();
    tampered["imports"][0]["historySource"]["messageId"] = json!("first-of-two");
    let mut tampered: PortableImages = serde_json::from_value(tampered).unwrap();
    assert_eq!(
        tampered.remap_session("before", "after").unwrap_err().0,
        "corruptImages"
    );

    portable.remap_session("before", "after").unwrap();
    store.stage_portable("after", &portable).unwrap();
    let moved = store.imports("after").unwrap().remove(0);
    assert_ne!(prepared.id, moved.id);
    assert_eq!(
        store
            .attachment("after", &moved.filename)
            .unwrap()
            .read_bytes()
            .unwrap(),
        image
    );
    let owner = moved.history_source.unwrap();
    assert_eq!(owner.message_id, "second-of-two");
    assert_eq!(owner.attachment_id, "owned");
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn fork_copies_only_used_versions_and_recovers_an_exact_unpublished_install() {
    use std::collections::BTreeSet;
    let root = root();
    let store = ImageStore::open(&root).unwrap();
    let a = store
        .import_png("source", "chosen.png", &pixel(1), 1)
        .unwrap();
    let unselected = store
        .import_png("source", "other.png", &pixel(2), 2)
        .unwrap();
    for (id, parent) in [("keep", &a.id), ("after", &unselected.id)] {
        let ImageAdmission::New(job) = store
            .admit("source", id, "edit", Some(parent), 3, None, None)
            .unwrap()
        else {
            panic!()
        };
        job.finish(Ok((pixel(3), 1, 1)), &AtomicBool::new(false))
            .unwrap();
    }
    let keep = BTreeSet::from(["keep".to_string()]);
    store.fork_assets("source", "child", &keep).unwrap();
    drop(store);
    let store = ImageStore::open(&root).unwrap();
    store.fork_assets("source", "child", &keep).unwrap();
    let (versions, refs) = store.snapshot("child").unwrap();
    assert_eq!((versions.len(), refs.len()), (1, 1));
    assert_ne!(refs[0].id, a.id);
    assert_eq!(refs[0].display_name, "chosen.png");
    assert_eq!(versions[0].base_image_id.as_ref(), Some(&refs[0].id));
    assert_eq!(versions[0].route().unwrap().revision, "fork-history-v1");
    assert_eq!(
        store
            .latest_task("child")
            .unwrap()
            .unwrap()
            .text_head_at_admission,
        Some(None)
    );
    assert!(store.attachment("child", &a.filename).is_err());
    assert!(store.fork_assets("another", "other-child", &keep).is_err());
    assert!(store
        .fork_assets("source", "child", &BTreeSet::from(["after".into()]))
        .is_err());
    let copied = versions[0].asset.as_ref().unwrap();
    std::fs::write(
        store.session("child").unwrap().join(&copied.filename),
        pixel(99),
    )
    .unwrap();
    assert!(store.fork_assets("source", "child", &keep).is_err());
    assert_eq!(
        store
            .attachment("source", &a.filename)
            .unwrap()
            .read_bytes()
            .unwrap(),
        pixel(1)
    );
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
}

#[path = "revision_tests.rs"]
mod revision_tests;
