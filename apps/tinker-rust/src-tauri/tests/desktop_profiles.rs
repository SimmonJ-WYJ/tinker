use serde_json::{json, Value};
use std::{fs, io::Write};
#[path = "support/desktop_process.rs"]
mod support;
use support::*;
#[path = "support/http.rs"]
mod http_support;
#[test]
fn unsupported_tool_preserves_partial_and_retry_uses_last_successful_parent() {
    use std::net::TcpListener;
    let f = Fixture::new();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    set_endpoint(
        &f,
        &format!("http://{}/chat", listener.local_addr().unwrap()),
    );
    let server = std::thread::spawn(move || {
        let mut bodies = Vec::new();
        for n in 0..3 {
            let (mut socket, _) = listener.accept().unwrap();
            let bytes = http_support::read_request(&mut socket);
            let at = bytes.windows(4).position(|b| b == b"\r\n\r\n").unwrap() + 4;
            bodies.push(serde_json::from_slice::<Value>(&bytes[at..]).unwrap());
            let body = if n == 1 {
                "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"function\":{\"name\":\"never_execute\",\"arguments\":\"{}\"}}]}}]}\n\ndata: [DONE]\n\n"
            } else {
                "data: {\"choices\":[{\"delta\":{\"content\":\"success\"}}]}\n\ndata: [DONE]\n\n"
            };
            write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
        }
        bodies
    });
    let (mut child, mut input, mut output) = connect(&f);
    let sid = rpc(
        &mut input,
        &mut output,
        "create",
        "sessions.create",
        json!({"title":"lineage","profileId":"local","workspaceId":null,"reuseDraft":false}),
    )["result"]["sessionId"]
        .as_str()
        .unwrap()
        .to_string();
    for request in ["success", "unsupported", "retry"] {
        rpc(
            &mut input,
            &mut output,
            "send",
            "chat.send",
            send(&sid, request, request),
        );
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
    assert_eq!(bodies[2]["messages"][0]["content"], "success");
    assert!(!bodies[2].to_string().contains("partial"));
}
#[test]
fn switching_profiles_preserves_turn_identity_context_and_old_replay() {
    use std::net::TcpListener;
    let f = Fixture::new();
    let a = TcpListener::bind("127.0.0.1:0").unwrap();
    let b = TcpListener::bind("127.0.0.1:0").unwrap();
    let profile = |id: &str, listener: &TcpListener| json!({"profileId":id,"label":id,"configRevision":"r1","models":[{"modelId":format!("vendor/{id}.v1:tag"),"label":id}],"endpoint":format!("http://{}/chat",listener.local_addr().unwrap()),"key":format!("fake-secret-{id}")});
    fs::write(
        &f.config,
        json!([profile("local", &a), profile("other", &b)]).to_string(),
    )
    .unwrap();
    let server = |listener: TcpListener| {
        std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let bytes = http_support::read_request(&mut socket);
            let start = bytes.windows(4).position(|b| b == b"\r\n\r\n").unwrap() + 4;
            let body: Value = serde_json::from_slice(&bytes[start..]).unwrap();
            let answer =
                "data: {\"choices\":[{\"delta\":{\"content\":\"response\"}}]}\n\ndata: [DONE]\n\n";
            write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{answer}",answer.len()).unwrap();
            (listener, body)
        })
    };
    let sa = server(a);
    let sb = server(b);
    let (mut child, mut input, mut output) = connect(&f);
    let sid = rpc(
        &mut input,
        &mut output,
        "create",
        "sessions.create",
        json!({"title":"switch","profileId":"local","workspaceId":null,"reuseDraft":false}),
    )["result"]["sessionId"]
        .as_str()
        .unwrap()
        .to_string();
    let mut first = send(&sid, "first", "first");
    first["profileId"] = json!("other");
    first["modelId"] = json!("vendor/other.v1:tag");
    let start = rpc(&mut input, &mut output, "send", "chat.send", first.clone());
    assert!(start.get("result").is_some(), "{start}");
    terminal(&mut input, &mut output, &sid, "first");
    let mut second = send(&sid, "second", "second");
    second["modelId"] = json!("vendor/local.v1:tag");
    rpc(&mut input, &mut output, "send", "chat.send", second);
    terminal(&mut input, &mut output, &sid, "second");
    assert_eq!(
        rpc(&mut input, &mut output, "old", "chat.send", first.clone())["result"]["profileId"],
        "other"
    );
    assert_eq!(
        rpc(&mut input, &mut output, "list", "sessions.list", json!({}))["result"]["sessions"][0]
            ["profileId"],
        "local"
    );
    drop(input);
    assert!(child.wait().unwrap().success());
    let (mut child, mut input, mut output) = connect(&f);
    assert_eq!(
        rpc(&mut input, &mut output, "old", "chat.send", first)["result"]["profileId"],
        "other"
    );
    assert_eq!(
        rpc(&mut input, &mut output, "list", "sessions.list", json!({}))["result"]["sessions"][0]
            ["profileId"],
        "local"
    );
    let history = rpc(
        &mut input,
        &mut output,
        "history",
        "sessions.history",
        json!({"sessionId":sid,"after":0,"limit":128}),
    );
    assert_eq!(history["result"]["turns"][0]["profileId"], "other");
    assert_eq!(history["result"]["turns"][1]["profileId"], "local");
    drop(input);
    assert!(child.wait().unwrap().success());
    for (server, count, model) in [
        (sa, 3, "vendor/local.v1:tag"),
        (sb, 1, "vendor/other.v1:tag"),
    ] {
        let (listener, body) = server.join().unwrap();
        assert_eq!(body["model"], model);
        assert_eq!(body["messages"].as_array().unwrap().len(), count);
        listener.set_nonblocking(true).unwrap();
        assert!(listener.accept().is_err());
    }
}
