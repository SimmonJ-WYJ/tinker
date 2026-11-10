use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
#[path = "support/desktop_process.rs"]
mod support;
use support::*;
#[test]
fn process_frames_ids_stdout_and_eof() {
    let f = Fixture::new();
    let mut child = f.spawn();
    let mut input = child.stdin.take().unwrap();
    let mut output = BufReader::new(child.stdout.take().unwrap());
    assert_eq!(
        rpc(
            &mut input,
            &mut output,
            "one",
            "runtime.describe",
            json!({})
        )["result"]["version"],
        1
    );
    assert_eq!(
        rpc(&mut input, &mut output, "two", "unknown", json!({}))["error"]["code"],
        "unknownMethod"
    );
    drop(input);
    assert!(child.wait().unwrap().success());
    let mut remaining = String::new();
    assert_eq!(output.read_line(&mut remaining).unwrap(), 0);
}
#[test]
fn malformed_truncated_and_oversized_frames_close_without_echo() {
    for payload in [
        b"{bad}\n".to_vec(),
        b"{\"id\":\"secret-input\"}".to_vec(),
        vec![b'x'; 4 * 1024 * 1024 + 1],
    ] {
        let f = Fixture::new();
        let mut child = f.spawn();
        let mut input = child.stdin.take().unwrap();
        let writer = std::thread::spawn(move || {
            let _ = input.write_all(&payload);
        });
        let out = child.wait_with_output().unwrap();
        writer.join().unwrap();
        assert!(!out.status.success());
        assert!(out.stdout.is_empty());
        assert!(!String::from_utf8_lossy(&out.stderr).contains("secret-input"));
    }
}
#[path = "support/http.rs"]
mod http_support;
#[test]
fn real_process_two_turns_restart_third_context_and_unicode() {
    use std::{net::TcpListener, time::Duration};
    let f = Fixture::new();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    set_endpoint(
        &f,
        &format!(
            "http://{}/v1/chat/completions",
            listener.local_addr().unwrap()
        ),
    );
    let server = std::thread::spawn(move || {
        let mut bodies = Vec::new();
        for _ in 0..3 {
            let (mut socket, _) = listener.accept().unwrap();
            let bytes = http_support::read_request(&mut socket);
            let start = bytes.windows(4).position(|b| b == b"\r\n\r\n").unwrap() + 4;
            let request: Value = serde_json::from_slice(&bytes[start..]).unwrap();
            bodies.push(request);
            let body =
                "data: {\"choices\":[{\"delta\":{\"content\":\"回复🙂\"}}]}\n\ndata: [DONE]\n\n";
            write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
        }
        listener.set_nonblocking(true).unwrap();
        std::thread::sleep(Duration::from_millis(40));
        assert!(listener.accept().is_err());
        bodies
    });
    let (mut child, mut input, mut output) = connect(&f);
    let session = rpc(
        &mut input,
        &mut output,
        "create",
        "sessions.create",
        json!({"title":"合成","profileId":"local","workspaceId":null,"reuseDraft":false}),
    )["result"]["sessionId"]
        .as_str()
        .unwrap()
        .to_string();
    for request in ["first", "second"] {
        let p = send(&session, request, "你好🙂");
        assert!(rpc(&mut input, &mut output, "send", "chat.send", p.clone())
            .get("result")
            .is_some());
        let done = terminal(&mut input, &mut output, &session, request);
        assert_eq!(done["turn"]["status"], "completed");
        assert_eq!(done["turn"]["assistantMessage"], "回复🙂");
        assert_eq!(done["events"][0]["startedAt"], 123);
        assert_eq!(
            rpc(&mut input, &mut output, "duplicate", "chat.send", p)["result"],
            done["turn"]
        );
    }
    drop(input);
    assert!(child.wait().unwrap().success());
    let (mut child, mut input, mut output) = connect(&f);
    assert_eq!(
        rpc(
            &mut input,
            &mut output,
            "history",
            "sessions.history",
            json!({"sessionId":session,"after":0,"limit":128})
        )["result"]["turns"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    rpc(
        &mut input,
        &mut output,
        "send",
        "chat.send",
        send(&session, "third", "再来"),
    );
    assert_eq!(
        terminal(&mut input, &mut output, &session, "third")["turn"]["status"],
        "completed"
    );
    drop(input);
    assert!(child.wait().unwrap().success());
    let bodies = server.join().unwrap();
    assert_eq!(
        bodies
            .iter()
            .map(|b| b["messages"].as_array().unwrap().len())
            .collect::<Vec<_>>(),
        vec![1, 3, 5]
    );
    assert_eq!(bodies[2]["messages"][1]["content"], "回复🙂");
    assert_eq!(bodies[2]["messages"][4]["role"], "user");
}
#[test]
fn slow_provider_cancel_eof_and_kill_never_replay() {
    use std::{
        io::Read,
        net::TcpListener,
        time::{Duration, Instant},
    };
    for action in ["cancel", "eof", "kill"] {
        let f = Fixture::new();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        set_endpoint(
            &f,
            &format!(
                "http://{}/v1/chat/completions",
                listener.local_addr().unwrap()
            ),
        );
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            http_support::read_request(&mut socket);
            socket
                .set_read_timeout(Some(Duration::from_secs(4)))
                .unwrap();
            socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: 100000\r\n\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n").unwrap();
            let mut b = [0; 1];
            match socket.read(&mut b) {
                Ok(0) => {}
                Err(e)
                    if matches!(
                        e.kind(),
                        std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::BrokenPipe
                    ) => {}
                other => panic!("连接未关闭: {other:?}"),
            }
            listener.set_nonblocking(true).unwrap();
            std::thread::sleep(Duration::from_millis(100));
            assert!(listener.accept().is_err());
        });
        let (mut child, mut input, mut output) = connect(&f);
        let session = rpc(
            &mut input,
            &mut output,
            "create",
            "sessions.create",
            json!({"title":"cancel","profileId":"local","workspaceId":null,"reuseDraft":false}),
        )["result"]["sessionId"]
            .as_str()
            .unwrap()
            .to_string();
        let p = send(&session, "slow", "hello");
        rpc(&mut input, &mut output, "send", "chat.send", p.clone());
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let page = rpc(
                &mut input,
                &mut output,
                "poll",
                "chat.events",
                json!({"sessionId":session,"requestId":"slow","afterSequence":0,"limit":256}),
            );
            if page["result"]["turn"]["assistantMessage"] == "partial" {
                break;
            }
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(5));
        }
        rpc(&mut input, &mut output, "duplicate", "chat.send", p.clone());
        let begin = Instant::now();
        if action == "cancel" {
            assert_eq!(
                rpc(
                    &mut input,
                    &mut output,
                    "cancel",
                    "chat.cancel",
                    json!({"sessionId":session,"requestId":"slow"})
                )["result"]["status"],
                "cancelled"
            );
            assert!(begin.elapsed() < Duration::from_millis(500));
        }
        if action == "kill" {
            child.kill().unwrap();
        }
        drop(input);
        child.wait().unwrap();
        assert!(begin.elapsed() < Duration::from_secs(2));
        server.join().unwrap();
        let (mut child, mut input, mut output) = connect(&f);
        let replay = rpc(&mut input, &mut output, "replay", "chat.send", p);
        assert_eq!(
            replay["result"]["status"],
            if action == "cancel" {
                "cancelled"
            } else {
                "interrupted"
            }
        );
        assert_eq!(replay["result"]["assistantMessage"], "partial");
        drop(input);
        assert!(child.wait().unwrap().success());
    }
}
#[test]
fn event_page_includes_snapshot_in_serialized_byte_budget() {
    use std::{
        net::TcpListener,
        time::{Duration, Instant},
    };
    let f = Fixture::new();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    set_endpoint(
        &f,
        &format!(
            "http://{}/v1/chat/completions",
            listener.local_addr().unwrap()
        ),
    );
    let server = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        http_support::read_request_with_limit(&mut socket, 1024 * 1024);
        let chunk = json!({"choices":[{"delta":{"content":"\0".repeat(2000)}}]});
        let body = format!(
            "{}data: [DONE]\n\n",
            format!("data: {chunk}\n\n").repeat(130)
        );
        write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
    });
    let (mut child, mut input, mut output) = connect(&f);
    let sid = rpc(
        &mut input,
        &mut output,
        "create",
        "sessions.create",
        json!({"title":"bounded","profileId":"local","workspaceId":null,"reuseDraft":false}),
    )["result"]["sessionId"]
        .as_str()
        .unwrap()
        .to_string();
    rpc(
        &mut input,
        &mut output,
        "send",
        "chat.send",
        send(&sid, "bounded", &("\0".repeat(65000) + "x")),
    );
    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        let history = rpc(
            &mut input,
            &mut output,
            "history",
            "sessions.history",
            json!({"sessionId":sid,"after":0,"limit":1}),
        );
        if history["result"]["turns"][0]["status"] == "completed" {
            break;
        }
        assert!(Instant::now() < deadline, "分页fixture未完成");
        std::thread::sleep(Duration::from_millis(100));
    }
    let page = rpc(
        &mut input,
        &mut output,
        "events",
        "chat.events",
        json!({"sessionId":sid,"requestId":"bounded","afterSequence":0,"limit":256}),
    );
    assert!(serde_json::to_vec(&page["result"]).unwrap().len() <= 2 * 1024 * 1024);
    assert_eq!(page["result"]["hasMore"], true);
    drop(input);
    assert!(child.wait().unwrap().success());
    server.join().unwrap();
}
