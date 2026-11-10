//! Messages文本流状态机；非文本块、非成功停止及乱序均明确失败。
use crate::run_types::{RunError, MAX_EVENT_BYTES, MAX_OUTPUT_BYTES};
use serde_json::Value;
#[derive(Default)]
pub(super) struct Anthropic {
    started: bool,
    block: Option<u64>,
    next_index: u64,
    delta_seen: bool,
    normal_stop: bool,
    pub(super) finished: bool,
    output: usize,
}
impl Anthropic {
    fn text(
        &mut self,
        text: &str,
        emit: &mut dyn FnMut(&str) -> Result<(), RunError>,
    ) -> Result<(), RunError> {
        self.output = self.output.saturating_add(text.len());
        if self.output > MAX_OUTPUT_BYTES || text.len() > MAX_EVENT_BYTES {
            return Err(RunError::RunLimitExceeded);
        }
        if !text.is_empty() {
            emit(text)?;
        }
        Ok(())
    }
    pub(super) fn frame(
        &mut self,
        event: &str,
        data: &str,
        emit: &mut dyn FnMut(&str) -> Result<(), RunError>,
    ) -> Result<bool, RunError> {
        let v: Value = serde_json::from_str(data).map_err(|_| RunError::HttpProtocol)?;
        let kind = v["type"].as_str().ok_or(RunError::HttpProtocol)?;
        if event != kind || self.finished {
            return Err(RunError::HttpProtocol);
        }
        match kind {
            "ping" => {}
            "error" => return Err(RunError::HttpProtocol),
            "message_start" => {
                if self.started
                    || v["message"]["type"] != "message"
                    || v["message"]["role"] != "assistant"
                    || !v["message"]["stop_reason"].is_null()
                {
                    return Err(RunError::HttpProtocol);
                }
                let content = v["message"]["content"]
                    .as_array()
                    .ok_or(RunError::HttpProtocol)?;
                if !content.is_empty() {
                    return Err(RunError::HttpUnsupported);
                }
                self.started = true;
            }
            "content_block_start" => {
                let index = v["index"].as_u64().ok_or(RunError::HttpProtocol)?;
                if !self.started
                    || self.block.is_some()
                    || self.delta_seen
                    || index != self.next_index
                {
                    return Err(RunError::HttpProtocol);
                }
                let b = &v["content_block"];
                if b["type"] != "text"
                    || b.get("citations")
                        .is_some_and(|c| !c.is_null() && c.as_array().is_none_or(|c| !c.is_empty()))
                {
                    return Err(RunError::HttpUnsupported);
                }
                let text = b["text"].as_str().ok_or(RunError::HttpProtocol)?;
                self.block = Some(index);
                self.text(text, emit)?;
            }
            "content_block_delta" => {
                let index = v["index"].as_u64().ok_or(RunError::HttpProtocol)?;
                if self.block != Some(index) || self.delta_seen {
                    return Err(RunError::HttpProtocol);
                }
                if v["delta"]["type"] != "text_delta" {
                    return Err(RunError::HttpUnsupported);
                }
                let text = v["delta"]["text"]
                    .as_str()
                    .ok_or(RunError::HttpUnsupported)?;
                self.text(text, emit)?;
            }
            "content_block_stop" => {
                let index = v["index"].as_u64().ok_or(RunError::HttpProtocol)?;
                if self.block != Some(index) {
                    return Err(RunError::HttpProtocol);
                }
                self.block = None;
                self.next_index += 1;
            }
            "message_delta" => {
                if !self.started || self.block.is_some() {
                    return Err(RunError::HttpProtocol);
                }
                let delta = &v["delta"];
                if !delta.is_null() && !delta.is_object() {
                    return Err(RunError::HttpProtocol);
                }
                // usage-only和null更新不清除先前确认的end_turn。
                match delta.get("stop_reason") {
                    None | Some(Value::Null) => {}
                    Some(Value::String(reason)) => match reason.as_str() {
                        "end_turn" => self.normal_stop = true,
                        "max_tokens" => return Err(RunError::HttpProtocol),
                        _ => return Err(RunError::HttpUnsupported),
                    },
                    Some(_) => return Err(RunError::HttpProtocol),
                }
                if !delta["stop_sequence"].is_null() {
                    return Err(RunError::HttpUnsupported);
                }
                self.delta_seen = true;
            }
            "message_stop" => {
                if !self.normal_stop || self.block.is_some() {
                    return Err(RunError::HttpProtocol);
                }
                self.finished = true;
                return Ok(true);
            }
            // 官方要求向前兼容未知事件；已知内容类型不会进入此分支。
            _ => {}
        }
        Ok(false)
    }
}
