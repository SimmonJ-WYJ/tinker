//! 迟到探测不能占用 actor 控制通道或获得新 generation 的事实写入权。
use super::*;
use crate::formal_platform::local_mock_profiles;
use serde_json::json;
use std::{io::Read, net::TcpListener, time::Instant};
#[test]
fn slow_probe_does_not_delay_close_or_bootstrap_and_uses_one_slot() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let endpoint = format!(
        "http://{}/v1/chat/completions",
        listener.local_addr().unwrap()
    );
    let (observed, received) = std::sync::mpsc::sync_channel(1);
    let worker = thread::spawn(move || {
        let (mut s, _) = listener.accept().unwrap();
        let mut b = [0; 3];
        s.read_exact(&mut b).unwrap();
        assert_eq!(&b, b"GET");
        observed.send(()).unwrap();
        thread::sleep(Duration::from_millis(2200));
    });
    let path = std::env::temp_dir().canonicalize().unwrap().join(format!(
        "tinker-tauri-formal-preview-probe-control-{}",
        std::process::id()
    ));
    let root = TrustedRoot::create_temporary(path).unwrap();
    let profiles = local_mock_profiles(&endpoint).unwrap();
    let platform = FormalPlatform::open(
        &root,
        &profiles,
        HostEnvironment::new("darwin", false, false).unwrap(),
    )
    .unwrap();
    let runtime = Arc::new(DesktopRuntime::open(root.path(), profiles).unwrap());
    let mut h = FormalAgentHost::new(runtime, platform, root).unwrap();
    let boot = h
        .command("main", json!({"command":"bootstrap"}))
        .unwrap()
        .wait(Duration::from_secs(1))
        .unwrap();
    let g = &boot["generation"];
    let probe=h.command("main",json!({"command":"invoke","generation":g,"channel":"channel:test","args":["local-mock"]})).unwrap();
    let duplicate=h.command("main",json!({"command":"invoke","generation":g,"channel":"channel:test","args":["local-mock"]})).unwrap();
    assert_eq!(
        duplicate.wait(Duration::from_secs(1)).unwrap_err().0,
        "hostBusy"
    );
    received.recv_timeout(Duration::from_secs(2)).unwrap();
    let start = Instant::now();
    let close = h
        .command("main", json!({"command":"beginClose","generation":g}))
        .unwrap()
        .wait(Duration::from_secs(1))
        .unwrap();
    assert!(close["closeToken"].is_string());
    h.command("main", json!({"command":"bootstrap"}))
        .unwrap()
        .wait(Duration::from_secs(1))
        .unwrap();
    assert!(start.elapsed() < Duration::from_millis(500));
    h.shutdown().unwrap();
    assert!(start.elapsed() < Duration::from_millis(500));
    assert_eq!(
        probe.wait(Duration::from_millis(300)).unwrap_err().0,
        "staleGeneration"
    );
    worker.join().unwrap();
}
