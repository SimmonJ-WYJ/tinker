//! 原生图片投影复用现有 SDK 工具和引用附件形状。
use crate::formal_images::{ImageAsset, ImageStatus, ImageTurn};
use serde_json::{json, Value};

pub(super) fn attachment(sid: &str, asset: &ImageAsset) -> Value {
    json!({"localPath":format!("{sid}/{}",asset.filename),"filename":asset.filename,"mediaType":"image/png"})
}
pub(super) fn user_message(sid: &str, turn: &ImageTurn) -> Value {
    json!({"type":"user","uuid":format!("native-image-{sid}-{}-user", turn.request_id),
        "parent_tool_use_id":null,"_createdAt":turn.created_at,"_agentRequestId":turn.request_id,
        "message":{"content":[{"type":"text","text":turn.prompt}]}})
}
pub(super) fn project(
    sid: &str,
    turn: &ImageTurn,
    turns: &[ImageTurn],
) -> (Vec<Value>, Vec<Value>) {
    let id = format!("native-image-{sid}-{}", turn.request_id);
    let assistant_id = format!("{id}-assistant");
    let tool_id = format!("{id}-tool");
    let mut user = user_message(sid, turn);
    if let Some(base) = turn.base_image_id.as_ref().and_then(|base| {
        turns
            .iter()
            .find(|v| v.asset.as_ref().is_some_and(|a| a.id == *base))
    }) {
        if let Some(asset) = &base.asset {
            let mut reference = attachment(sid, asset);
            reference["imageId"] = json!(asset.id);
            reference["sourceMessageId"] =
                json!(format!("native-image-{sid}-{}-assistant", base.request_id));
            user["imageEditReference"] = reference;
        }
    }
    let mut plain = vec![
        json!({"id":user["uuid"],"role":"user","createdAt":turn.created_at,"content":turn.prompt}),
    ];
    let mut sdk = vec![user];
    if turn.status == ImageStatus::Pending {
        return (plain, sdk);
    }
    let (result,error)=match &turn.asset {
   Some(a)=>(json!({"imageId":a.id,"baseImageId":turn.base_image_id,"model":a.model,"channelName":a.channel_id,"referenceCount":a.reference_ids.len(),"width":a.width,"height":a.height,"generatedImage":attachment(sid,a)}).to_string(),false),
   None=>(turn.error.as_deref().unwrap_or("imageInterrupted").into(),true),
 };
    let mut input = json!({"prompt":turn.prompt});
    if let Some(r) = &turn.base_image_id {
        input["baseImageId"] = json!(r);
    }
    sdk.push(json!({"type":"assistant","uuid":assistant_id,"parent_tool_use_id":null,"_createdAt":turn.created_at,"_agentRequestId":turn.request_id,"message":{"model":"local-image","content":[{"type":"tool_use","id":tool_id,"name":"mcp__asci-image__generate_image","input":input}]}}));
    sdk.push(json!({"type":"user","uuid":format!("{id}-result"),"parent_tool_use_id":null,"_createdAt":turn.created_at,"message":{"content":[{"type":"tool_result","tool_use_id":tool_id,"is_error":error,"content":result}]}}));
    plain.push(json!({"id":assistant_id,"role":"assistant","model":"local-image","createdAt":turn.created_at,"content":""}));
    (plain, sdk)
}
