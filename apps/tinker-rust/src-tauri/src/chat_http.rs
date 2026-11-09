//! 可信宿主配置的文本Chat Completions；错误仅使用固定码，取消丢弃网络future。
use crate::{
    run_provider::RunProvider,
    run_types::{RunError, MAX_EVENT_BYTES, MAX_OUTPUT_BYTES},
};
use serde_json::Value;
use std::{
    future::Future,
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};
/// 不实现Debug，避免URL、凭据和模型配置进入日志。端点须包含完整路径。
pub struct ChatHttpConfig {
    endpoint: reqwest::Url,
    key: String,
    model: String,
    pins: Vec<std::net::SocketAddr>,
    total: Duration,
    idle: Duration,
}
impl ChatHttpConfig {
    pub fn new(endpoint: String, key: String, model: String) -> Result<Self, RunError> {
        Self::new_with_pins(endpoint, key, model, Vec::new())
    }
    /// 域名仅用可信宿主预先提供的地址；本模块绝不调用系统DNS。
    /// pins的解析、更新和授权由宿主另行负责，不从环境读取。
    pub fn new_with_pins(
        endpoint: String,
        key: String,
        model: String,
        pins: Vec<std::net::SocketAddr>,
    ) -> Result<Self, RunError> {
        let endpoint = reqwest::Url::parse(&endpoint).map_err(|_| RunError::HttpConfig)?;
        if !matches!(endpoint.scheme(), "http" | "https")
            || endpoint.host_str().is_none()
            || !endpoint.username().is_empty()
            || endpoint.password().is_some()
            || endpoint.query().is_some()
            || endpoint.fragment().is_some()
            || key.trim().is_empty()
            || key.len() > 8192
            || key.contains(['\r', '\n'])
            || model.trim().is_empty()
            || model.len() > 256
        {
            return Err(RunError::HttpConfig);
        }
        // 明文仅允许数字回环；未来可信宿主的远端服务必须HTTPS。
        if endpoint.scheme() == "http"
            && !endpoint
                .host_str()
                .and_then(|host| {
                    host.trim_matches(['[', ']'])
                        .parse::<std::net::IpAddr>()
                        .ok()
                })
                .is_some_and(|ip| ip.is_loopback())
        {
            return Err(RunError::HttpConfig);
        }
        let numeric = endpoint.host_str().and_then(|host| {
            host.trim_matches(['[', ']'])
                .parse::<std::net::IpAddr>()
                .ok()
        });
        if (numeric.is_none() && pins.is_empty())
            || pins.len() > 16
            || pins.iter().any(|addr| {
                addr.ip().is_unspecified() || addr.ip().is_multicast() || addr.port() == 0
            })
            || (numeric.is_some() && !pins.is_empty())
        {
            return Err(RunError::HttpConfig);
        }
        Ok(Self {
            endpoint,
            pins,
            key,
            model,
            total: Duration::from_secs(120),
            idle: Duration::from_secs(15),
        })
    }
    /// 测试或可信宿主可收紧预算；最长两分钟，每次网络等待最长十五秒。
    pub fn with_timeouts(mut self, total: Duration, idle: Duration) -> Result<Self, RunError> {
        if total.is_zero()
            || idle.is_zero()
            || total > Duration::from_secs(120)
            || idle > Duration::from_secs(15)
        {
            return Err(RunError::HttpConfig);
        }
        self.total = total;
        self.idle = idle;
        Ok(self)
    }
}
pub struct ChatHttpProvider {
    config: ChatHttpConfig,
}
impl ChatHttpProvider {
    pub fn new(config: ChatHttpConfig) -> Self {
        Self { config }
    }
}
async fn guarded<T>(
    future: impl Future<Output = T>,
    token: &AtomicBool,
    total: tokio::time::Instant,
    idle: Duration,
) -> Result<Option<T>, RunError> {
    tokio::pin!(future);
    let deadline = std::cmp::min(total, tokio::time::Instant::now() + idle);
    loop {
        if token.load(Ordering::Acquire) {
            return Ok(None);
        }
        tokio::select! {result=&mut future=>return Ok(Some(result)),_=tokio::time::sleep_until(deadline)=>return Err(RunError::HttpTimeout),_=tokio::time::sleep(Duration::from_millis(5))=>{}}
    }
}
// 不允许系统resolver作为任何意外路径的后备，避免spawn_blocking DNS拖住runtime析构。
struct RejectDns;
impl reqwest::dns::Resolve for RejectDns {
    fn resolve(&self, _: reqwest::dns::Name) -> reqwest::dns::Resolving {
        Box::pin(async { Err(std::io::Error::other("dnsDisabled").into()) })
    }
}
impl RunProvider for ChatHttpProvider {
    fn execute(
        &self,
        input: &str,
        cancelled: &AtomicBool,
        emit: &mut dyn FnMut(&str) -> Result<(), RunError>,
    ) -> Result<(), RunError> {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|_| RunError::HttpTransport)?;
        runtime.block_on(self.stream(input, cancelled, emit))
    }
}
impl ChatHttpProvider {
    async fn stream(
        &self,
        input: &str,
        cancelled: &AtomicBool,
        emit: &mut dyn FnMut(&str) -> Result<(), RunError>,
    ) -> Result<(), RunError> {
        if cancelled.load(Ordering::Acquire) {
            return Ok(());
        }
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
        let deadline = tokio::time::Instant::now() + self.config.total;
        let request = client.post(self.config.endpoint.clone()).bearer_auth(&self.config.key)
            .header("Accept", "text/event-stream")
            .json(&serde_json::json!({"model":self.config.model,"messages":[{"role":"user","content":input}],"stream":true}));
        let Some(response) = guarded(request.send(), cancelled, deadline, self.config.idle).await?
        else {
            return Ok(());
        };
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
        let mut parser = Sse::default();
        let mut bytes = 0usize;
        let mut secret = SecretGuard::new(&self.config.key);
        loop {
            let Some(chunk) =
                guarded(response.chunk(), cancelled, deadline, self.config.idle).await?
            else {
                return Ok(());
            };
            let chunk = chunk.map_err(|_| RunError::HttpTransport)?;
            let Some(chunk) = chunk else {
                if !parser.finished || !parser.data.is_empty() || !parser.line.is_empty() {
                    return Err(RunError::HttpProtocol);
                }
                return secret.finish(emit);
            };
            bytes = bytes.saturating_add(chunk.len());
            if bytes > 2 * 1024 * 1024 {
                return Err(RunError::RunLimitExceeded);
            }
            for byte in chunk {
                if cancelled.load(Ordering::Acquire) {
                    return Ok(());
                }
                if tokio::time::Instant::now() >= deadline {
                    return Err(RunError::HttpTimeout);
                }
                if parser.push(byte, &mut |text| secret.push(text, emit))? {
                    if cancelled.load(Ordering::Acquire) {
                        return Ok(());
                    }
                    return secret.finish(emit);
                }
            }
        }
    }
}
/// 只提交不可能属于已知凭据的前缀，跨帧匹配不会先泄漏一部分。
struct SecretGuard<'a> {
    key: &'a str,
    pending: String,
}
impl<'a> SecretGuard<'a> {
    fn new(key: &'a str) -> Self {
        Self {
            key,
            pending: String::new(),
        }
    }
    fn push(
        &mut self,
        text: &str,
        emit: &mut dyn FnMut(&str) -> Result<(), RunError>,
    ) -> Result<(), RunError> {
        self.pending.push_str(text);
        if self.pending.contains(self.key) {
            return Err(RunError::HttpProtocol);
        }
        let keep = (1..=self.pending.len().min(self.key.len()))
            .filter(|&n| {
                self.pending.is_char_boundary(self.pending.len() - n)
                    && self.key.is_char_boundary(n)
                    && self.pending.ends_with(&self.key[..n])
            })
            .max()
            .unwrap_or(0);
        let split = self.pending.len() - keep;
        if split > 0 {
            emit_safe_chunks(&self.pending[..split], emit)?;
            self.pending.drain(..split);
        }
        Ok(())
    }
    fn finish(&self, emit: &mut dyn FnMut(&str) -> Result<(), RunError>) -> Result<(), RunError> {
        if !self.pending.is_empty() {
            emit_safe_chunks(&self.pending, emit)?;
        }
        Ok(())
    }
}
// RunStore限制完整JSONL事件为16KiB。UTF8原字节最多6倍JSON转义；
// 每片<=2048原字节时最多12288编码字节，余4096足够固定字段、<=64字节runId与序号。
// 正常释放与完成刷新共用此边界，不把跨帧凭据暂存合并成超限事件。
fn emit_safe_chunks(
    mut text: &str,
    emit: &mut dyn FnMut(&str) -> Result<(), RunError>,
) -> Result<(), RunError> {
    while !text.is_empty() {
        let mut end = text.len().min(MAX_EVENT_BYTES / 8);
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        emit(&text[..end])?;
        text = &text[end..];
    }
    Ok(())
}
#[derive(Default)]
struct Sse {
    line: Vec<u8>,
    data: String,
    frame_bytes: usize,
    output: usize,
    finished: bool,
    skip_lf: bool,
    first_line_seen: bool,
}
impl Sse {
    fn push(
        &mut self,
        byte: u8,
        emit: &mut dyn FnMut(&str) -> Result<(), RunError>,
    ) -> Result<bool, RunError> {
        if self.skip_lf {
            self.skip_lf = false;
            if byte == b'\n' {
                return Ok(false);
            }
        }
        self.frame_bytes += 1;
        if self.frame_bytes > 64 * 1024 {
            return Err(RunError::RunLimitExceeded);
        }
        if byte != b'\n' && byte != b'\r' {
            self.line.push(byte);
            return Ok(false);
        }
        self.skip_lf = byte == b'\r';
        let line = std::mem::take(&mut self.line);
        let line = line.strip_suffix(b"\r").unwrap_or(&line);
        let line = std::str::from_utf8(line).map_err(|_| RunError::HttpProtocol)?;
        let line = if !self.first_line_seen {
            self.first_line_seen = true;
            line.strip_prefix('\u{feff}').unwrap_or(line)
        } else {
            line
        };
        if line.is_empty() {
            self.frame_bytes = 0;
            if self.data.is_empty() {
                return Ok(false);
            }
            let data = std::mem::take(&mut self.data);
            return self.frame(data.trim_end_matches('\n'), emit);
        }
        if let Some(data) = line.strip_prefix("data:") {
            self.data.push_str(data.strip_prefix(' ').unwrap_or(data));
            self.data.push('\n');
        }
        Ok(false)
    }
    fn frame(
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
