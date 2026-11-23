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
