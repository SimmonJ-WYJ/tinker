//! Messages不可信响应的真实HTTP边界；无provider外呼，无工具runner。
#[path = "support/http.rs"]
mod http_support;
#[allow(dead_code)]
#[path = "support/protocol_http.rs"]
mod protocol_http;
use protocol_http::*;
use serde_json::json;
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    thread,
    time::{Duration, Instant},
};
use tinker_rust_foundation::{
    chat_http::{ChatHttpConfig, ChatHttpProvider, HttpProtocol},
    run_provider::RunProvider,
};
fn provider(endpoint: String, total: Duration, idle: Duration) -> ChatHttpProvider {
    ChatHttpProvider::new(
        ChatHttpConfig::new(
            endpoint,
            "fake-secret-token".into(),
            "claude-opus-4-6".into(),
        )
        .unwrap()
        .with_protocol(HttpProtocol::AnthropicMessages, Some("high"))
        .unwrap()
        .with_timeouts(total, idle)
        .unwrap(),
    )
}
fn run(status: u16, body: String) -> (Result<(), String>, String) {
    run_bytes(status, body.into_bytes())
}
fn run_bytes(status: u16, body: Vec<u8>) -> (Result<(), String>, String) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/v1/messages", listener.local_addr().unwrap());
    let server = thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        http_support::read_request(&mut socket);
        let mut response=format!("HTTP/1.1 {status} Synthetic\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",body.len()).into_bytes();
        response.extend_from_slice(&body);
        let _ = socket.write_all(&response);
        listener.set_nonblocking(true).unwrap();
        thread::sleep(Duration::from_millis(10));
        assert!(listener.accept().is_err());
    });
    let mut output = String::new();
    let result = provider(endpoint, Duration::from_secs(3), Duration::from_secs(1))
        .execute("synthetic", &AtomicBool::new(false), &mut |s| {
            output.push_str(s);
            Ok(())
        })
        .map_err(|e| e.code().to_string());
    server.join().unwrap();
    (result, output)
}
#[test]
fn malformed_state_and_incomplete_stream_preserve_confirmed_text() {
    let prefix = [start(), block(0), delta(0, "confirmed")].concat();
    let tails = [
        String::new(),
        event(
            "content_block_delta",
            json!({"index":1,"delta":{"type":"text_delta","text":"wrong"}}),
        ),
        block(1),
        finish("end_turn"),
        event("message_stop", json!({})),
        event(
            "message_start",
            json!({"message":{"type":"message","role":"assistant","content":[]}}),
        ),
        "event: ping\ndata: {\"type\":\"message_stop\"}\n\n".into(),
        "event: content_block_delta\ndata: broken\n\n".into(),
        "event: content_block_delta\ndata: {\"type\":\"content_block_delta\"}".into(),
    ];
    for tail in tails {
        let (r, o) = run(200, prefix.clone() + &tail);
        assert_eq!(r, Err("httpProtocol".into()));
        assert_eq!(o, "confirmed");
    }
}
#[test]
fn unsupported_content_and_stops_never_execute_tools() {
    for kind in [
        "tool_use",
        "server_tool_use",
        "thinking",
        "redacted_thinking",
        "image",
        "audio",
    ] {
        let body = [
            start(),
            block(0),
            delta(0, "confirmed"),
            stop(0),
            event(
                "content_block_start",
                json!({"index":1,"content_block":{"type":kind,"name":"never_execute","input":{}}}),
            ),
        ]
        .concat();
        let (r, o) = run(200, body);
        assert_eq!(r, Err("httpUnsupported".into()));
        assert_eq!(o, "confirmed");
    }
    for kind in [
        "input_json_delta",
        "thinking_delta",
        "signature_delta",
        "citations_delta",
    ] {
        let body = [
            start(),
            block(0),
            delta(0, "confirmed"),
            event(
                "content_block_delta",
                json!({"index":0,"delta":{"type":kind,"partial_json":"{}"}}),
            ),
        ]
        .concat();
        let (r, o) = run(200, body);
        assert_eq!(r, Err("httpUnsupported".into()));
        assert_eq!(o, "confirmed");
    }
    for (reason, code) in [
        ("max_tokens", "httpProtocol"),
        ("tool_use", "httpUnsupported"),
        ("pause_turn", "httpUnsupported"),
        ("stop_sequence", "httpUnsupported"),
        ("refusal", "httpUnsupported"),
        ("future", "httpUnsupported"),
    ] {
        let (r, o) = run(
            200,
            [
                start(),
                block(0),
                delta(0, "confirmed"),
                stop(0),
                finish(reason),
            ]
            .concat(),
        );
        assert_eq!(r, Err(code.into()));
        assert_eq!(o, "confirmed");
    }
}
#[test]
fn unknown_events_multiblock_and_empty_success_are_compatible() {
    for body in [
        [
            start(),
            event("future_event", json!({"future":"ignored"})),
            block(0),
            delta(0, "你"),
            stop(0),
            block(1),
            delta(1, "好"),
            stop(1),
            finish("end_turn"),
        ]
        .concat(),
        [start(), finish("end_turn")].concat(),
    ] {
        let (r, o) = run(200, body);
        assert_eq!(r, Ok(()));
        assert!(o == "你好" || o.is_empty());
    }
}
#[test]
fn credential_reflection_error_bodies_and_event_errors_are_redacted() {
    let (r, o) = run(
        200,
        [
            start(),
            block(0),
            delta(0, "confirmed fake-"),
            delta(0, "secret-token"),
            stop(0),
            finish("end_turn"),
        ]
        .concat(),
    );
    assert_eq!(r, Err("httpProtocol".into()));
    assert_eq!(o, "confirmed ");
    for status in [401, 429, 500] {
        let (r, o) = run(status, "fake-secret-token private error".into());
        assert_eq!(r, Err("httpStatus".into()));
        assert!(o.is_empty());
    }
    let (r, o) = run(
        200,
        [
            start(),
            block(0),
            delta(0, "confirmed"),
            event("error", json!({"error":{"message":"fake-secret-token"}})),
        ]
        .concat(),
    );
    assert_eq!(r, Err("httpProtocol".into()));
    assert_eq!(o, "confirmed");
}
#[test]
fn frame_json_and_total_stream_limits_preserve_partial() {
    let prefix = [start(), block(0), delta(0, "confirmed")].concat();
    for tail in [
        format!(":{}\n\n", "x".repeat(65536)),
        ":padding\n\n".repeat(220000),
        "data: ÿ\n\n".into(),
    ] {
        let expected = if tail.starts_with("data:") {
            "httpProtocol"
        } else {
            "runLimitExceeded"
        };
        let (r, o) = run(200, prefix.clone() + &tail);
        assert_eq!(r, Err(expected.into()));
        assert_eq!(o, "confirmed");
    }
}
#[test]
fn cancellation_idle_and_total_timeout_drop_socket_and_keep_partial() {
    for mode in ["cancel", "idle", "total"] {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}/v1/messages", listener.local_addr().unwrap());
        let (tx, rx) = mpsc::channel();
        let cancelled = Arc::new(AtomicBool::new(false));
        let token = cancelled.clone();
        let server = thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            http_support::read_request(&mut socket);
            write!(
                socket,
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n{}",
                [start(), block(0), delta(0, "confirmed")].concat()
            )
            .unwrap();
            socket.flush().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            tx.send(()).unwrap();
            if mode == "total" {
                for _ in 0..40 {
                    if socket
                        .write_all(b"event: ping\ndata: {\"type\":\"ping\"}\n\n")
                        .is_err()
                    {
                        break;
                    }
                    thread::sleep(Duration::from_millis(10));
                }
            }
            let mut b = [0; 1];
            match socket.read(&mut b) {
                Ok(0) => {}
                Err(e)
                    if matches!(
                        e.kind(),
                        std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::ConnectionAborted
                    ) => {}
                r => panic!("socket未关闭: {r:?}"),
            }
        });
        let worker = thread::spawn(move || {
            let mut output = String::new();
            let result = provider(
                endpoint,
                Duration::from_millis(220),
                Duration::from_millis(90),
            )
            .execute("synthetic", &token, &mut |s| {
                output.push_str(s);
                Ok(())
            })
            .map_err(|e| e.code().to_string());
            (result, output)
        });
        rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let at = Instant::now();
        if mode == "cancel" {
            thread::sleep(Duration::from_millis(20));
            cancelled.store(true, Ordering::Release);
        }
        let (r, o) = worker.join().unwrap();
        assert_eq!(o, "confirmed");
        assert_eq!(
            r,
            if mode == "cancel" {
                Ok(())
            } else {
                Err("httpTimeout".into())
            }
        );
        assert!(at.elapsed() < Duration::from_millis(600));
        server.join().unwrap();
    }
}
#[test]
fn repeated_message_deltas_keep_confirmed_stop_reason_and_reject_conflicts() {
    let prefix = [start(), block(0), delta(0, "confirmed"), stop(0)].concat();
    let end = event(
        "message_delta",
        json!({"delta":{"stop_reason":"end_turn","stop_sequence":null}}),
    );
    let usage = event("message_delta", json!({"usage":{"output_tokens":12}}));
    let null = event(
        "message_delta",
        json!({"delta":{"stop_reason":null},"usage":{"output_tokens":13}}),
    );
    let empty = event(
        "message_delta",
        json!({"delta":{},"usage":{"output_tokens":14}}),
    );
    let stop = event("message_stop", json!({}));
    for middle in [
        end.clone() + &usage,
        usage.clone() + &end + &null,
        end.clone() + &null + &empty,
        end.clone() + &end,
    ] {
        let (r, o) = run(200, prefix.clone() + &middle + &stop);
        assert_eq!(r, Ok(()));
        assert_eq!(o, "confirmed");
    }
    let (r, o) = run(200, prefix.clone() + &usage + &null + &empty + &stop);
    assert_eq!(r, Err("httpProtocol".into()));
    assert_eq!(o, "confirmed");
    for (reason, code) in [
        ("tool_use", "httpUnsupported"),
        ("pause_turn", "httpUnsupported"),
        ("max_tokens", "httpProtocol"),
        ("future", "httpUnsupported"),
    ] {
        let conflict = event("message_delta", json!({"delta":{"stop_reason":reason}}));
        for updates in [end.clone() + &conflict, conflict.clone() + &end] {
            let (r, o) = run(200, prefix.clone() + &updates + &stop);
            assert_eq!(r, Err(code.into()));
            assert_eq!(o, "confirmed");
        }
    }
}

#[test]
fn invalid_utf8_bytes_fail_without_losing_confirmed_text() {
    let mut body = [start(), block(0), delta(0, "confirmed")]
        .concat()
        .into_bytes();
    body.extend_from_slice(b"event: content_block_delta\ndata: ");
    body.push(0xff);
    body.extend_from_slice(b"\n\n");
    let (r, o) = run_bytes(200, body);
    assert_eq!(r, Err("httpProtocol".into()));
    assert_eq!(o, "confirmed");
}
