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
    let p = std::env::temp_dir().canonicalize().unwrap().join(format!(
        "tinker-native-images-{}-{}",
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
        request_id: "uncertain".into(),
        prompt: "still accepted".into(),
        base_image_id: None,
        status: ImageStatus::Pending,
        created_at: 10,
        asset: None,
        error: None,
    };
    disk::save(&dir, &[pending]).unwrap();
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
        request_id: "create".into(),
        prompt: "p".into(),
        base_image_id: None,
        created_at: 1,
        status: ImageStatus::Succeeded,
        asset: Some(asset),
        error: None,
    };
    disk::save(&dir, &[t]).unwrap();
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
