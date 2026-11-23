#[path = "support/http.rs"]
mod http_support;
// 合成HTTP端到端：只绑定/请求数字回环，不读取真实配置或凭据。
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    thread,
    time::{Duration, Instant},
};
use tinker_rust_foundation::{
    chat_http::{ChatHttpConfig, ChatHttpProvider},
    run_provider::RunProvider,
};
fn request(socket: &mut TcpStream) {
    let bytes = http_support::read_request(socket);
    assert!(std::str::from_utf8(&bytes).unwrap().contains("synthetic"));
}
fn provider(endpoint: String, total: Duration, idle: Duration) -> ChatHttpProvider {
    let url = reqwest::Url::parse(&endpoint).unwrap();
    assert!(url
        .host_str()
        .unwrap()
        .parse::<std::net::IpAddr>()
        .unwrap()
        .is_loopback());
    ChatHttpProvider::new(
        ChatHttpConfig::new(
            endpoint,
            "fake-secret-token".into(),
            "synthetic-model".into(),
        )
        .unwrap()
        .with_timeouts(total, idle)
        .unwrap(),
    )
}
fn execute_response(status: u16, headers: &str, body: &[u8]) -> (Result<(), String>, String) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!(
        "http://{}/v1/chat/completions",
        listener.local_addr().unwrap()
    );
    let response=[format!("HTTP/1.1 {status} Synthetic\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n{headers}\r\n",body.len()).into_bytes(),body.to_vec()].concat();
    let server = thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        request(&mut socket);
        let _ = socket.write_all(&response);
        listener.set_nonblocking(true).unwrap();
        thread::sleep(Duration::from_millis(30));
        assert!(listener.accept().is_err(), "不应自动重试");
    });
    let mut output = String::new();
    let result = provider(endpoint, Duration::from_secs(3), Duration::from_secs(1))
        .execute("synthetic input", &AtomicBool::new(false), &mut |text| {
            output.push_str(text);
            Ok(())
        })
        .map_err(|e| e.code().to_owned());
    server.join().unwrap();
    (result, output)
}
#[test]
fn http_status_errors_are_fixed_and_do_not_emit_bodies() {
    for (status, expected) in [
        (401, "channelUnauthorized"),
        (402, "channelPaymentRequired"),
        (403, "channelForbidden"),
        (429, "channelRateLimited"),
        (500, "httpStatus"),
        (503, "httpStatus"),
    ] {
        let (result, output) = execute_response(
            status,
            "X-Synthetic: fake-secret-token\r\n",
            b"fake-secret-token private-error-body",
        );
        assert_eq!(result, Err(expected.into()));
        assert!(output.is_empty());
    }
}
#[test]
fn redirects_are_not_followed() {
    let trap = TcpListener::bind("127.0.0.1:0").unwrap();
    let (result, _) = execute_response(
        302,
        &format!("Location: http://{}/secret\r\n", trap.local_addr().unwrap()),
        b"private-redirect-body",
    );
    assert_eq!(result, Err("httpStatus".into()));
    trap.set_nonblocking(true).unwrap();
    assert!(trap.accept().is_err());
}
#[test]
fn invalid_utf8_and_resource_budgets_fail() {
    let mut invalid = b"data: ".to_vec();
    invalid.push(0xff);
    invalid.extend_from_slice(b"\n\n");
    assert_eq!(
        execute_response(200, "", &invalid).0,
        Err("httpProtocol".into())
    );
    assert_eq!(
        execute_response(200, "", format!(":{}\n\n", "x".repeat(65536)).as_bytes()).0,
        Err("runLimitExceeded".into())
    );
    let large = serde_json::json!({"choices":[{"delta":{"content":"x".repeat(16385)}}]});
    assert_eq!(
        execute_response(200, "", format!("data: {large}\n\n").as_bytes()).0,
        Err("runLimitExceeded".into())
    );
    let frame = format!(
        "data: {}\n\n",
        serde_json::json!({"choices":[{"delta":{"content":"x".repeat(8192)}}]})
    );
    assert_eq!(
        execute_response(200, "", frame.repeat(33).as_bytes()).0,
        Err("runLimitExceeded".into())
    );
    assert_eq!(
        execute_response(200, "", ": tiny\n\n".repeat(270000).as_bytes()).0,
        Err("runLimitExceeded".into())
    );
}
fn waiting_network(body_headers: bool, cancel: bool) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!(
        "http://{}/v1/chat/completions",
        listener.local_addr().unwrap()
    );
    let (ready_tx, ready_rx) = mpsc::channel();
    let server = thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        request(&mut socket);
        if body_headers {
            socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: 100000\r\n\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n").unwrap();
        }
        ready_tx.send(()).unwrap();
        let mut byte = [0];
        match socket.read(&mut byte) {
            Ok(0) => (),
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::BrokenPipe
                ) => {}
            other => panic!("客户端未释放连接: {other:?}"),
        }
    });
    let token = Arc::new(AtomicBool::new(false));
    let worker_token = token.clone();
    let worker = thread::spawn(move || {
        let mut output = String::new();
        let result = provider(
            endpoint,
            Duration::from_millis(if cancel { 2000 } else { 120 }),
            Duration::from_millis(if cancel { 2000 } else { 80 }),
        )
        .execute("synthetic input", &worker_token, &mut |text| {
            output.push_str(text);
            Ok(())
        });
        (result, output)
    });
    ready_rx.recv_timeout(Duration::from_secs(2)).unwrap();
    thread::sleep(Duration::from_millis(30));
    let start = Instant::now();
    if cancel {
        token.store(true, Ordering::Release);
    }
    let (result, output) = worker.join().unwrap();
    assert!(start.elapsed() < Duration::from_millis(600));
    if cancel {
        assert!(result.is_ok())
    } else {
        assert_eq!(result.unwrap_err().code(), "httpTimeout")
    };
    if body_headers {
        assert_eq!(output, "partial")
    } else {
        assert!(output.is_empty())
    };
    server.join().unwrap();
}
#[test]
fn cancel_headers_releases_socket() {
    waiting_network(false, true)
}
#[test]
fn cancel_body_releases_socket_and_keeps_partial() {
    waiting_network(true, true)
}
#[test]
fn timeout_headers_releases_socket() {
    waiting_network(false, false)
}
#[test]
fn timeout_body_releases_socket_and_keeps_partial() {
    waiting_network(true, false)
}

