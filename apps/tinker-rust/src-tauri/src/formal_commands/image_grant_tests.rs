use super::*;
use crate::{
    formal_host::FormalHost,
    formal_platform::{HostEnvironment, TrustedRoot},
    picked_image::encode_png,
};
use std::{fs, time::Duration};
fn command(host: &FormalHost, request: Value) -> Value {
    host.command("main", request)
        .unwrap()
        .wait(Duration::from_secs(5))
        .unwrap()
}
#[test]
fn pending_file_grants_expire_on_reload_close_and_deletion() {
    let dir = std::env::temp_dir().canonicalize().unwrap().join(format!(
        "tinker-tauri-formal-preview-test-file-grant-{}",
        crate::credentialed_channels::catalog::random_reference().unwrap()
    ));
    let root = TrustedRoot::create_temporary(dir.clone()).unwrap();
    let mut host =
        FormalHost::open(&root, HostEnvironment::new("darwin", false, false).unwrap()).unwrap();
    let boot = || {
        let b = command(&host, json!({"command":"bootstrap"}));
        assert_eq!(b["nativeImageFiles"], true);
        b["generation"].as_str().unwrap().to_owned()
    };
    let g = boot();
    let create = |g: &str| {
        command(&host,json!({"command":"invoke","generation":g,"channel":"agent:create-session","args":["example","local-mock"]}))["value"]["id"].as_str().unwrap().to_owned()
    };
    let sid = create(&g);
    let other = create(&g);
    let grant = |g: &str, s: &str, step: Step| {
        host.image_grant(g.into(), s.into(), step)
            .unwrap()
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
    };
    let import = || Step::Import {
        name: "synthetic.png".to_owned(),
        png: encode_png(1, 1, png::ColorType::Rgb, &[1, 2, 3]).unwrap(),
    };
    assert!(matches!(
        grant(&g, &sid, Step::CheckImport).unwrap(),
        Outcome::Ready
    ));
    let g2 = boot();
    assert_eq!(
        grant(&g, &sid, import()).err().unwrap().0,
        "staleGeneration"
    );
    let Outcome::Finished(imported) = grant(&g2, &sid, import()).unwrap() else {
        panic!("缺少导入结果")
    };
    let filename = imported["value"]["filename"].as_str().unwrap();
    assert_eq!(
        grant(&g2, &other, Step::ReadExport(filename.into()))
            .err()
            .unwrap()
            .0,
        "imageNotFound"
    );
    let Outcome::Bytes(bytes) = grant(&g2, &sid, Step::ReadExport(filename.into())).unwrap() else {
        panic!("缺少图片字节")
    };
    let destination = dir.join("synthetic-export.png");
    // 对话框打开以后，即使会话还在，隔离标记被替换也不能再提交授权。
    let staged = image_disk::stage_export(&destination, &bytes).unwrap();
    let marker = dir.join("preview.json");
    let original = fs::read(&marker).unwrap();
    fs::write(&marker, b"{}").unwrap();
    assert_eq!(
        grant(&g2, &sid, Step::CheckImport).err().unwrap().0,
        "invalidRoot"
    );
    assert_eq!(
        grant(
            &g2,
            &sid,
            Step::Export {
                filename: filename.into(),
                staged
            }
        )
        .err()
        .unwrap()
        .0,
        "invalidRoot"
    );
    assert!(!destination.exists());
    fs::write(marker, original).unwrap();
    let staged = image_disk::stage_export(&destination, &bytes).unwrap();
    let close = command(&host, json!({"command":"beginClose","generation":g2}));
    assert_eq!(
        grant(
            &g2,
            &sid,
            Step::Export {
                filename: filename.into(),
                staged
            }
        )
        .err()
        .unwrap()
        .0,
        "closing"
    );
    assert!(!destination.exists());
    command(
        &host,
        json!({"command":"abortClose","generation":g2,"closeToken":close["closeToken"]}),
    );
    let staged = image_disk::stage_export(&destination, &bytes).unwrap();
    command(
        &host,
        json!({"command":"invoke","generation":g2,"channel":"agent:delete-session","args":[sid]}),
    );
    assert_eq!(
        grant(
            &g2,
            &sid,
            Step::Export {
                filename: filename.into(),
                staged
            }
        )
        .err()
        .unwrap()
        .0,
        "sessionNotFound"
    );
    assert!(!destination.exists());
    assert!(host.mock_records().is_empty());
    host.shutdown().unwrap();
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn channel_image_ranges_thumbnail_and_save_preserve_owned_large_original() {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use sha2::{Digest, Sha256};
    let path = std::env::temp_dir().canonicalize().unwrap().join(format!(
        "tinker-tauri-channels-preview-large-files-{}",
        crate::credentialed_channels::catalog::random_reference().unwrap()
    ));
    let root = TrustedRoot::create_channels_temporary(&path).unwrap();
    let mut host = FormalHost::open_channels_owned_qa(
        &root,
        HostEnvironment::new("darwin", false, false).unwrap(),
    )
    .unwrap();
    let bootstrap = command(&host, json!({"command":"bootstrap"}));
    assert_eq!(bootstrap["nativeImageAssetReads"], true);
    let generation = bootstrap["generation"].as_str().unwrap();
    let invoke = |channel: &str, args: Value| {
        host.command(
            "main",
            json!({"command":"invoke","generation":generation,"channel":channel,"args":args}),
        )
        .unwrap()
        .wait(Duration::from_secs(8))
        .map(|v| v["value"].clone())
    };
    let port: Value =
        serde_json::from_slice(&fs::read(path.join("qa-endpoint.json")).unwrap()).unwrap();
    let request = json!({"version":1,"channel":"channel:create","args":[{"channel":{"id":"owned","name":"Owned","protocol":"openai-chat","baseUrl":format!("http://127.0.0.1:{}/v1",port["port"]),"enabled":true,"models":[{"modelId":"text","label":"Text"}]},"credential":"keep"}],"mutation":{"mutationId":"save","expectedRevision":0}});
    let staged=invoke("channel:stage",json!([{"request":request,"secret":crate::credentialed_channels::vault_fake::QA_SECRET_ONE}])).unwrap();
    command(
        &host,
        json!({"command":"invoke","generation":generation,"channel":staged["channel"],"args":staged["args"],"mutation":staged["mutation"]}),
    );
    let sid = invoke("agent:create-session", json!(["Example", "owned"])).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let other = invoke("agent:create-session", json!(["Other", "owned"])).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let grant = |step| {
        host.image_grant(generation.into(), sid.clone(), step)
            .unwrap()
            .recv_timeout(Duration::from_secs(8))
            .unwrap()
            .unwrap()
    };
    let mut bits = 0x31415926_u32;
    let pixels: Vec<u8> = (0..640 * 480 * 3)
        .map(|_| {
            bits ^= bits << 13;
            bits ^= bits >> 17;
            bits ^= bits << 5;
            bits as u8
        })
        .collect();
    let mut original = Vec::new();
    {
        let mut e = png::Encoder::new(&mut original, 640, 480);
        e.set_color(png::ColorType::Rgb);
        e.set_depth(png::BitDepth::Eight);
        e.write_header().unwrap().write_image_data(&pixels).unwrap();
    }
    assert!(original.len() > 512 * 1024);
    let Outcome::Finished(asset) = grant(Step::Import {
        name: "selection.png".into(),
        png: original.clone(),
    }) else {
        panic!("expected imported asset")
    };
    let file = &asset["value"]["filename"];
    let relative = asset["value"]["localPath"].as_str().unwrap();
    let digest = format!("{:x}", Sha256::digest(&original));
    let thumb = invoke("agent:read-image-thumbnail", json!([sid, file])).unwrap();
    let preview = STANDARD.decode(thumb.as_str().unwrap()).unwrap();
    let (w, h) = crate::formal_images::dimensions(&preview).unwrap();
    assert_eq!((w, h), (256, 192));
    assert!(preview.len() < original.len());

    let mut data = Vec::new();
    while data.len() < original.len() {
        let offset = data.len();
        let mut args = json!([sid, file, offset, 256 * 1024]);
        if offset > 0 {
            args.as_array_mut().unwrap().push(json!(digest));
        }
        let chunk = invoke("agent:read-image-range", args).unwrap();
        assert_eq!(chunk["sha256"], digest);
        assert_eq!(chunk["offset"], offset);
        assert_eq!(chunk["totalBytes"], original.len());
        let decoded = STANDARD.decode(chunk["data"].as_str().unwrap()).unwrap();
        assert_eq!(decoded.len(), (256 * 1024).min(original.len() - offset));
        data.extend(decoded);
    }
    assert_eq!(data, original);
    assert!(invoke("chat:read-attachment", json!([relative])).is_err());
    for args in [
        json!([other, file, 0, 1]),
        json!([sid, "../example.png", 0, 1]),
        json!([sid, file, 1, 1]),
        json!([sid, file, 1, 1, "0".repeat(64)]),
        json!([sid, file, 0, 0]),
        json!([sid, file, 0, 256 * 1024 + 1]),
        json!([sid, file, original.len() + 1, 32, digest]),
    ] {
        assert!(invoke("agent:read-image-range", args).is_err());
    }
    assert!(invoke("agent:read-image-thumbnail", json!([other, file])).is_err());
    let Outcome::Bytes(bytes) = grant(Step::ReadExport(file.as_str().unwrap().into())) else {
        panic!("expected original export")
    };
    let dest = path.join("export.png");
    drop(image_disk::stage_export(&dest, &bytes).unwrap());
    assert!(!dest.exists());
    let stage = image_disk::stage_export(&dest, &bytes).unwrap();
    assert!(matches!(
        grant(Step::Export {
            filename: file.as_str().unwrap().into(),
            staged: stage
        }),
        Outcome::Finished(_)
    ));
    assert_eq!(fs::read(&dest).unwrap(), original);
    host.shutdown().unwrap();
    drop(host);
    fs::remove_dir_all(path).unwrap();
}
