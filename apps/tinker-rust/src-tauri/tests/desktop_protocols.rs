#[allow(dead_code)]
#[path = "support/desktop.rs"]
mod service;
// 两种协议通过真实DesktopRuntime进程发送，仅使用合成回环服务。
use serde_json::{json, Value};
use std::{fs, io::Write, net::TcpListener};
#[allow(dead_code)]
#[path = "support/desktop_process.rs"]
mod support;
use support::*;
#[path = "support/http.rs"]
mod http_support;
#[allow(dead_code)]
#[path = "support/protocol_http.rs"]
mod protocol_http;
use protocol_http::*;
#[test]
fn legacy_metadata_defaults_to_openai_and_unknown_protocol_rejects() {
    use tinker_rust_foundation::desktop_runtime::{DesktopRuntime, TrustedProfile};
    let f = service::Fixture::new();
    let r = DesktopRuntime::open(&f.0, service::profiles()).unwrap();
    assert_eq!(
        service::call(&r, "runtime.describe", json!({}))["result"]["efforts"],
        json!([])
    );
    let catalog = service::call(&r, "profiles.list", json!({}));
    assert_eq!(catalog["result"]["profiles"][0]["protocol"], "openai-chat");
    assert_eq!(
        catalog["result"]["profiles"][0]["models"][0]["supportedEfforts"],
        json!([])
    );
    assert!(!catalog.to_string().contains("fake-secret"));
    let bad = json!({"profileId":"local","label":"Synthetic","configRevision":"r1","models":[{"modelId":"model","label":"Model"}],"endpoint":"http://127.0.0.1:1/chat","key":"fake-secret","protocol":"future"});
    assert!(serde_json::from_value::<TrustedProfile>(bad).is_err());
}
#[test]
fn both_protocols_send_effort_and_original_role_chain_through_process() {
    for (protocol, model, path) in [
        (
            "openai-chat",
            "vendor/openai.v1:alias",
            "/v1/chat/completions",
        ),
        (
            "anthropic-messages",
            "vendor/claude.v1:alias",
            "/v1/messages",
        ),
    ] {
        let f = Fixture::new();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        fs::write(&f.config,json!([{"profileId":"local","label":"Synthetic","configRevision":"r1","models":[{"modelId":model,"label":"自定义模型","supportedEfforts":if protocol=="anthropic-messages" {json!(["low","medium","high","max"])}else{json!(["low","medium","high"])} }],"endpoint":format!("http://{}{path}",listener.local_addr().unwrap()),"key":"fake-secret","protocol":protocol}]).to_string()).unwrap();
        let server = std::thread::spawn(move || {
            let mut bodies = Vec::new();
            for _ in 0..if protocol == "anthropic-messages" {
                4
            } else {
                3
            } {
                let (mut socket, _) = listener.accept().unwrap();
                let bytes = http_support::read_request(&mut socket);
                let at = bytes.windows(4).position(|b| b == b"\r\n\r\n").unwrap() + 4;
                let headers = std::str::from_utf8(&bytes[..at])
                    .unwrap()
                    .to_ascii_lowercase();
                assert!(headers.starts_with(&format!("post {path} http/1.1")));
                if protocol == "anthropic-messages" {
                    assert!(headers.contains("x-api-key: fake-secret"));
                    assert!(headers.contains("anthropic-version: 2023-06-01"));
                    assert!(!headers.contains("authorization:"));
                } else {
                    assert!(headers.contains("authorization: bearer fake-secret"));
                }
                bodies.push(serde_json::from_slice::<Value>(&bytes[at..]).unwrap());
                let answer = if protocol == "anthropic-messages" {
                    anthropic("你好")
                } else {
                    "data: {\"choices\":[{\"delta\":{\"content\":\"你好\"}}]}\n\ndata: [DONE]\n\n"
                        .into()
                };
                let response=format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{answer}",answer.len());
                for byte in response.bytes() {
                    if socket.write_all(&[byte]).is_err() {
                        break;
                    }
                }
            }
            (listener, bodies)
        });
        let (mut child, mut input, mut output) = connect(&f);
        let profiles = rpc(
            &mut input,
            &mut output,
            "profiles",
            "profiles.list",
            json!({}),
        );
        assert_eq!(profiles["result"]["profiles"][0]["protocol"], protocol);
        let efforts = if protocol == "anthropic-messages" {
            json!(["low", "medium", "high", "max"])
        } else {
            json!(["low", "medium", "high"])
        };
        assert_eq!(
            profiles["result"]["profiles"][0]["models"][0]["supportedEfforts"],
            efforts
        );
        let sid = rpc(
            &mut input,
            &mut output,
            "create",
            "sessions.create",
            json!({"title":"合成","profileId":"local","workspaceId":null,"reuseDraft":false}),
        )["result"]["sessionId"]
            .as_str()
            .unwrap()
            .to_string();
        let levels: &[&str] = if protocol == "anthropic-messages" {
            &["low", "medium", "high", "max"]
        } else {
            &["low", "medium", "high"]
        };
        if protocol == "openai-chat" {
            let mut params = send(&sid, "rejected-max", "must not send");
            params["modelId"] = json!(model);
            params["effort"] = json!("max");
            assert_eq!(
                rpc(&mut input, &mut output, "max", "chat.send", params)["error"]["code"],
                "unsupportedEffort"
            );
        }
        for field in ["tools", "thinking", "attachments", "coding"] {
            let mut params = send(&sid, "unsupported", "must not send");
            params["modelId"] = json!(model);
            params[field] = json!(true);
            assert_eq!(
                rpc(&mut input, &mut output, "unsupported", "chat.send", params)["error"]["code"],
                "invalidParams"
            );
        }
        for (n, effort) in levels.iter().enumerate() {
            let request = format!("r{n}");
            let mut params = send(&sid, &request, &format!("原始输入{n}"));
            params["modelId"] = json!(model);
            params["effort"] = json!(effort);
            let start = rpc(&mut input, &mut output, "send", "chat.send", params.clone());
            assert!(start.get("result").is_some(), "{start}");
            let page = terminal(&mut input, &mut output, &sid, &request);
            assert_eq!(page["turn"]["status"], "completed", "{page}");
            assert_eq!(page["turn"]["assistantMessage"], "你好");
            assert_eq!(page["turn"]["effort"], *effort);
            assert!(rpc(&mut input, &mut output, "replay", "chat.send", params)
                .get("result")
                .is_some());
        }
        drop(input);
        assert!(child.wait().unwrap().success());
        let (listener, bodies) = server.join().unwrap();
        listener.set_nonblocking(true).unwrap();
        assert!(listener.accept().is_err());
        for (n, body) in bodies.iter().enumerate() {
            assert_eq!(body["model"], model);
            assert_eq!(body["stream"], true);
            let messages = body["messages"].as_array().unwrap();
            assert_eq!(messages.len(), n * 2 + 1);
            for (i, message) in messages.iter().enumerate() {
                assert_eq!(
                    message["role"],
                    if i % 2 == 0 { "user" } else { "assistant" }
                );
                assert_eq!(
                    message["content"],
                    if i % 2 == 0 {
                        format!("原始输入{}", i / 2)
                    } else {
                        "你好".into()
                    }
                );
            }
            assert!(body.get("system").is_none());
            let effort = levels[n];
            if protocol == "anthropic-messages" {
                assert_eq!(body["output_config"]["effort"], effort);
                assert_eq!(body["max_tokens"], 4096);
                assert!(body.get("reasoning_effort").is_none());
            } else {
                assert_eq!(body["reasoning_effort"], effort);
                assert!(body.get("output_config").is_none());
            }
        }
    }
}
#[test]
fn trusted_capabilities_are_explicit_strict_and_protocol_bounded() {
    use tinker_rust_foundation::desktop_runtime::{DesktopRuntime, TrustedProfile};
    for (protocol, efforts, valid) in [
        ("openai-chat", json!(["high"]), true),
        ("anthropic-messages", json!(["max", "high"]), true),
        ("openai-chat", json!(["max"]), false),
        ("anthropic-messages", json!(["xhigh"]), false),
        ("anthropic-messages", json!(["high", "high"]), false),
        ("anthropic-messages", json!(["future"]), false),
    ] {
        let f = service::Fixture::new();
        let value = json!([{"profileId":"local","label":"Synthetic","configRevision":"r1","protocol":protocol,"models":[{"modelId":"vendor/alias.v1:tag","label":"自定义","supportedEfforts":efforts}],"endpoint":"http://127.0.0.1:1/chat","key":"fake-secret"}]);
        let p: Vec<TrustedProfile> = serde_json::from_value(value).unwrap();
        let result = DesktopRuntime::open(&f.0, p);
        assert_eq!(result.is_ok(), valid);
        if let Ok(r) = result {
            let profiles = service::call(&r, "profiles.list", json!({}));
            assert_eq!(
                profiles["result"]["profiles"][0]["models"][0]["supportedEfforts"],
                efforts
            );
            let s = service::create(&r, false)["result"]["sessionId"]
                .as_str()
                .unwrap()
                .to_string();
            let mut send = service::send_params(&s);
            send["modelId"] = json!("vendor/alias.v1:tag");
            send["effort"] = json!("low");
            assert_eq!(
                service::call(&r, "chat.send", send)["error"]["code"],
                "unsupportedEffort"
            );
            assert_eq!(
                service::call(
                    &r,
                    "sessions.history",
                    json!({"sessionId":s,"after":0,"limit":128})
                )["result"]["turns"],
                json!([])
            );
        }
    }
}
