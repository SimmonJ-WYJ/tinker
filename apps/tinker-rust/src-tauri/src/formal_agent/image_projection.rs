//! 原生图片投影复用现有 SDK 工具和引用附件形状。
use crate::formal_images::{ImageAsset, ImageStatus, ImageTurn, ImportedImage};
use serde_json::{json, Value};

pub(super) fn attachment(sid: &str, asset: &ImageAsset) -> Value {
    json!({"localPath":format!("{sid}/{}",asset.filename),"filename":asset.filename,"mediaType":"image/png"})
}
fn image_kind(turn: &ImageTurn) -> &'static str {
    if turn.base_image_id.is_some() {
        "edit"
    } else {
        "generate"
    }
}
pub(super) fn user_message(sid: &str, turn: &ImageTurn) -> Value {
    json!({"type":"user","uuid":format!("native-image-{sid}-{}-user", turn.request_id),
        "parent_tool_use_id":null,"_createdAt":turn.created_at,"_agentRequestId":turn.request_id,"_desktopImageTaskRequestId":turn.request_id,"_desktopImageTaskKind":image_kind(turn),
        "message":{"content":[{"type":"text","text":turn.prompt}]}})
}
pub(super) fn project(
    sid: &str,
    turn: &ImageTurn,
    turns: &[ImageTurn],
    imports: &[ImportedImage],
) -> (Vec<Value>, Vec<Value>) {
    let model = turn
        .route()
        .map_or("local-image", |route| route.model_id.as_str());
    let id = format!("native-image-{sid}-{}", turn.request_id);
    let assistant_id = format!("{id}-assistant");
    let tool_id = format!("{id}-tool");
    let mut user = user_message(sid, turn);
    if let Some(id) = &turn.base_image_id {
        if let Some((asset, request)) = turns
            .iter()
            .filter_map(|t| t.asset.as_ref().map(|a| (a, &t.request_id)))
            .find(|(a, _)| a.id == *id)
        {
            let mut reference = attachment(sid, asset);
            reference["imageId"] = json!(asset.id);
            reference["sourceMessageId"] = json!(format!("native-image-{sid}-{request}-assistant"));
            user["imageEditReference"] = reference;
        } else if let Some(source) = imports.iter().find(|a| a.id == *id) {
            // 本地导入图没有助手生成消息；链接到同会话的实际附件。
            user["imageEditReference"] = json!({"imageId":source.id,"localPath":format!("{sid}/{}", source.filename),
                "filename":source.filename,"displayName":source.display_name,"mediaType":"image/png"});
        }
    }
    let mut plain = vec![
        json!({"id":user["uuid"],"role":"user","createdAt":turn.created_at,"content":turn.prompt}),
    ];
    let mut sdk = vec![user];
    let mut input = json!({"prompt":turn.prompt});
    if let Some(r) = &turn.base_image_id {
        input["baseImageId"] = json!(r);
    }
    sdk.push(json!({"type":"assistant","uuid":assistant_id,"_desktopImageTaskRequestId":turn.request_id,"_desktopImageTaskKind":image_kind(turn),"_desktopImageTaskStatus":turn.task_status(),"parent_tool_use_id":null,"_createdAt":turn.created_at,"_agentRequestId":turn.request_id,"message":{"model":model,"content":[{"type":"tool_use","id":tool_id,"name":"mcp__asci-image__generate_image","input":input}]}}));
    if turn.status == ImageStatus::Pending {
        return (plain, sdk);
    }
    if turn.route().is_some() && turn.task_status() == crate::session_lifecycle::RunStatus::Failed {
        if let Some(assistant) = sdk.last_mut() {
            assistant["_desktopImageTaskError"] = json!(super::images::image_error(turn));
        }
    }
    let (result,error)=match &turn.asset {
   Some(a)=>(json!({"imageId":a.id,"baseImageId":turn.base_image_id,"model":a.model,"channelName":a.channel_id,"referenceCount":a.reference_ids.len(),"width":a.width,"height":a.height,"generatedImage":attachment(sid,a)}).to_string(),false),
   None=>(turn.error.as_deref().unwrap_or("imageInterrupted").into(),true),
 };
    sdk.push(json!({"type":"user","uuid":format!("{id}-result"),"_agentRequestId":turn.request_id,"parent_tool_use_id":null,"_createdAt":turn.created_at,"message":{"content":[{"type":"tool_result","tool_use_id":tool_id,"is_error":error,"content":result}]}}));
    plain.push(json!({"id":assistant_id,"role":"assistant","model":model,"createdAt":turn.created_at,"content":""}));
    (plain, sdk)
}
