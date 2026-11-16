//! owned fixture自身的网络与metadata边界；全部伪凭据、数字回环。
use serde_json::json;
use std::{
    io::{Read, Write},
    net::TcpStream,
    time::Duration,
};
use tinker_rust_foundation::{formal_mock::OwnedMock, formal_platform::MOCK_KEY};
fn post(mock: &OwnedMock, body: &str) -> String {
    let p = mock.profiles().unwrap();
    let endpoint = reqwest::Url::parse(&p[0].endpoint).unwrap();
    let mut s = TcpStream::connect(("127.0.0.1", endpoint.port().unwrap())).unwrap();
    s.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
    write!(s,"POST /v1/chat/completions HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {MOCK_KEY}\r\nContent-Length: {}\r\n\r\n{body}",body.len()).unwrap();
    let mut result = String::new();
    let _ = s.read_to_string(&mut result);
    result
}
#[test]
fn metadata_never_copies_arbitrary_request_fields_or_effort() {
    let mock = OwnedMock::start().unwrap();
    let request = json!({"model":"local-mock-a","reasoning_effort":"private-secret-value","messages":[{"role":"user","content":"private-request-body"}],"stream":true});
    post(&mock, &request.to_string());
    assert!(mock.records().is_empty(), "invalid effort不能进入metadata");
    let request = json!({"model":"local-mock-a","reasoning_effort":"medium","messages":[{"role":"user","content":"private-request-body"}],"stream":true});
    assert!(post(&mock, &request.to_string()).contains("[DONE]"));
    let metadata = serde_json::to_string(&mock.records()).unwrap();
    assert!(!metadata.contains("private-request"));
    assert!(metadata.contains("medium"));
}
#[test]
fn shutdown_joins_idle_connection_workers_and_releases_owned_listener() {
    let mut mock = OwnedMock::start().unwrap();
    let profile = mock.profiles().unwrap();
    let url = reqwest::Url::parse(&profile[0].endpoint).unwrap();
    let _idle = TcpStream::connect(("127.0.0.1", url.port().unwrap())).unwrap();
    let start = std::time::Instant::now();
    mock.shutdown();
    assert!(start.elapsed() < Duration::from_secs(2));
    assert!(TcpStream::connect(("127.0.0.1", url.port().unwrap())).is_err());
}

#[test]
fn tools_partial_error_emits_real_text_then_disconnects_without_terminal_sse() {
    let mock = OwnedMock::start_tools().unwrap();
    let request = json!({"model":"local-tools-mock","messages":[{"role":"user","content":"[partial-error] owned failure"}],"parallel_tool_calls":false,"tools":[{},{}],"stream":true});
    let response = post(&mock, &request.to_string());
    assert!(response.contains("Synthetic partial output before transport failure."));
    assert!(!response.contains("[DONE]"));
    assert!(!response.contains("tool_calls"));
    assert_eq!(mock.records().len(), 1);
}
