//! 单轮工具 HTTP；凭据检查发生在持久化之前。
use super::*;
use crate::tool_types::*;
impl ChatHttpProvider {
    pub(super) fn check_tool_metadata(&self, value: &serde_json::Value) -> Result<(), RunError> {
        match value {
            serde_json::Value::String(text) => self.check_tool_secret(text)?,
            serde_json::Value::Array(items) => {
                for item in items {
                    self.check_tool_metadata(item)?;
                }
            }
            serde_json::Value::Object(items) => {
                for (name, item) in items {
                    self.check_tool_secret(name)?;
                    self.check_tool_metadata(item)?;
                }
            }
            _ => {}
        }
        Ok(())
    }

    pub(super) fn check_tool_secret(&self, text: &str) -> Result<(), RunError> {
        if text.contains(&self.config.key) {
            Err(RunError::ToolFailed)
        } else {
            Ok(())
        }
    }
    pub(super) fn preflight_tools(
        &self,
        context: &ToolContext,
        tools: &[ToolSpec],
    ) -> Result<(), RunError> {
        if self.config.protocol != HttpProtocol::OpenaiChat {
            return Err(RunError::ToolUnsupported);
        }
        context.validate()?;
        tool_openai::schemas(tools)?;
        for tool in tools {
            self.check_tool_secret(&tool.description)?;
        }
        for message in &context.messages {
            match message {
                TranscriptMessage::User { text } => self.check_tool_secret(text)?,
                TranscriptMessage::Assistant { text, call, .. } => {
                    self.check_tool_secret(text)?;
                    if let Some(c) = call {
                        self.check_tool_secret(&c.call_id)?;
                        self.check_tool_secret(&c.arguments.path)?;
                    }
                }
                TranscriptMessage::Tool { result } => self.validate_tool_result(result)?,
            }
        }
        Ok(())
    }
    pub(super) async fn stream_tools(
        &self,
        context: &ToolContext,
        tools: &[ToolSpec],
        cancelled: &AtomicBool,
        remaining: Duration,
        emit: &mut dyn FnMut(&str) -> Result<(), RunError>,
    ) -> Result<ToolRoundOutput, RunError> {
        if remaining.is_zero() || cancelled.load(Ordering::Acquire) {
            return Err(RunError::RunTimeout);
        }
        let deadline = tokio::time::Instant::now() + remaining.min(self.config.total);
        let mut builder = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .dns_resolver(RejectDns)
            .connect_timeout(self.config.idle);
        if !self.config.pins.is_empty() {
            builder = builder.resolve_to_addrs(
                self.config
                    .endpoint
                    .host_str()
                    .ok_or(RunError::HttpConfig)?,
                &self.config.pins,
            );
        }
        let client = builder.build().map_err(|_| RunError::HttpTransport)?;
        let mut body = serde_json::json!({"model":self.config.model,"messages":tool_openai::messages(context)?,"stream":true,"tools":tool_openai::schemas(tools)?,"parallel_tool_calls":false});
        if let Some(effort) = &self.config.effort {
            body["reasoning_effort"] = serde_json::json!(effort);
        }
        let body = serde_json::to_vec(&body).map_err(|_| RunError::HttpProtocol)?;
        if body.len() > MAX_HTTP_REQUEST_BYTES {
            return Err(RunError::ContextLimitExceeded);
        }
        let request = client
            .post(self.config.endpoint.clone())
            .bearer_auth(&self.config.key)
            .header("Accept", "text/event-stream")
            .header("Content-Type", "application/json")
            .body(body);
        let response = guarded(request.send(), cancelled, deadline, self.config.idle)
            .await?
            .ok_or(RunError::ToolFailed)?;
        let mut response = response.map_err(|_| RunError::HttpTransport)?;
        if !response.status().is_success() {
            return Err(RunError::HttpStatus);
        }
        if !response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| {
                v.split(';')
                    .next()
                    .is_some_and(|v| v.trim().eq_ignore_ascii_case("text/event-stream"))
            })
        {
            return Err(RunError::HttpProtocol);
        }
        let mut parser = Sse::tools();
        let mut secret = SecretGuard::new(&self.config.key);
        let mut bytes = 0usize;
        loop {
            let chunk = guarded(response.chunk(), cancelled, deadline, self.config.idle)
                .await?
                .ok_or(RunError::ToolFailed)?
                .map_err(|_| RunError::HttpTransport)?;
            let Some(chunk) = chunk else {
                break;
            };
            bytes = bytes.saturating_add(chunk.len());
            if bytes > 2 * 1024 * 1024 {
                return Err(RunError::RunLimitExceeded);
            }
            for byte in chunk {
                if cancelled.load(Ordering::Acquire) {
                    return Err(RunError::ToolFailed);
                }
                if tokio::time::Instant::now() >= deadline {
                    return Err(RunError::RunTimeout);
                }
                parser.push(byte, &mut |text| secret.push(text, emit))?;
            }
        }
        if !parser.complete() {
            return Err(RunError::HttpProtocol);
        }
        let output = parser.tool_output()?;
        if let ToolRoundOutput::ToolCall(raw) = &output {
            self.check_tool_secret(&raw.id)?;
            self.check_tool_secret(&raw.name)?;
            self.check_tool_secret(&raw.arguments)?;
            let call = ToolCall::from_provider(0, raw.clone())?;
            self.check_tool_secret(&call.arguments.path)?;
        }
        secret.finish(emit)?;
        Ok(output)
    }
}
