//! 独立合成协议：只有收到关联的真实工具结果才输出下一轮。
use super::*;
pub(super) fn profiles(endpoint: &str) -> Result<Vec<TrustedProfile>> {
    let mut profiles = local_mock_profiles(endpoint)?;
    let p = &mut profiles[0];
    p.profile_id = "local-tools-mock".into();
    p.config_revision = "local-tools-protocol-v1".into();
    p.label = "Local Synthetic Mock Tools".into();
    p.models.truncate(1);
    p.models[0].model_id = "local-tools-mock".into();
    p.models[0].label = "Local Synthetic Mock Tools".into();
    Ok(profiles)
}
pub(super) fn respond(
    stream: &mut TcpStream,
    body: &Value,
    records: &Mutex<Vec<RequestMetadata>>,
) -> std::io::Result<()> {
    let invalid = || {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "synthetic protocol mismatch",
        )
    };
    if body["model"] != "local-tools-mock"
        || body["parallel_tool_calls"] != false
        || body["tools"].as_array().map(Vec::len) != Some(2)
    {
        return Err(invalid());
    }
    let messages = body["messages"].as_array().ok_or_else(invalid)?;
    let users = messages.iter().filter(|m| m["role"] == "user").count();
    let assistants = messages.iter().filter(|m| m["role"] == "assistant").count();
    // 验证所有已有 call/result 邻接，包含后续请求的完整祖先历史。
    for (i, m) in messages.iter().enumerate() {
        if let Some(calls) = m["tool_calls"].as_array() {
            if calls.len() != 1
                || messages
                    .get(i + 1)
                    .is_none_or(|r| r["role"] != "tool" || r["tool_call_id"] != calls[0]["id"])
            {
                return Err(invalid());
            }
        }
        if m["role"] == "tool"
            && (i == 0 || messages[i - 1]["tool_calls"][0]["id"] != m["tool_call_id"])
        {
            return Err(invalid());
        }
    }
    let start = messages
        .iter()
        .rposition(|m| m["role"] == "user")
        .ok_or_else(invalid)?;
    let results: Vec<_> = messages[start..]
        .iter()
        .filter(|m| m["role"] == "tool")
        .collect();
    let denied = results.iter().any(|m| {
        m["content"]
            .as_str()
            .is_some_and(|s| s.contains("denied") || s.contains("expired"))
    });
    let delta;
    let finish;
    if denied {
        delta = json!({"content":"Local Synthetic Mock: permission was not granted."});
        finish = "stop";
    } else if results.is_empty() {
        delta = json!({"content":"Local Synthetic Mock: checking notes. ","tool_calls":[{"index":0,"id":format!("list_{users}"),"type":"function","function":{"name":"workspace_list","arguments":"{\"path\":\"notes\"}"}}]});
        finish = "tool_calls";
    } else if results.len() == 1 {
        if results[0]["content"] != "notes/intro.txt\nnotes/steps.txt" {
            return Err(invalid());
        }
        delta = json!({"content":"Reading intro. ","tool_calls":[{"index":0,"id":format!("read_{users}"),"type":"function","function":{"name":"workspace_read","arguments":"{\"path\":\"notes/intro.txt\"}"}}]});
        finish = "tool_calls";
    } else {
        if results.len() != 2
            || results[1]["content"]
                != "This is a synthetic workspace. Unicode fixture: café — 你好.\n"
        {
            return Err(invalid());
        }
        delta = json!({"content":"Local Synthetic Mock verified: café — 你好."});
        finish = "stop";
    }
    if let Ok(mut log) = records.lock() {
        if log.len() < MAX_REQUESTS {
            log.push(RequestMetadata {
                model: "local-tools-mock".into(),
                effort: body["reasoning_effort"].as_str().map(str::to_owned),
                user_messages: users,
                assistant_messages: assistants,
                scenario: "synthetic-tools".into(),
            });
        }
    }
    stream.write_all(
        b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n",
    )?;
    // 仅 owned mock 的传输故障场景：真实 SSE delta 后断流，无 finish/[DONE]。
    if results.is_empty()
        && messages[start]["content"]
            .as_str()
            .is_some_and(|s| s.starts_with("[partial-error]"))
    {
        write!(
            stream,
            "data: {}\n\n",
            json!({"choices":[{"index":0,"delta":{"content":"Synthetic partial output before transport failure."},"finish_reason":null}]})
        )?;
        return stream.flush();
    }
    if results.is_empty()
        && messages[start]["content"]
            .as_str()
            .is_some_and(|s| s.starts_with("[backlog]"))
    {
        for _ in 0..300 {
            write!(
                stream,
                "data: {}\n\n",
                json!({"choices":[{"index":0,"delta":{"content":"·"},"finish_reason":null}]})
            )?;
            stream.flush()?;
            thread::sleep(Duration::from_millis(15));
        }
    }
    write!(
        stream,
        "data: {}\n\ndata: {}\n\ndata: [DONE]\n\n",
        json!({"choices":[{"index":0,"delta":delta,"finish_reason":null}]}),
        json!({"choices":[{"index":0,"delta":{},"finish_reason":finish}]})
    )?;
    stream.flush()
}
