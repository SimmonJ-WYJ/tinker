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
    for key in ["nativeRevisionRoute", "nativeRevisionDocument"] {
        if let Some(value) = s.get(key) {
            out[key] = value.clone();
        }
    }
    if s["importError"] == "corruptImport" {
        out["importError"] = json!("corruptImport");
    }
    if !s["workspaceId"].is_null() {
        out["workspaceId"] = s["workspaceId"].clone();
    }
    out
}
pub(super) fn user_message(turn: &Value) -> Value {
    let mut message = json!({"type":"user","uuid":turn["userMessageId"],"message":{"content":[{"type":"text","text":turn["userMessage"]}]},"parent_tool_use_id":null,"_createdAt":turn["startedAt"]});
    if let Some(source) = turn.get("documentSource").filter(|s| !s.is_null()) {
        message["_desktopDocumentSource"] = source.clone();
    }
    // 工具消息在历史、实时 SDK 与恢复快照中使用相同的显式身份；旧文本投影不变。
    if !turn["toolState"].is_null() {
        message["_desktopRunId"] = turn["runId"].clone();
    }
    message
}
pub fn history(turns: &[Value]) -> Value {
    project_history(turns, false)
}
pub(super) fn text_task_history(turns: &[Value]) -> Value {
    project_history(turns, true)
}
fn project_history(turns: &[Value], text_task_identity: bool) -> Value {
    let mut messages = Vec::new();
    let mut sdk = Vec::new();
    for t in turns {
        if let Some(imported) = t["importedMessages"].as_array() {
            for message in imported {
                let text = message["message"]["content"]
                    .as_array()
                    .map(|blocks| {
                        blocks
                            .iter()
                            .filter(|b| b["type"] == "text")
                            .filter_map(|b| b["text"].as_str())
                            .collect::<Vec<_>>()
                            .join("\n")
                    })
                    .unwrap_or_default();
                messages.push(json!({"id":message["uuid"],"role":message["type"],"content":text,"createdAt":message["_createdAt"]}));
                sdk.push(message.clone());
            }
            continue;
        }
        let mut plain_user = json!({"id":t["userMessageId"],"role":"user","content":t["userMessage"],"createdAt":t["startedAt"]});
        if let Some(source) = t.get("documentSource").filter(|s| !s.is_null()) {
            plain_user["_desktopDocumentSource"] = source.clone();
        }
        messages.push(plain_user);
        let mut user = user_message(t);
        if text_task_identity && t["toolState"].is_null() {
            user["_desktopTextTaskRequestId"] = t["requestId"].clone();
        }
        sdk.push(user);
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
        if text_task_identity {
            if super::fork::revision_candidate(t) {
                a["_desktopCanRevise"] = json!(true);
            }
            a["_desktopTextTaskRequestId"] = t["requestId"].clone();
        }
        if !matches!(t["status"].as_str(), Some("completed" | "cancelled")) {
            a["error"] = json!({"message":turn_error(t),"errorType":t["errorCode"].as_str().unwrap_or("INTERRUPTED")});
        }
        sdk.push(a);
        if t["status"] == "cancelled" {
            sdk.push(json!({"type":"system","subtype":"asci_turn_stopped","uuid":format!("{}-stopped",t["requestId"].as_str().unwrap_or_default()),"_createdAt":t["startedAt"]}));
        }
    }
    json!({"messages":messages,"sdkMessages":sdk})
}
/// 未知、旧版和中断错误保留原提示；仅精确的已知诊断可穿过 IPC。
pub(super) fn turn_error(turn: &Value) -> &'static str {
    match turn["errorCode"].as_str() {
        Some("channelUnauthorized") => "channelUnauthorized",
        Some("channelPaymentRequired") => "channelPaymentRequired",
        Some("channelForbidden") => "channelForbidden",
        Some("channelRateLimited") => "channelRateLimited",
        Some("httpTimeout") => "channelTimeout",
        _ => "responseFailed",
    }
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

#[cfg(test)]
mod imported_tests {
    use super::*;
    #[test]
    fn imported_single_role_is_projected_once_and_preserves_attachments() {
        let m = json!({"uuid":"m2","type":"assistant","_createdAt":4,"message":{"content":[{"type":"text","text":"one"},{"type":"text","text":"two"}]},"_importedFiles":[{"id":"a1"}]});
        let h = history(&[json!({"importedMessages":[m]})]);
        assert_eq!(h["sdkMessages"], json!([m]));
        assert_eq!(
            h["messages"],
            json!([{"id":"m2","role":"assistant","content":"one\ntwo","createdAt":4}])
        );
    }
}
