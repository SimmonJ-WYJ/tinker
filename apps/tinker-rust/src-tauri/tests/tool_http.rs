#[path = "support/http.rs"]
mod http_support;
use std::{io::Write, net::TcpListener, sync::atomic::AtomicBool, thread, time::Duration};
use tinker_rust_foundation::{
    chat_http::{ChatHttpConfig, ChatHttpProvider},
    run_provider::RunProvider,
    tool_types::*,
};
#[test]
fn complete_call_round_is_returned_with_exact_arguments() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/chat", listener.local_addr().unwrap());
    let server = thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        http_support::read_request(&mut socket);
        let body="data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call1\",\"type\":\"function\",\"function\":{\"name\":\"workspace_list\",\"arguments\":\"{\\\"path\\\":\\\"notes\\\"}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\ndata: [DONE]\n\n";
        write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
    });
    let provider = ChatHttpProvider::new(
        ChatHttpConfig::new(url, "fake-key".into(), "synthetic-model".into()).unwrap(),
    );
    let result = provider.execute_tool_round(
        &ToolContext {
            messages: vec![TranscriptMessage::User {
                text: "list".into(),
            }],
        },
        &[
            ToolSpec {
                name: ToolName::WorkspaceList,
                description: "List synthetic files".into(),
            },
            ToolSpec {
                name: ToolName::WorkspaceRead,
                description: "Read synthetic files".into(),
            },
        ],
        &AtomicBool::new(false),
        Duration::from_secs(2),
        &mut |_| Ok(()),
    );
    assert_eq!(
        result,
        Ok(ToolRoundOutput::ToolCall(ProviderToolCall {
            id: "call1".into(),
            name: "workspace_list".into(),
            arguments: "{\"path\":\"notes\"}".into()
        }))
    );
    server.join().unwrap();
}
#[test]
fn real_file_result_returns_to_owned_http_after_permission() {
    use std::sync::{atomic::Ordering, Arc};
    use tinker_rust_foundation::{
        formal_platform::TrustedRoot, run_controller::RunController, session_lifecycle::RunStatus,
        synthetic_workspace::SyntheticWorkspace,
    };
    let root_path = std::fs::canonicalize(std::env::temp_dir())
        .unwrap()
        .join(format!(
            "tinker-tauri-formal-preview-http-{}",
            std::process::id()
        ));
    let root = TrustedRoot::create_temporary(&root_path).unwrap();
    let workspace = Arc::new(SyntheticWorkspace::create(&root).unwrap());
    let controller = RunController::open_with_tools(root.path()).unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/chat", listener.local_addr().unwrap());
    let requests = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let seen = requests.clone();
    let server = thread::spawn(move || {
        for round in 0..3 {
            let (mut socket, _) = listener.accept().unwrap();
            let request = http_support::read_request(&mut socket);
            let offset = request.windows(4).position(|w| w == b"\r\n\r\n").unwrap() + 4;
            let body: serde_json::Value = serde_json::from_slice(&request[offset..]).unwrap();
            assert_eq!(body["parallel_tool_calls"], false);
            if round > 0 {
                assert_eq!(body["messages"][round * 2]["role"], "tool");
                assert_eq!(
                    body["messages"][round * 2]["tool_call_id"],
                    format!("c{round}")
                );
            }
            if round == 2 {
                assert_eq!(
                    body["messages"][4]["content"],
                    "This is a synthetic workspace. Unicode fixture: café — 你好.\n"
                );
            }
            seen.fetch_add(1, Ordering::SeqCst);
            let delta = if round < 2 {
                serde_json::json!({"tool_calls":[{"index":0,"id":format!("c{}",round+1),"type":"function","function":{"name":if round==0{"workspace_list"}else{"workspace_read"},"arguments":if round==0{"{\"path\":\"notes\"}"}else{"{\"path\":\"notes/intro.txt\"}"}}}]})
            } else {
                serde_json::json!({"content":"verified-final-marker"})
            };
            let frame = serde_json::json!({"choices":[{"index":0,"delta":delta,"finish_reason":if round<2{"tool_calls"}else{"stop"}}]});
            let response = format!("data: {frame}\n\ndata: [DONE]\n\n");
            write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",response.len(),response).unwrap();
        }
    });
    let options = ToolRunOptions::new(
        workspace.workspace_revision().into(),
        Duration::from_secs(2),
        Duration::from_secs(5),
    )
    .unwrap();
    controller
        .start_tools(
            "http1".into(),
            None,
            "Read synthetic notes".into(),
            std::sync::Arc::new(ChatHttpProvider::new(
                ChatHttpConfig::new(url, "fake-tool-secret".into(), "synthetic-model".into())
                    .unwrap(),
            )),
            workspace,
            options,
        )
        .unwrap();
    let start = std::time::Instant::now();
    let mut grants = 0;
    loop {
        let snapshot = controller.read_tools("http1", 0, 256).unwrap().snapshot;
        if let Some(ticket) = snapshot.pending {
            assert_eq!(requests.load(Ordering::SeqCst), grants + 1);
            controller
                .respond_permission(
                    "http1",
                    PermissionReply {
                        permission_id: ticket.permission_id,
                        decision: PermissionDecision::Granted,
                    },
                )
                .unwrap();
            grants += 1;
        }
        if snapshot.status == RunStatus::Completed {
            assert_eq!(snapshot.output, "verified-final-marker");
            break;
        }
        assert!(
            start.elapsed() < Duration::from_secs(5),
            "status {:?}",
            snapshot.status
        );
        thread::sleep(Duration::from_millis(2));
    }
    assert_eq!(grants, 2);
    server.join().unwrap();
}
#[test]
fn preflight_rejects_known_key_before_any_header_or_network() {
    use tinker_rust_foundation::{
        formal_platform::TrustedRoot, run_controller::RunController,
        synthetic_workspace::SyntheticWorkspace,
    };
    let path = std::fs::canonicalize(std::env::temp_dir())
        .unwrap()
        .join(format!(
            "tinker-tauri-formal-preview-secret-{}",
            std::process::id()
        ));
    let root = TrustedRoot::create_temporary(path).unwrap();
    let workspace = std::sync::Arc::new(SyntheticWorkspace::create(&root).unwrap());
    let c = RunController::open_with_tools(root.path()).unwrap();
    let provider = std::sync::Arc::new(ChatHttpProvider::new(
        ChatHttpConfig::new(
            "http://127.0.0.1:1/chat".into(),
            "known-fake-key".into(),
            "synthetic".into(),
        )
        .unwrap(),
    ));
    let options = ToolRunOptions::new(
        workspace.workspace_revision().into(),
        Duration::from_secs(1),
        Duration::from_secs(2),
    )
    .unwrap();
    assert!(c
        .start_tools(
            "secret".into(),
            None,
            "contains known-fake-key".into(),
            provider,
            workspace,
            options
        )
        .is_err());
    assert!(!root.path().join("runs-v1/tools-v3").exists());
}
#[test]
fn escaped_and_fragmented_argument_secrets_never_return_a_call() {
    for arguments in [
        vec!["{\"path\":\"known-", "fake-key\"}"],
        vec!["{\"path\":\"known-fake-\\u006bey\"}"],
    ] {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/chat", listener.local_addr().unwrap());
        let mut body = String::new();
        for (index, args) in arguments.iter().enumerate() {
            let delta = if index == 0 {
                serde_json::json!({"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"workspace_read","arguments":args}}]})
            } else {
                serde_json::json!({"tool_calls":[{"index":0,"function":{"arguments":args}}]})
            };
            let frame = serde_json::json!({"choices":[{"index":0,"delta":delta,"finish_reason":if index+1==arguments.len(){Some("tool_calls")}else{None}}]});
            body.push_str(&format!("data: {frame}\n\n"));
        }
        body.push_str("data: [DONE]\n\n");
        let server = thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            http_support::read_request(&mut socket);
            write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
        });
        let provider = ChatHttpProvider::new(
            ChatHttpConfig::new(url, "known-fake-key".into(), "synthetic".into()).unwrap(),
        );
        let tools = vec![
            ToolSpec {
                name: ToolName::WorkspaceList,
                description: "List".into(),
            },
            ToolSpec {
                name: ToolName::WorkspaceRead,
                description: "Read".into(),
            },
        ];
        assert!(provider
            .execute_tool_round(
                &ToolContext {
                    messages: vec![TranscriptMessage::User {
                        text: "read".into()
                    }]
                },
                &tools,
                &AtomicBool::new(false),
                Duration::from_secs(2),
                &mut |_| Ok(())
            )
            .is_err());
        server.join().unwrap();
    }
}
