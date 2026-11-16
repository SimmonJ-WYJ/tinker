//! 工具专用严格增量协议；完整 finish 与 DONE 后才提交调用。
use crate::{run_types::RunError, tool_types::*};
use serde::Deserialize;
#[derive(Default)]
pub(super) struct ToolOpenAi {
    call: Option<ProviderToolCall>,
    kind: Option<String>,
    finished: bool,
    done: bool,
}
#[derive(Deserialize)]
struct Frame {
    choices: Vec<Choice>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Choice {
    index: u32,
    delta: Delta,
    finish_reason: Option<String>,
    #[serde(default)]
    logprobs: Option<serde_json::Value>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Delta {
    role: Option<String>,
    content: Option<String>,
    tool_calls: Option<Vec<CallDelta>>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CallDelta {
    index: u32,
    id: Option<String>,
    #[serde(rename = "type")]
    kind: Option<String>,
    function: Option<Function>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Function {
    name: Option<String>,
    arguments: Option<String>,
}
impl ToolOpenAi {
    pub(super) fn complete(&self) -> bool {
        self.done
    }
    pub(super) fn output(&self) -> Result<ToolRoundOutput, RunError> {
        if !self.done {
            return Err(RunError::HttpProtocol);
        }
        Ok(self
            .call
            .clone()
            .map_or(ToolRoundOutput::Stop, ToolRoundOutput::ToolCall))
    }
    pub(super) fn frame(
        &mut self,
        data: &str,
        emit: &mut dyn FnMut(&str) -> Result<(), RunError>,
    ) -> Result<bool, RunError> {
        if self.done {
            return Err(RunError::HttpProtocol);
        }
        if data == "[DONE]" {
            if !self.finished {
                return Err(RunError::HttpProtocol);
            }
            self.done = true;
            return Ok(true);
        }
        if self.finished {
            return Err(RunError::HttpProtocol);
        }
        let frame: Frame = serde_json::from_str(data).map_err(|_| RunError::HttpProtocol)?;
        if frame.choices.len() != 1 {
            return Err(RunError::HttpUnsupported);
        }
        let choice = frame.choices.into_iter().next().unwrap();
        if choice.index != 0
            || choice.logprobs.is_some()
            || choice
                .delta
                .role
                .as_deref()
                .is_some_and(|r| r != "assistant")
        {
            return Err(RunError::HttpUnsupported);
        }
        if let Some(calls) = choice.delta.tool_calls {
            if calls.len() != 1 {
                return Err(RunError::HttpUnsupported);
            }
            let delta = calls.into_iter().next().unwrap();
            if delta.index != 0 {
                return Err(RunError::HttpUnsupported);
            }
            let call = self.call.get_or_insert_with(|| ProviderToolCall {
                id: String::new(),
                name: String::new(),
                arguments: String::new(),
            });
            if let Some(id) = delta.id {
                if id.is_empty() || !call.id.is_empty() {
                    return Err(RunError::HttpProtocol);
                }
                call.id = id;
            }
            if let Some(kind) = delta.kind {
                if self.kind.is_some() || kind != "function" {
                    return Err(RunError::HttpUnsupported);
                }
                self.kind = Some(kind);
            }
            if let Some(function) = delta.function {
                if let Some(name) = function.name {
                    if name.is_empty() || !call.name.is_empty() {
                        return Err(RunError::HttpProtocol);
                    }
                    call.name = name;
                }
                if let Some(args) = function.arguments {
                    call.arguments.push_str(&args);
                }
            }
            if call.id.len() > 64
                || call.name.len() > 64
                || call.arguments.len() > MAX_TOOL_ARGUMENT_BYTES
            {
                return Err(RunError::ToolArguments);
            }
        }
        if let Some(text) = choice.delta.content {
            emit(&text)?;
        }
        if let Some(reason) = choice.finish_reason {
            match (&self.call, reason.as_str()) {
                (None, "stop") => {}
                (Some(call), "tool_calls") if self.kind.as_deref() == Some("function") => {
                    ToolCall::from_provider(0, call.clone())?;
                }
                _ => return Err(RunError::HttpProtocol),
            }
            self.finished = true;
        }
        Ok(false)
    }
}
pub(super) fn messages(context: &ToolContext) -> Result<Vec<serde_json::Value>, RunError> {
    context.validate()?;
    context.messages.iter().map(|m| Ok(match m {
        TranscriptMessage::User{text}=>serde_json::json!({"role":"user","content":text}),
        TranscriptMessage::Assistant{text,call,..}=>{
            let mut value=serde_json::json!({"role":"assistant","content":text});
            if let Some(call)=call {value["tool_calls"]=serde_json::json!([{"id":call.call_id,"type":"function","function":{"name":call.name,"arguments":serde_json::to_string(&call.arguments).map_err(|_|RunError::ToolArguments)?}}]);}
            value
        },
        TranscriptMessage::Tool{result}=>serde_json::json!({"role":"tool","tool_call_id":result.call_id,"content":result.content}),
    })).collect()
}
pub(super) fn schemas(tools: &[ToolSpec]) -> Result<Vec<serde_json::Value>, RunError> {
    if tools.len() != 2
        || tools[0].name != ToolName::WorkspaceList
        || tools[1].name != ToolName::WorkspaceRead
    {
        return Err(RunError::ToolUnsupported);
    }
    Ok(tools.iter().map(|tool|serde_json::json!({"type":"function","function":{"name":tool.name,"description":tool.description,"strict":true,"parameters":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"],"additionalProperties":false}}})).collect())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn frame(delta: serde_json::Value, finish: Option<&str>) -> String {
        serde_json::json!({"choices":[{"index":0,"delta":delta,"finish_reason":finish}]})
            .to_string()
    }
    #[test]
    fn empty_metadata_cannot_be_replaced() {
        for field in ["id", "name", "type"] {
            let mut call = serde_json::json!({"index":0,"id":"c1","type":"function","function":{"name":"workspace_read","arguments":"{\"path\":\"notes/intro.txt\"}"}});
            if field == "name" {
                call["function"]["name"] = "".into();
            } else {
                call[field] = "".into();
            }
            let mut p = ToolOpenAi::default();
            assert!(
                p.frame(
                    &frame(serde_json::json!({"tool_calls":[call]}), None),
                    &mut |_| Ok(())
                )
                .is_err(),
                "{field}"
            );
        }
    }
    #[test]
    fn strict_protocol_rejects_ambiguous_and_incomplete_calls() {
        let invalid = [
            serde_json::json!({"function_call":{"name":"legacy"}}),
            serde_json::json!({"unknown":"x"}),
            serde_json::json!({"tool_calls":[]}),
            serde_json::json!({"tool_calls":[{"index":1}]}),
            serde_json::json!({"tool_calls":[{"index":0},{"index":0}]}),
        ];
        for delta in invalid {
            assert!(ToolOpenAi::default()
                .frame(&frame(delta, None), &mut |_| Ok(()))
                .is_err());
        }
        assert!(ToolOpenAi::default()
            .frame("[DONE]", &mut |_| Ok(()))
            .is_err());
        for args in [
            "{",
            "{\"path\":\"a\",\"path\":\"b\"}",
            "{\"path\":\"a\",\"extra\":true}",
        ] {
            let delta = serde_json::json!({"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"workspace_read","arguments":args}}]});
            assert!(ToolOpenAi::default()
                .frame(&frame(delta, Some("tool_calls")), &mut |_| Ok(()))
                .is_err());
        }
    }
    #[test]
    fn fragmented_call_and_text_require_explicit_finish_and_done() {
        let mut p = ToolOpenAi::default();
        let mut text = String::new();
        let first = serde_json::json!({"content":"visible","tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"workspace_read","arguments":"{\"path\":\""}}]});
        p.frame(&frame(first, None), &mut |s| {
            text.push_str(s);
            Ok(())
        })
        .unwrap();
        let second = serde_json::json!({"tool_calls":[{"index":0,"function":{"arguments":"notes/intro.txt\"}"}}]});
        p.frame(&frame(second, Some("tool_calls")), &mut |_| Ok(()))
            .unwrap();
        assert!(p.output().is_err());
        p.frame("[DONE]", &mut |_| Ok(())).unwrap();
        assert!(p.output().is_ok());
        assert_eq!(text, "visible");
        assert!(p
            .frame(
                &frame(serde_json::json!({"content":"late"}), None),
                &mut |_| Ok(())
            )
            .is_err());
    }
}
