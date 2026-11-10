//! OpenAI文本delta解码；沿用旧Lab的结束标志兼容。
use crate::run_types::{RunError, MAX_EVENT_BYTES, MAX_OUTPUT_BYTES};
use serde_json::Value;
#[derive(Default)]
pub(super) struct OpenAi {
    pub(super) finished: bool,
    output: usize,
}
impl OpenAi {
    pub(super) fn frame(
        &mut self,
        data: &str,
        emit: &mut dyn FnMut(&str) -> Result<(), RunError>,
    ) -> Result<bool, RunError> {
        if data == "[DONE]" {
            return Ok(true);
        }
        let value: Value = serde_json::from_str(data).map_err(|_| RunError::HttpProtocol)?;
        let choices = value
            .get("choices")
            .and_then(Value::as_array)
            .ok_or(RunError::HttpProtocol)?;
        if choices.is_empty() {
            return if value.get("usage").is_some() {
                Ok(false)
            } else {
                Err(RunError::HttpProtocol)
            };
        }
        if choices.len() != 1 {
            return Err(RunError::HttpUnsupported);
        }
        let choice = &choices[0];
        let delta = choice
            .get("delta")
            .and_then(Value::as_object)
            .ok_or(RunError::HttpProtocol)?;
        if delta.iter().any(|(key, value)| match key.as_str() {
            "role" | "content" => false,
            "refusal" | "tool_calls" | "function_call" => !value.is_null(),
            _ => true,
        }) {
            return Err(RunError::HttpUnsupported);
        }
        if let Some(content) = delta.get("content") {
            if !content.is_null() {
                let text = content.as_str().ok_or(RunError::HttpUnsupported)?;
                if self.finished && !text.is_empty() {
                    return Err(RunError::HttpProtocol);
                }
                self.output += text.len();
                if self.output > MAX_OUTPUT_BYTES || text.len() > MAX_EVENT_BYTES {
                    return Err(RunError::RunLimitExceeded);
                }
                if !text.is_empty() {
                    emit(text)?
                }
            }
        }
        if let Some(reason) = choice.get("finish_reason").filter(|v| !v.is_null()) {
            match reason.as_str() {
                Some("stop") => self.finished = true,
                Some("length" | "content_filter") => return Err(RunError::HttpProtocol),
                _ => return Err(RunError::HttpUnsupported),
            }
        }
        Ok(false)
    }
}
