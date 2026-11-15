//! 同一core turn的双历史投影；错误保留固定码，由transport做i18n。
use serde_json::{json, Value};
pub fn active(turn: &Value) -> bool {
    matches!(
        turn["status"].as_str(),
        Some("queued" | "running" | "waitingInput")
    )
}
pub fn session(s: &Value) -> Value {
    let mut out = json!({"id":s["sessionId"],"title":s["title"],"channelId":s["profileId"],"pinned":s["pinned"],"archived":s["archived"],"createdAt":s["createdAt"],"updatedAt":s["updatedAt"]});
    if !s["workspaceId"].is_null() {
        out["workspaceId"] = s["workspaceId"].clone();
    }
    out
}
pub fn history(turns: &[Value]) -> Value {
    let mut messages = Vec::new();
    let mut sdk = Vec::new();
    for t in turns {
        messages.push(json!({"id":t["userMessageId"],"role":"user","content":t["userMessage"],"createdAt":t["startedAt"]}));
        sdk.push(json!({"type":"user","uuid":t["userMessageId"],"message":{"content":[{"type":"text","text":t["userMessage"]}]},"parent_tool_use_id":null,"_createdAt":t["startedAt"]}));
        if !t["toolState"].is_null() {
            sdk.extend(super::tool_projection::messages(t));
            if !active(t) {
                messages.push(json!({"id":t["assistantMessageId"],"role":"assistant","content":t["assistantMessage"],"createdAt":t["startedAt"],"model":t["modelId"]}));
            }
            continue;
        }
        if active(t) {
            continue;
        }
        messages.push(json!({"id":t["assistantMessageId"],"role":"assistant","content":t["assistantMessage"],"createdAt":t["startedAt"],"model":t["modelId"]}));
        let mut a = json!({"type":"assistant","uuid":t["assistantMessageId"],"message":{"content":[{"type":"text","text":t["assistantMessage"]}],"model":t["modelId"]},"parent_tool_use_id":null,"_createdAt":t["startedAt"],"_channelModelId":t["modelId"],"_desktopRuntimeStatus":t["status"]});
        if !matches!(t["status"].as_str(), Some("completed" | "cancelled")) {
            a["error"] = json!({"message":"responseFailed","errorType":t["errorCode"].as_str().unwrap_or("INTERRUPTED")});
        }
        sdk.push(a);
        if t["status"] == "cancelled" {
            sdk.push(json!({"type":"system","subtype":"asci_turn_stopped","uuid":format!("{}-stopped",t["requestId"].as_str().unwrap_or_default()),"_createdAt":t["startedAt"]}));
        }
    }
    json!({"messages":messages,"sdkMessages":sdk})
}
pub fn stream(turn: &Value, payload: Value) -> Value {
    json!({"sessionId":turn["sessionId"],"requestId":turn["requestId"],"startedAt":turn["startedAt"],"payload":payload})
}
pub fn snapshot(turn: &Value) -> Value {
    if !turn["toolState"].is_null() {
        return stream(
            turn,
            json!({"kind":"asci_event","event":super::tool_projection::snapshot(turn)}),
        );
    }
    stream(
        turn,
        json!({"kind":"asci_event","event":{"type":"text_snapshot","text":turn["assistantMessage"],"model":turn["modelId"]}}),
    )
}
pub fn active_run(turn: &Value) -> Value {
    json!({"sessionId":turn["sessionId"],"requestId":turn["requestId"],"startedAt":turn["startedAt"],"currentSnapshot":snapshot(turn),"cursor":turn["sequence"]})
}
