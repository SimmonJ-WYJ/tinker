//! 链级所有权与执行级消息分组；正文只从原 run log 投影。
use super::{actor::Actor, projection, tool_projection};
use crate::desktop_runtime::protocol::{DesktopError, Result};
use serde_json::{json, Value};
pub fn pending_message(state: &Value, message: &Value) -> Value {
    json!({"type":"user","uuid":message["uuid"],"message":{"content":[{"type":"text","text":message["userMessage"]}]},"parent_tool_use_id":null,"_createdAt":message["receipt"]["acceptedAt"],"_desktopQueueChainId":state["chainId"],"_desktopQueueUuid":message["uuid"],"_desktopQueueDisposition":message["disposition"]})
}
pub fn execution(state: &Value, turn: &Value) -> Value {
    let mut event = if turn["toolState"].is_null() {
        json!({"type":"tool_run_snapshot","sdkMessages":projection::history(std::slice::from_ref(turn))["sdkMessages"],"activeText":if projection::active(turn) {turn["assistantMessage"].clone()} else {json!("")},"pendingPermissions":[]})
    } else {
        tool_projection::snapshot(turn)
    };
    for message in event["sdkMessages"].as_array_mut().into_iter().flatten() {
        message["_desktopRunId"] = turn["runId"].clone();
        message["_desktopQueueChainId"] = state["chainId"].clone();
        if message["uuid"] == turn["userMessageId"] {
            message["_desktopQueueUuid"] = turn["requestId"].clone();
            message["_desktopQueueDisposition"] = json!("bound");
        }
    }
    json!({"requestId":turn["requestId"],"runId":turn["runId"],"snapshot":event})
}
pub fn snapshot(state: &Value, turns: &[Value], started: u64) -> Result<Value> {
    let ids: Vec<_> = std::iter::once(&state["chainId"])
        .chain(
            state["messages"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|m| m["requestId"].as_str().map(|_| &m["requestId"])),
        )
        .collect();
    let groups: Vec<_> = turns
        .iter()
        .filter(|t| ids.contains(&&t["requestId"]))
        .map(|t| execution(state, t))
        .collect();
    let pending: Vec<_> = state["messages"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|m| m["disposition"] != "bound")
        .map(|m| pending_message(state, m))
        .collect();
    let out = json!({"sessionId":state["sessionId"],"requestId":state["chainId"],"startedAt":started,"payload":{"kind":"asci_event","event":{"type":"native_chain_snapshot","chainId":state["chainId"],"revision":state["revision"],"badgeClearBoundary":state["badgeClearBoundary"],"activeRequestId":state["activeExecution"]["requestId"],"closureReason":state["closureReason"],"executions":groups,"pendingMessages":pending,"receipts":state["messages"]}}});
    if serde_json::to_vec(&out)
        .map_err(|_| DesktopError("invalidReply"))?
        .len()
        > 16 * 1024 * 1024
    {
        return Err(DesktopError("historyLimit"));
    }
    Ok(out)
}
impl Actor {
    pub fn chain_states(&self, sid: &str) -> Result<Vec<Value>> {
        let list = self.core("chat.listChains", json!({"sessionId":sid}))?;
        list["chains"]
            .as_array()
            .ok_or(DesktopError("invalidReply"))?
            .iter()
            .map(|c| {
                self.core(
                    "chat.queueState",
                    json!({"sessionId":sid,"chainId":c["chainId"]}),
                )
            })
            .collect()
    }
    pub fn queue_history(&self, sid: &str, turns: &[Value]) -> Result<Value> {
        let states = self.chain_states(sid)?;
        let mut history = projection::history(turns);
        let mut sdk = Vec::new();
        for turn in turns {
            let state = states.iter().find(|s| {
                s["chainId"] == turn["requestId"]
                    || s["messages"]
                        .as_array()
                        .is_some_and(|ms| ms.iter().any(|m| m["requestId"] == turn["requestId"]))
            });
            if let Some(state) = state {
                sdk.extend(
                    execution(state, turn)["snapshot"]["sdkMessages"]
                        .as_array()
                        .cloned()
                        .unwrap_or_default(),
                );
            } else {
                sdk.extend(
                    projection::history(std::slice::from_ref(turn))["sdkMessages"]
                        .as_array()
                        .cloned()
                        .unwrap_or_default(),
                );
            }
        }
        for state in states {
            for message in state["messages"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|m| m["disposition"] != "bound")
            {
                sdk.push(pending_message(&state, message));
                history["messages"].as_array_mut().ok_or(DesktopError("invalidReply"))?.push(json!({"id":message["userMessageId"],"role":"user","content":message["userMessage"],"createdAt":message["receipt"]["acceptedAt"],"queueDisposition":message["disposition"],"queueUuid":message["uuid"]}));
            }
        }
        history["sdkMessages"] = json!(sdk);
        Ok(history)
    }
    pub fn queue_restore(&self, sid: &str, turns: &[Value], bundle: &mut Value) -> Result<()> {
        let states = self.chain_states(sid)?;
        bundle["chainStates"]=json!(states.iter().map(|s|json!({"sessionId":sid,"chainId":s["chainId"],"closureReason":s["closureReason"]})).collect::<Vec<_>>());
        bundle["activeSnapshot"] = Value::Null;
        for state in states.iter().filter(|s| s["closureReason"].is_null()) {
            let started = turns
                .iter()
                .find(|t| t["requestId"] == state["chainId"])
                .and_then(|t| t["startedAt"].as_u64())
                .ok_or(DesktopError("invalidReply"))?;
            let mut current = snapshot(state, turns, started)?;
            current["payload"]["event"]["badgeClearRevision"] = json!(self
                .queue_entries
                .get(state["chainId"].as_str().unwrap_or_default())
                .map_or(0, |e| e.badge_clear_revision));
            bundle["activeSnapshot"] = json!({"sessionId":sid,"requestId":state["chainId"],"startedAt":started,"cursor":state["activeExecution"]["sequence"],"currentSnapshot":current});
        }
        Ok(())
    }
}
