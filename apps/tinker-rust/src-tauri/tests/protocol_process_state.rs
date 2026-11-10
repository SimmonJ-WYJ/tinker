//! 正式进程跨协议绑定与失败/取消状态；全部使用合成回环。
#[path = "support/http.rs"]
mod http_support;
#[allow(dead_code)]
#[path = "support/protocol_http.rs"]
mod protocol_http;
#[allow(dead_code)]
#[path = "support/desktop_process.rs"]
mod support;
use protocol_http::*;
use serde_json::{json, Value};
use std::{
    fs,
    io::{Read, Write},
    net::TcpListener,
    sync::mpsc,
    time::{Duration, Instant},
};
use support::*;
fn configure(f: &Fixture, listener: &TcpListener) {
    let profiles=[("local","anthropic-messages","/v1/messages"),("other","openai-chat","/v1/chat/completions")].map(|(id,protocol,path)|json!({"profileId":id,"label":"自定义","configRevision":format!("{id}-r1"),"protocol":protocol,"models":[{"modelId":format!("vendor/{id}.v1:tag"),"label":"Alias","supportedEfforts":["low","medium","high"]}],"endpoint":format!("http://{}{path}",listener.local_addr().unwrap()),"key":"fake-secret-token"}));
    fs::write(&f.config, json!(profiles).to_string()).unwrap();
}
fn create(
    input: &mut std::process::ChildStdin,
    output: &mut std::io::BufReader<std::process::ChildStdout>,
) -> String {
    rpc(
        input,
        output,
        "create",
        "sessions.create",
        json!({"title":"合成","profileId":"local","workspaceId":null,"reuseDraft":false}),
    )["result"]["sessionId"]
        .as_str()
        .unwrap()
        .to_string()
}
fn params(sid: &str, request: &str, profile: &str, effort: &str) -> Value {
    let mut p = send(sid, request, request);
    p["profileId"] = json!(profile);
    p["modelId"] = json!(format!("vendor/{profile}.v1:tag"));
    p["effort"] = json!(effort);
    p
}
fn answer(socket: &mut std::net::TcpStream, body: &str) {
    write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
}
#[test]
fn cross_protocol_switch_restart_and_replay_keep_identity_and_five_roles() {
    let f = Fixture::new();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    configure(&f, &listener);
    let server = std::thread::spawn(move || {
        let mut requests = Vec::new();
        for _ in 0..3 {
            let (mut socket, _) = listener.accept().unwrap();
            let bytes = http_support::read_request(&mut socket);
            let at = bytes.windows(4).position(|b| b == b"\r\n\r\n").unwrap() + 4;
            let header = std::str::from_utf8(&bytes[..at]).unwrap();
            let body: Value = serde_json::from_slice(&bytes[at..]).unwrap();
            answer(
                &mut socket,
                &if header.starts_with("POST /v1/messages ") {
                    anthropic("B")
                } else {
                    "data: {\"choices\":[{\"delta\":{\"content\":\"A\"}}]}\n\ndata: [DONE]\n\n"
                        .into()
                },
            );
            requests.push(body);
        }
        (listener, requests)
    });
    let (mut child, mut input, mut output) = connect(&f);
    let sid = create(&mut input, &mut output);
    let first = params(&sid, "first", "other", "high");
    let second = params(&sid, "second", "local", "medium");
    for p in [&first, &second] {
        assert!(rpc(&mut input, &mut output, "send", "chat.send", p.clone())
            .get("result")
            .is_some());
        let page = terminal(
            &mut input,
            &mut output,
            &sid,
            p["requestId"].as_str().unwrap(),
        );
        assert_eq!(page["turn"]["status"], "completed");
        assert_eq!(page["turn"]["effort"], p["effort"]);
    }
    drop(input);
    assert!(child.wait().unwrap().success());
    let (mut child, mut input, mut output) = connect(&f);
    let replay = rpc(&mut input, &mut output, "old", "chat.send", first.clone());
    assert_eq!(replay["result"]["profileId"], "other");
    assert_eq!(replay["result"]["configRevision"], "other-r1");
    assert_eq!(replay["result"]["effort"], "high");
    assert_eq!(
        rpc(&mut input, &mut output, "list", "sessions.list", json!({}))["result"]["sessions"][0]
            ["profileId"],
        "local"
    );
    let mut conflict = first;
    conflict["effort"] = json!("low");
    assert_eq!(
        rpc(&mut input, &mut output, "conflict", "chat.send", conflict)["error"]["code"],
        "requestConflict"
    );
    let third = params(&sid, "third", "other", "low");
    assert!(rpc(&mut input, &mut output, "send", "chat.send", third)
        .get("result")
        .is_some());
    assert_eq!(
        terminal(&mut input, &mut output, &sid, "third")["turn"]["status"],
        "completed"
    );
    drop(input);
    assert!(child.wait().unwrap().success());
    let (listener, bodies) = server.join().unwrap();
    listener.set_nonblocking(true).unwrap();
    assert!(listener.accept().is_err());
    assert_eq!(
        bodies
            .iter()
            .map(|b| b["messages"].as_array().unwrap().len())
            .collect::<Vec<_>>(),
        vec![1, 3, 5]
    );
    assert_eq!(bodies[0]["reasoning_effort"], "high");
    assert_eq!(bodies[1]["output_config"]["effort"], "medium");
    assert_eq!(bodies[2]["reasoning_effort"], "low");
    assert_eq!(
        bodies[2]["messages"],
        json!([{"role":"user","content":"first"},{"role":"assistant","content":"A"},{"role":"user","content":"second"},{"role":"assistant","content":"B"},{"role":"user","content":"third"}])
    );
}
#[test]
fn anthropic_tool_failure_preserves_partial_and_retry_skips_failed_ancestor() {
    let f = Fixture::new();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    configure(&f, &listener);
    let server = std::thread::spawn(move || {
        let mut bodies = Vec::new();
        for n in 0..3 {
            let (mut socket, _) = listener.accept().unwrap();
            let bytes = http_support::read_request(&mut socket);
            let at = bytes.windows(4).position(|b| b == b"\r\n\r\n").unwrap() + 4;
            bodies.push(serde_json::from_slice::<Value>(&bytes[at..]).unwrap());
            let body = if n == 1 {
                [start(),block(0),delta(0,"partial"),stop(0),event("content_block_start",json!({"index":1,"content_block":{"type":"tool_use","name":"never_execute","input":{}}}))].concat()
            } else {
                anthropic("success")
            };
            answer(&mut socket, &body);
        }
        bodies
    });
    let (mut child, mut input, mut output) = connect(&f);
    let sid = create(&mut input, &mut output);
    for request in ["success", "unsupported", "retry"] {
        let p = params(&sid, request, "local", "high");
        assert!(rpc(&mut input, &mut output, "send", "chat.send", p)
            .get("result")
            .is_some());
        let page = terminal(&mut input, &mut output, &sid, request);
        if request == "unsupported" {
            assert_eq!(page["turn"]["status"], "failed");
            assert_eq!(page["turn"]["errorCode"], "httpUnsupported");
            assert_eq!(page["turn"]["assistantMessage"], "partial");
        } else {
            assert_eq!(page["turn"]["status"], "completed");
        }
    }
    drop(input);
    assert!(child.wait().unwrap().success());
    let bodies = server.join().unwrap();
    assert_eq!(
        bodies
            .iter()
            .map(|b| b["messages"].as_array().unwrap().len())
            .collect::<Vec<_>>(),
        vec![1, 3, 3]
    );
    assert!(!bodies[2].to_string().contains("partial"));
}
#[test]
fn concurrent_anthropic_cancel_discards_late_text_and_closes_sockets() {
    let f = Fixture::new();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    configure(&f, &listener);
    let (tx, rx) = mpsc::channel();
    let server = std::thread::spawn(move || {
        let mut workers = Vec::new();
        for _ in 0..2 {
            let (mut socket, _) = listener.accept().unwrap();
            let tx = tx.clone();
            workers.push(std::thread::spawn(move||{http_support::read_request(&mut socket);write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n{}",[start(),block(0),delta(0,"confirmed")].concat()).unwrap();socket.flush().unwrap();tx.send(()).unwrap();socket.set_read_timeout(Some(Duration::from_secs(2))).unwrap();let mut b=[0;1];match socket.read(&mut b){Ok(0)=>{},Err(e)if matches!(e.kind(),std::io::ErrorKind::ConnectionReset|std::io::ErrorKind::ConnectionAborted)=>{},r=>panic!("未释放socket {r:?}")};let _=socket.write_all(delta(0,"late text").as_bytes());}));
        }
        for w in workers {
            w.join().unwrap();
        }
    });
    let (mut child, mut input, mut output) = connect(&f);
    let sessions = [
        create(&mut input, &mut output),
        create(&mut input, &mut output),
    ];
    for (n, sid) in sessions.iter().enumerate() {
        assert!(rpc(
            &mut input,
            &mut output,
            "send",
            "chat.send",
            params(sid, &format!("r{n}"), "local", "high")
        )
        .get("result")
        .is_some());
    }
    rx.recv_timeout(Duration::from_secs(2)).unwrap();
    rx.recv_timeout(Duration::from_secs(2)).unwrap();
    for (n, sid) in sessions.iter().enumerate() {
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            let page = rpc(
                &mut input,
                &mut output,
                "poll",
                "chat.events",
                json!({"sessionId":sid,"requestId":format!("r{n}"),"afterSequence":0,"limit":256}),
            );
            if page["result"]["turn"]["assistantMessage"] == "confirmed" {
                break;
            }
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(5));
        }
    }
    let at = Instant::now();
    for (n, sid) in sessions.iter().enumerate() {
        rpc(
            &mut input,
            &mut output,
            "cancel",
            "chat.cancel",
            json!({"sessionId":sid,"requestId":format!("r{n}")}),
        );
    }
    assert!(at.elapsed() < Duration::from_millis(500));
    for (n, sid) in sessions.iter().enumerate() {
        let page = terminal(&mut input, &mut output, sid, &format!("r{n}"));
        assert_eq!(page["turn"]["status"], "cancelled");
        assert_eq!(page["turn"]["assistantMessage"], "confirmed");
        assert!(!page.to_string().contains("late text"));
    }
    drop(input);
    assert!(child.wait().unwrap().success());
    server.join().unwrap();
}
#[test]
fn runtime_accepts_multiple_top_level_deltas_without_losing_stop_reason() {
    let f = Fixture::new();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    configure(&f, &listener);
    let server = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        http_support::read_request(&mut socket);
        let body = [
            start(),
            block(0),
            delta(0, "confirmed"),
            stop(0),
            event("message_delta", json!({"usage":{"output_tokens":3}})),
            event(
                "message_delta",
                json!({"delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":4}}),
            ),
            event(
                "message_delta",
                json!({"delta":{"stop_reason":null},"usage":{"output_tokens":5}}),
            ),
            event("message_stop", json!({})),
        ]
        .concat();
        answer(&mut socket, &body);
    });
    let (mut child, mut input, mut output) = connect(&f);
    let sid = create(&mut input, &mut output);
    assert!(rpc(
        &mut input,
        &mut output,
        "send",
        "chat.send",
        params(&sid, "multi", "local", "high")
    )
    .get("result")
    .is_some());
    let page = terminal(&mut input, &mut output, &sid, "multi");
    assert_eq!(page["turn"]["status"], "completed");
    assert_eq!(page["turn"]["assistantMessage"], "confirmed");
    drop(input);
    assert!(child.wait().unwrap().success());
    server.join().unwrap();
}
