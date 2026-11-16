//! 仅投影当前 run 的已提交 round；HTTP call ID 保留在核心，SDK 使用 run 作用域。
use serde_json::{json, Value};
fn preview_path(path: &Value) -> &str {
    path.as_str()
        .filter(|p| {
            !p.is_empty()
                && !p.starts_with('/')
                && !p.contains('\\')
                && !p.contains(':')
                && !p.chars().any(char::is_control)
                && p.split('/').all(|part| !matches!(part, "" | "." | ".."))
        })
        .unwrap_or("—")
}
pub fn permission(turn: &Value, ticket: &Value) -> Value {
    json!({"requestId":ticket["permissionId"],"sessionId":turn["sessionId"],"toolName":ticket["call"]["name"],"toolPreview":{"kind":"file","path":preview_path(&ticket["call"]["arguments"]["path"])},"description":"Read synthetic workspace data","descriptionI18n":{"key":"banner.description.syntheticWorkspace"},"dangerLevel":"safe","canAlwaysAllow":false})
}
pub fn messages(turn: &Value) -> Vec<Value> {
    let mut sdk = Vec::new();
    let run = turn["runId"].as_str().unwrap_or_default();
    let mut call_round = None;
    if let Some(messages) = turn["toolState"]["transcript"]["messages"].as_array() {
        for m in messages {
            let (kind, uuid, content) = match m["kind"].as_str() {
                Some("user") => continue,
                Some("assistant") => {
                    let round = m["round"].as_u64().unwrap_or(0);
                    let mut content = Vec::new();
                    if m["text"].as_str().is_some_and(|s| !s.is_empty()) {
                        content.push(json!({"type":"text","text":m["text"]}));
                    }
                    if !m["call"].is_null() {
                        call_round = Some((m["call"]["callId"].clone(), round));
                        content.push(json!({"type":"tool_use","id":format!("{run}-tool-{round}"),"name":m["call"]["name"],"input":{"path":preview_path(&m["call"]["arguments"]["path"])}}));
                    }
                    (
                        "assistant",
                        format!("{run}-assistant-{round}"),
                        json!(content),
                    )
                }
                Some("tool") => {
                    let Some((id, round)) = &call_round else {
                        continue;
                    };
                    if *id != m["result"]["callId"] {
                        continue;
                    }
                    (
                        "user",
                        format!("{run}-result-{round}"),
                        json!([{"type":"tool_result","tool_use_id":format!("{run}-tool-{round}"),"content":m["result"]["content"],"is_error":m["result"]["outcome"]!="succeeded"}]),
                    )
                }
                _ => continue,
            };
            let mut message = json!({"type":kind,"uuid":uuid,"message":{"content":content},"parent_tool_use_id":null,"_createdAt":turn["startedAt"],"_desktopRunId":turn["runId"]});
            if kind == "assistant" {
                message["message"]["model"] = turn["modelId"].clone();
                message["_channelModelId"] = turn["modelId"].clone();
            }
            sdk.push(message);
        }
    }
    // 未 commit 的错误正文也只显示一次，保持稳定身份。
    if !super::projection::active(turn)
        && turn["toolState"]["partialText"]
            .as_str()
            .is_some_and(|s| !s.is_empty())
    {
        sdk.push(json!({"type":"assistant","uuid":format!("{run}-partial"),"message":{"content":[{"type":"text","text":turn["toolState"]["partialText"]}],"model":turn["modelId"]},"parent_tool_use_id":null,"_desktopRunId":run,"_createdAt":turn["startedAt"]}));
    }
    if !super::projection::active(turn) {
        let failed = matches!(turn["status"].as_str(), Some("failed" | "interrupted"));
        if failed && !sdk.iter().any(|m| m["type"] == "assistant") {
            sdk.push(json!({"type":"assistant","uuid":format!("{run}-error"),"message":{"content":[],"model":turn["modelId"]},"parent_tool_use_id":null,"_desktopRunId":run,"_createdAt":turn["startedAt"]}));
        }
        if let Some(last) = sdk.iter_mut().rev().find(|m| m["type"] == "assistant") {
            last["_desktopRuntimeStatus"] = turn["status"].clone();
            if failed {
                last["error"] = json!({"message":"responseFailed","errorType":turn["errorCode"].as_str().unwrap_or("interrupted")});
            }
        }
    }
    if turn["status"] == "cancelled" {
        sdk.push(json!({"type":"system","subtype":"asci_turn_stopped","uuid":format!("{run}-stopped"),"_desktopRunId":run,"_createdAt":turn["startedAt"]}));
    }
    sdk
}
pub fn snapshot(turn: &Value) -> Value {
    let pending = &turn["toolState"]["pending"];
    let mut sdk = vec![super::projection::user_message(turn)];
    sdk.extend(messages(turn));
    json!({"type":"tool_run_snapshot","sdkMessages":sdk,"activeText":if super::projection::active(turn) {turn["toolState"]["partialText"].clone()} else {json!("")},"pendingPermissions":if pending.is_null() {vec![]} else {vec![permission(turn,pending)]}})
}

/// 正常投递复用原 SDK/permission 事件；背压后的权威状态仍由完整 snapshot 恢复。
pub fn event_payload(turn: &Value, record: &Value) -> Option<Value> {
    let event = &record["event"];
    let run = turn["runId"].as_str()?;
    match event["kind"].as_str()? {
        "textDelta" => Some(
            json!({"kind":"asci_event","event":{"type":"text_delta","text":event["text"],"turnId":run}}),
        ),
        "roundFinished" => {
            let uuid = format!("{run}-assistant-{}", event["round"].as_u64()?);
            messages(turn)
                .into_iter()
                .find(|m| m["uuid"] == uuid)
                .map(|m| json!({"kind":"sdk_message","message":m}))
        }
        "toolFinished" => {
            let round = turn["toolState"]["transcript"]["messages"]
                .as_array()?
                .iter()
                .find(|m| {
                    m["kind"] == "assistant" && m["call"]["callId"] == event["result"]["callId"]
                })?["round"]
                .as_u64()?;
            let uuid = format!("{run}-result-{round}");
            messages(turn)
                .into_iter()
                .find(|m| m["uuid"] == uuid)
                .map(|m| json!({"kind":"sdk_message","message":m}))
        }
        "permissionRequested"
            if turn["toolState"]["pending"]["permissionId"] == event["ticket"]["permissionId"] =>
        {
            Some(
                json!({"kind":"asci_event","event":{"type":"permission_request","request":permission(turn,&event["ticket"])}}),
            )
        }
        "permissionResolved" => Some(
            json!({"kind":"asci_event","event":{"type":"permission_resolved","requestId":event["receipt"]["permissionId"],"behavior":if event["receipt"]["decision"]=="granted" {"allow"} else {"deny"}}}),
        ),
        _ => None,
    }
}
