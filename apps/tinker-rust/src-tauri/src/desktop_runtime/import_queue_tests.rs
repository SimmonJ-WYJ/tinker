//! 导入seed的上下文拒绝只能终结所属chain，不能冻结其他会话。
use super::{
    import_tests::{call, profiles, source, Temp},
    *,
};
use std::{
    io::{Read, Write},
    net::TcpListener,
    time::{Duration, Instant},
};
#[test]
fn imported_queue_context_limit_closes_only_that_chain_before_binding() {
    let t = Temp::new();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/chat", listener.local_addr().unwrap());
    let server = std::thread::spawn(move || {
        for _ in 0..2 {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut bytes = Vec::new();
            loop {
                let mut buf = [0; 4096];
                let n = socket.read(&mut buf).unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&buf[..n]);
                assert!(bytes.len() < 65536);
                if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    let header = String::from_utf8_lossy(&bytes[..end]);
                    let len: usize = header
                        .lines()
                        .find_map(|v| {
                            v.to_ascii_lowercase()
                                .strip_prefix("content-length: ")
                                .map(str::to_owned)
                        })
                        .unwrap()
                        .parse()
                        .unwrap();
                    if bytes.len() >= end + 4 + len {
                        break;
                    }
                }
            }
            let body = "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\ndata: [DONE]\n\n";
            write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
        }
        listener.set_nonblocking(true).unwrap();
        std::thread::sleep(Duration::from_millis(30));
        assert!(listener.accept().is_err());
    });
    let runtime = DesktopRuntime::open_with_queueing(&t.0, profiles(&endpoint), vec![]).unwrap();
    let mut src = source();
    src.messages = (0..32)
        .map(|i| crate::electron_import::SourceMessage {
            id: format!("synthetic-{i}"),
            role: if i % 2 == 0 { "user" } else { "assistant" }.into(),
            text: "old".into(),
            created_at: 101,
            attachment_ids: vec![],
        })
        .collect();
    let sid = runtime
        .import_electron_session(&src, "synthetic-local", |_| Ok(vec![]))
        .unwrap()
        .session_id;
    let params = |sid: &str, id: &str| json!({"sessionId":sid,"requestId":id,"profileId":"synthetic-local","modelId":"synthetic-model","userMessage":"new","startedAt":300,"effort":null});
    call(&runtime, "chat.beginChain", params(&sid, "first-native"));
    wait(&runtime, &sid, "first-native");
    let accepted = call(
        &runtime,
        "chat.queue",
        json!({"sessionId":sid,"chainId":"first-native","uuid":"over-limit-next","userMessage":"queued","interrupt":false}),
    );
    let reply=runtime.dispatch(json!({"version":1,"id":"advance","method":"chat.advanceQueue","params":{"sessionId":sid,"chainId":"first-native","expectedActiveRequestId":"first-native","expectedQueueRevision":accepted["revision"]}})).unwrap();
    assert_eq!(reply.error.unwrap().code, "contextLimitExceeded");
    let state = call(
        &runtime,
        "chat.queueState",
        json!({"sessionId":sid,"chainId":"first-native"}),
    );
    assert_eq!(state["closureReason"], "failure");
    assert_eq!(state["messages"][0]["disposition"], "abandoned");
    assert_eq!(runtime.inner.lock().unwrap().bindings[&sid].len(), 1);
    assert!(!runtime.inner.lock().unwrap().queue_blocked);
    let other=call(&runtime,"sessions.create",json!({"title":"other native session","profileId":"synthetic-local","workspaceId":null,"reuseDraft":false}))["sessionId"].as_str().unwrap().to_owned();
    call(&runtime, "chat.beginChain", params(&other, "other-native"));
    wait(&runtime, &other, "other-native");
    server.join().unwrap();
}
fn wait(runtime: &DesktopRuntime, sid: &str, rid: &str) {
    let until = Instant::now() + Duration::from_secs(5);
    loop {
        let v = call(
            runtime,
            "chat.events",
            json!({"sessionId":sid,"requestId":rid,"afterSequence":0,"limit":64}),
        );
        if v["turn"]["status"] == "completed" {
            break;
        }
        assert!(Instant::now() < until, "{v}");
        std::thread::sleep(Duration::from_millis(5));
    }
}
