#[path = "support/http.rs"]
mod http_support;
// 仅连接数字回环的合成HTTP协议测试。
use std::{io::Write, net::TcpListener, sync::atomic::AtomicBool, thread};
use tinker_rust_foundation::{
    chat_http::{ChatHttpConfig, ChatHttpProvider},
    run_provider::RunProvider,
};
fn run(body: &str) -> (Result<(), String>, String) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!(
        "http://{}/v1/chat/completions",
        listener.local_addr().unwrap()
    );
    let response=format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body);
    let server = thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        http_support::read_request(&mut socket);
        for byte in response.bytes() {
            if socket.write_all(&[byte]).is_err() {
                break;
            }
        }
    });
    let provider = ChatHttpProvider::new(
        ChatHttpConfig::new(url, "fake-token".into(), "synthetic-model".into()).unwrap(),
    );
    let mut output = String::new();
    let result = provider
        .execute("synthetic input", &AtomicBool::new(false), &mut |text| {
            output.push_str(text);
            Ok(())
        })
        .map_err(|e| e.code().to_owned());
    server.join().unwrap();
    (result, output)
}
#[test]
fn fragmented_utf8_and_finish() {
    let(r,o)=run(": comment\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"你好\"},\"finish_reason\":null}]}\r\n\r\ndata: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n");
    assert_eq!(r, Ok(()));
    assert_eq!(o, "你好");
}
#[test]
fn incomplete_and_bad_frames_preserve_partial() {
    for tail in [
        "",
        "data: broken\n\n",
        "data: {\"choices\":[{\"delta\":{\"tool_calls\":[]}}]}\n\n",
    ] {
        let (r, o) = run(&format!(
            "data: {{\"choices\":[{{\"delta\":{{\"content\":\"partial\"}}}}]}}\n\n{tail}"
        ));
        assert!(r.is_err());
        assert_eq!(o, "partial");
    }
}
#[test]
fn unsafe_configuration_rejected() {
    for url in [
        "http://user:secret@127.0.0.1/",
        "http://127.0.0.1/?key=secret",
        "http://127.0.0.1/#secret",
        "file:///tmp/secret",
        "http://example.invalid/v1/chat/completions",
        "http://localhost/v1/chat/completions",
    ] {
        assert!(ChatHttpConfig::new(url.into(), "fake".into(), "model".into()).is_err());
    }
}

#[test]
fn reflected_credential_across_frames_is_never_emitted() {
    let (result,output)=run("data: {\"choices\":[{\"delta\":{\"content\":\"safe fake-\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"token\"}}]}\n\ndata: [DONE]\n\n");
    assert!(result.is_err());
    assert_eq!(output, "safe ");
}

#[test]
fn nullable_metadata_and_sse_line_endings() {
    for newline in ["\n", "\r\n", "\r"] {
        let body=format!("\u{feff}data: {{\"choices\":[{{\"delta\":{{\"role\":\"assistant\",\"content\":\"A\",\"refusal\":null,\"tool_calls\":null}}}}]}}{newline}{newline}data: [DONE]{newline}{newline}");
        let (result, output) = run(&body);
        assert_eq!(result, Ok(()));
        assert_eq!(output, "A");
    }
}

#[test]
fn domain_requires_trusted_pins_and_ipv6_is_supported() {
    assert!(ChatHttpConfig::new(
        "https://synthetic.invalid/v1/chat/completions".into(),
        "fake".into(),
        "model".into()
    )
    .is_err());
    assert!(ChatHttpConfig::new_with_pins(
        "https://synthetic.invalid/v1/chat/completions".into(),
        "fake".into(),
        "model".into(),
        vec!["127.0.0.1:443".parse().unwrap()]
    )
    .is_ok());
    assert!(ChatHttpConfig::new_with_pins(
        "https://synthetic.invalid/".into(),
        "fake".into(),
        "model".into(),
        vec!["0.0.0.0:443".parse().unwrap()]
    )
    .is_err());
    assert!(ChatHttpConfig::new(
        "http://[::1]:1234/v1/chat/completions".into(),
        "fake".into(),
        "model".into()
    )
    .is_ok());
}

#[test]
fn multiline_data_usage_and_actual_nontext() {
    let(result,output)=run("data: {\"choices\":\ndata: [{\"delta\":{\"content\":\"A\"}}]}\n\ndata: {\"choices\":[],\"usage\":{\"total_tokens\":1}}\n\ndata: [DONE]\n\n");
    assert_eq!(result, Ok(()));
    assert_eq!(output, "A");
    for delta in [
        "{\"tool_calls\":[]}",
        "{\"refusal\":\"denied\"}",
        "{\"content\":[]}",
    ] {
        assert_eq!(
            run(&format!(
                "data: {{\"choices\":[{{\"delta\":{delta}}}]}}\n\n"
            ))
            .0,
            Err("httpUnsupported".into())
        );
    }
}
