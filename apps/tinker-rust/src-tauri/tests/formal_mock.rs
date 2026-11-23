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

#[test]
fn images_use_separate_operations_and_only_log_their_outcomes() {
    let mock = OwnedMock::start().unwrap();
    let call = |route: &str, payload: &serde_json::Value| {
        let mut s = TcpStream::connect(mock.image_addr()).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
        let body = payload.to_string();
        write!(s,"POST /v1/images/{route} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",body.len()).unwrap();
        let mut response = String::new();
        s.read_to_string(&mut response).unwrap();
        response
    };
    let mut body = json!({"model":"local-image","n":1,"response_format":"b64_json","prompt":"private-fixture"});
    let created = call("generations", &body);
    assert!(
        created.starts_with("HTTP/1.1 200"),
        "expected a generation response"
    );
    let bytes = |response: &str| {
        let (_, body) = response.split_once("\r\n\r\n").unwrap();
        serde_json::from_str::<serde_json::Value>(body).unwrap()["data"][0]["b64_json"]
            .as_str()
            .unwrap()
            .to_owned()
    };
    let source = bytes(&created);
    assert!(source.starts_with("iVBOR"));
    body["referenceImage"] = json!({"id":"img-111","b64_json":source});
    let edited = call("edits", &body);
    assert!(edited.starts_with("HTTP/1.1 200"));
    assert_ne!(bytes(&edited), source);
    body["prompt"] = json!("simulate [image-error]");
    assert!(call("edits", &body).starts_with("HTTP/1.1 500"));
    let meta = serde_json::to_string(&mock.records()).unwrap();
    assert_eq!(
        mock.records()
            .iter()
            .map(|r| r.scenario.as_str())
            .collect::<Vec<_>>(),
        ["image-generate", "image-edit", "image-edit-failed"]
    );
    assert!(!meta.contains("private-fixture") && !meta.contains(&source));

    // 两个源图发送同一编辑指令，必须得到不同的图像。
    body["prompt"] = json!("private-fixture");
    let first_source_edit = bytes(&call("edits", &body));
    let second_generation =
        json!({"model":"local-image","prompt":"second palette","n":1,"response_format":"b64_json"});
    body["referenceImage"]["b64_json"] = json!(bytes(&call("generations", &second_generation)));
    assert_ne!(bytes(&call("edits", &body)), first_source_edit);
    body["prompt"] = json!("retryable edit [image-task-retry]");
    assert!(call("edits", &body).starts_with("HTTP/1.1 500"));
    assert!(call("edits", &body).starts_with("HTTP/1.1 200"));
    let records = mock.records();
    let pair = &records[records.len() - 2..];
    assert_eq!(pair[0].scenario, "image-edit-retry-failed");
    assert_eq!(pair[1].scenario, "image-edit-retry-completed");
    body["referenceImage"]["b64_json"] = json!("invalid PNG");
    assert!(call("edits", &body).starts_with("HTTP/1.1 400"));
}

#[test]
fn project_task_retry_disconnects_once_then_finishes_the_same_explicit_prompt() {
    let mock = OwnedMock::start().unwrap();
    let request = json!({"model":"local-mock-a","messages":[{"role":"user","content":"[task-retry] synthetic prompt"}],"stream":true}).to_string();
    let first = post(&mock, &request);
    assert!(first.contains("Local Mock A") && !first.contains("[DONE]"));
    assert!(post(&mock, &request).contains("[DONE]"));
    assert_eq!(
        mock.records()
            .iter()
            .map(|r| r.scenario.as_str())
            .collect::<Vec<_>>(),
        ["task-retry-failed", "task-retry-completed"]
    );
}
