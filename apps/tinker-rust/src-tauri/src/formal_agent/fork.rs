//! 由宿主按所选回复核对可见历史、已完成文字轮次及托管图片记录。
use super::{actor::Actor, projection};
use crate::desktop_runtime::{
    protocol::{DesktopError, Result},
    Turn,
};
use serde::Deserialize;
use serde_json::Value;
use std::collections::BTreeSet;

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
        let session = self.session(sid)?;
        for loc in prefix
            .text
            .iter()
            .filter_map(|t| t.document_source.as_ref())
        {
            let workspace = session["workspaceId"]
                .as_str()
                .ok_or(DesktopError("forkUnsupported"))?;
            if !loc.matches_project(&self.root, workspace)? {
                return Err(DesktopError("forkUnsupported"));
            }
        }
        let child = self.runtime.fork_completed_turns(
            sid,
            &input.up_to_message_uuid,
            prefix.text,
            |target| match &self.images {
                Some(images) => images.store.fork_assets(sid, target, &prefix.images),
                None if prefix.images.is_empty() => Ok(()),
                None => Err(DesktopError("forkUnsupported")),
            },
        )?;
        Ok(projection::session(&child))
    }
}

struct ForkPrefix {
    text: Vec<Turn>,
    images: BTreeSet<String>,
}

fn completed_prefix(turns: &[Value], messages: &[Value], anchor: &str) -> Result<ForkPrefix> {
    let end = messages
        .iter()
        .position(|m| m["type"] == "assistant" && m["uuid"] == anchor)
        .ok_or(DesktopError("forkAnchorMissing"))?;
    let mut prefix = ForkPrefix {
        text: vec![],
        images: BTreeSet::new(),
    };
    let mut i = 0;
    while i <= end {
        let user = &messages[i];
        let reply = messages.get(i + 1).ok_or(DesktopError("forkUnsupported"))?;
        if user["type"] != "user" || reply["type"] != "assistant" || i + 1 > end {
            return Err(DesktopError("forkUnsupported"));
        }
        if let Some(id) = user["_desktopImageTaskRequestId"].as_str() {
            // SDK 投影中的图片回复和随后的 tool_result 是同一个已完成的资产。
            let result = messages.get(i + 2).ok_or(DesktopError("forkUnsupported"))?;
            let tool = &reply["message"]["content"][0];
            let output = &result["message"]["content"][0];
            if reply["_desktopImageTaskRequestId"] != id
                || reply["_desktopImageTaskStatus"] != "completed"
                || result["_agentRequestId"] != id
                || result["type"] != "user"
                || tool["name"] != "mcp__asci-image__generate_image"
                || tool["type"] != "tool_use"
                || output["type"] != "tool_result"
                || output["tool_use_id"] != tool["id"]
                || output["is_error"] != false
                || !prefix.images.insert(id.to_owned())
            {
                return Err(DesktopError("forkUnsupported"));
            }
            i += 3;
            continue;
        }
        let turn = turns
            .get(prefix.text.len())
            .ok_or(DesktopError("forkUnsupported"))?;
        if user["uuid"] != turn["userMessageId"]
            || reply["uuid"] != turn["assistantMessageId"]
            || turn["status"] != "completed"
            || !turn["toolState"].is_null()
            || !turn["importedMessages"].is_null()
            || !reply["_desktopImageTaskRequestId"].is_null()
            || [user, reply]
                .iter()
                .any(|m| !m["_desktopQueueChainId"].is_null())
        {
            return Err(DesktopError("forkUnsupported"));
        }
        let mut text = turn.clone();
        text.as_object_mut()
            .ok_or(DesktopError("invalidReply"))?
            .remove("toolState");
        prefix
            .text
            .push(serde_json::from_value(text).map_err(|_| DesktopError("invalidReply"))?);
        i += 2;
    }
    Ok(prefix)
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
                .text
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
    fn image_reply_cutoff_includes_its_result_but_never_the_next_turn_or_tool() {
        let image = [
            json!({"type":"user","uuid":"image-input","_desktopImageTaskRequestId":"r"}),
            json!({"type":"assistant","uuid":"image-reply","_desktopImageTaskRequestId":"r",
                "_desktopImageTaskStatus":"completed","message":{"content":[{"type":"tool_use","id":"t","name":"mcp__asci-image__generate_image"}]}}),
            json!({"type":"user","uuid":"image-output","_agentRequestId":"r",
                "message":{"content":[{"type":"tool_result","tool_use_id":"t","is_error":false}]}}),
            json!({"type":"assistant","uuid":"unrelated"}),
        ];
        let prefix = completed_prefix(&[], &image, "image-reply").unwrap();
        assert!(prefix.text.is_empty());
        assert_eq!(prefix.images, BTreeSet::from(["r".into()]));
        assert!(completed_prefix(&[], &image[..2], "image-reply").is_err());
        for (field, value) in [
            ("_desktopImageTaskStatus", "running"),
            ("_desktopImageTaskRequestId", "another"),
        ] {
            let mut invalid = image.clone();
            invalid[1][field] = json!(value);
            assert!(completed_prefix(&[], &invalid, "image-reply").is_err());
        }
        let mut tool = image.clone();
        tool[1]["message"]["content"][0]["name"] = json!("unrelated");
        assert!(completed_prefix(&[], &tool, "image-reply").is_err());
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
