//! Only the host can supply fork contents. Match the visible prefix against durable text turns.
use super::{actor::Actor, projection};
use crate::desktop_runtime::{
    protocol::{DesktopError, Result},
    Turn,
};
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ForkReply {
    session_id: String,
    up_to_message_uuid: String,
}

impl Actor {
    pub(super) fn fork_reply(&self, input: ForkReply) -> Result<Value> {
        let sid = &input.session_id;
        let turns = self.turns(sid)?;
        let history = self.history_from_turns(sid, &turns)?;
        let messages = history["sdkMessages"]
            .as_array()
            .ok_or(DesktopError("invalidReply"))?;
        let prefix = completed_prefix(&turns, messages, &input.up_to_message_uuid)?;
        Ok(projection::session(
            &self.runtime.fork_completed_turns(sid, prefix)?,
        ))
    }
}

fn completed_prefix(turns: &[Value], messages: &[Value], anchor: &str) -> Result<Vec<Turn>> {
    let end = messages
        .iter()
        .position(|m| m["type"] == "assistant" && m["uuid"] == anchor)
        .ok_or(DesktopError("forkAnchorMissing"))?;
    let mut copied = Vec::new();
    for (index, pair) in messages[..=end].chunks(2).enumerate() {
        let turn = turns.get(index).ok_or(DesktopError("forkUnsupported"))?;
        if pair.len() != 2
            || pair[0]["type"] != "user"
            || pair[1]["type"] != "assistant"
            || pair[0]["uuid"] != turn["userMessageId"]
            || pair[1]["uuid"] != turn["assistantMessageId"]
            || turn["status"] != "completed"
            || !turn["toolState"].is_null()
            || !turn["importedMessages"].is_null()
            || pair.iter().any(|m| {
                !m["_desktopImageTaskRequestId"].is_null() || !m["_desktopQueueChainId"].is_null()
            })
        {
            return Err(DesktopError("forkUnsupported"));
        }
        let mut text = turn.clone();
        text.as_object_mut()
            .ok_or(DesktopError("invalidReply"))?
            .remove("toolState");
        copied.push(serde_json::from_value(text).map_err(|_| DesktopError("invalidReply"))?);
    }
    Ok(copied)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn turn(id: &str) -> Value {
        json!({"sessionId":"session-1","requestId":id,"runId":id,
               "userMessageId":format!("{id}-user"),"assistantMessageId":format!("{id}-assistant"),
               "profileId":"a","modelId":"model-a","configRevision":"1","startedAt":1,
               "userMessage":"hi","assistantMessage":"hello","status":"completed","sequence":2,
               "errorCode":null,"toolState":null})
    }

    #[test]
    fn fork_stops_at_selected_reply_before_later_unsupported_content() {
        let turns = [turn("one"), turn("two")];
        let history = projection::history(&turns);
        let mut sdk = history["sdkMessages"].as_array().unwrap().clone();
        sdk[2]["_desktopImageTaskRequestId"] = json!("image");
        assert_eq!(
            completed_prefix(&turns, &sdk, "one-assistant")
                .unwrap()
                .len(),
            1
        );
        assert!(matches!(
            completed_prefix(&turns, &sdk, "two-assistant"),
            Err(DesktopError("forkUnsupported"))
        ));
        assert!(matches!(
            completed_prefix(&turns, &sdk, "unknown"),
            Err(DesktopError("forkAnchorMissing"))
        ));
    }

    #[test]
    fn fork_refuses_unrepresentable_prefix_before_publishing_anything() {
        let plain = turn("one");
        let sdk = projection::history(std::slice::from_ref(&plain))["sdkMessages"]
            .as_array()
            .unwrap()
            .clone();
        for (field, value) in [
            ("status", json!("cancelled")),
            ("toolState", json!({})),
            ("importedMessages", json!([])),
        ] {
            let mut other = plain.clone();
            other[field] = value;
            assert!(completed_prefix(&[other], &sdk, "one-assistant").is_err());
        }
        let mut mixed = sdk.clone();
        mixed.insert(0, json!({"type":"system","uuid":"tool"}));
        assert!(completed_prefix(&[plain], &mixed, "one-assistant").is_err());
    }
}