#[test]
fn proxy_environment_is_ignored() {
    let trap = TcpListener::bind("127.0.0.1:0").unwrap();
    let proxy = format!("http://{}", trap.local_addr().unwrap());
    let mut child = std::process::Command::new(std::env::current_exe().unwrap());
    child
        .args(["--exact", "proxy_fixture_child", "--nocapture"])
        .env("TINKER_PROXY_CHILD", "synthetic")
        .env_remove("NO_PROXY")
        .env_remove("no_proxy");
    for key in [
        "HTTP_PROXY",
        "http_proxy",
        "HTTPS_PROXY",
        "https_proxy",
        "ALL_PROXY",
        "all_proxy",
    ] {
        child.env(key, &proxy);
    }
    assert!(child.status().unwrap().success());
    trap.set_nonblocking(true).unwrap();
    assert!(trap.accept().is_err());
}
#[test]
fn proxy_fixture_child() {
    if std::env::var("TINKER_PROXY_CHILD").as_deref() != Ok("synthetic") {
        return;
    }
    let (result, _) = execute_response(200, "", b"data: [DONE]\n\n");
    assert_eq!(result, Ok(()));
}
#[test]
fn total_deadline_stops_continuous_body() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!(
        "http://{}/v1/chat/completions",
        listener.local_addr().unwrap()
    );
    let server = thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        request(&mut socket);
        socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: 100000\r\n\r\n").unwrap();
        for _ in 0..30 {
            if socket.write_all(b": heartbeat\n\n").is_err() {
                return;
            }
            thread::sleep(Duration::from_millis(15));
        }
        let mut byte = [0];
        assert!(matches!(socket.read(&mut byte), Ok(0) | Err(_)));
    });
    let start = Instant::now();
    let result = provider(
        endpoint,
        Duration::from_millis(120),
        Duration::from_millis(80),
    )
    .execute("synthetic input", &AtomicBool::new(false), &mut |_| Ok(()));
    assert_eq!(result.unwrap_err().code(), "httpTimeout");
    assert!(start.elapsed() < Duration::from_millis(600));
    server.join().unwrap();
}
