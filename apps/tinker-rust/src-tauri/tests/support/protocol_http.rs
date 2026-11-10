//! 协议测试仅使用伪凭据和数字回环。
use serde_json::{json, Value};
pub fn event(kind: &str, mut value: Value) -> String {
    value["type"] = json!(kind);
    format!("event: {kind}\ndata: {value}\n\n")
}
pub fn start() -> String {
    event(
        "message_start",
        json!({"message":{"type":"message","role":"assistant","content":[],"stop_reason":null}}),
    )
}
pub fn block(index: u64) -> String {
    event(
        "content_block_start",
        json!({"index":index,"content_block":{"type":"text","text":""}}),
    )
}
pub fn delta(index: u64, text: &str) -> String {
    event(
        "content_block_delta",
        json!({"index":index,"delta":{"type":"text_delta","text":text}}),
    )
}
pub fn stop(index: u64) -> String {
    event("content_block_stop", json!({"index":index}))
}
pub fn finish(reason: &str) -> String {
    [
        event(
            "message_delta",
            json!({"delta":{"stop_reason":reason,"stop_sequence":null}}),
        ),
        event("message_stop", json!({})),
    ]
    .concat()
}
pub fn anthropic(text: &str) -> String {
    [
        start(),
        event("ping", json!({})),
        block(0),
        delta(0, text),
        stop(0),
        finish("end_turn"),
    ]
    .concat()
}
