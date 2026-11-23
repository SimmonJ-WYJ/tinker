//! 认证图片协议；只使用宿主绑定秘密，禁止结果URL、代理、重定向与重试。
use super::{dimensions, provider::MAX_RESPONSE};
use crate::{
    credentialed_channels::{catalog::EndpointPolicy, endpoint, vault::Secret},
    desktop_runtime::protocol::{DesktopError, Result},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
// 与Electron image-generation-tool的180_000ms总预算保持一致；连接独立限5秒。
const IMAGE_TIMEOUT: Duration = Duration::from_secs(180);
pub(crate) struct CredentialedImageProvider {
    policy: EndpointPolicy,
    base: String,
    model: String,
    key: Arc<Secret>,
    timeout: Duration,
}
impl CredentialedImageProvider {
    // 与discovery一致，仅分类剥离一次前缀；请求仍发送原始模型ID。
    fn protocol_model(&self) -> &str {
        self.model.strip_prefix("openai/").unwrap_or(&self.model)
    }

    pub(crate) fn new(
        policy: EndpointPolicy,
        base: String,
        model: String,
        key: Arc<Secret>,
    ) -> Self {
        Self {
            policy,
            base,
            model,
            key,
            timeout: IMAGE_TIMEOUT,
        }
    }
    pub(crate) fn request(
        &self,
        prompt: &str,
        source: Option<(&str, Vec<u8>)>,
        cancelled: &AtomicBool,
    ) -> Result<(Vec<u8>, u32, u32)> {
        if tokio::runtime::Handle::try_current().is_ok() {
            return Err(DesktopError("imageWorkerRequired"));
        }
        if prompt.is_empty()
            || prompt.len() > 65536
            || self.model.trim().is_empty()
            || self.model.len() > 256
        {
            return Err(DesktopError("invalidParams"));
        }
        if self.protocol_model() == "dall-e-3" && source.is_some() {
            return Err(DesktopError("modelCapabilityMismatch"));
        }
        let has_secret = |bytes: &[u8]| {
            self.key
                .with_bytes(|key| !key.is_empty() && bytes.windows(key.len()).any(|w| w == key))
        };
        if has_secret(prompt.as_bytes()) || has_secret(self.model.as_bytes()) {
            return Err(DesktopError("invalidParams"));
        }
        let prepared = endpoint::prepare(&self.policy, &self.base, || {
            cancelled.load(Ordering::Acquire)
        })?;
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()?;
        runtime.block_on(async {
            let started = std::time::Instant::now();
            let work = self.fetch(prepared, prompt, source, cancelled);
            tokio::pin!(work);
            let deadline = tokio::time::sleep(self.timeout);
            tokio::pin!(deadline);
            loop {
                if cancelled.load(Ordering::Acquire) { return Err(DesktopError("imageInterrupted")); }
                tokio::select! {
                    value = &mut work => {
                        if cancelled.load(Ordering::Acquire) { return Err(DesktopError("imageInterrupted")); }
                        if started.elapsed() >= self.timeout { return Err(DesktopError("channelTimeout")); }
                        return value;
                    },
                    _ = &mut deadline => return Err(DesktopError("channelTimeout")),
                    _ = tokio::time::sleep(Duration::from_millis(5)) => {}
                }
            }
        })
    }

    async fn fetch(
        &self,
        prepared: endpoint::PreparedEndpoint,
        prompt: &str,
        source: Option<(&str, Vec<u8>)>,
        cancelled: &AtomicBool,
    ) -> Result<(Vec<u8>, u32, u32)> {
        let mut builder = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .dns_resolver(endpoint::RejectDns)
            .connect_timeout(Duration::from_secs(5));
        let url =
            reqwest::Url::parse(&prepared.base).map_err(|_| DesktopError("invalidEndpoint"))?;
        if !prepared.pins.is_empty() {
            builder = builder.resolve_to_addrs(
                url.host_str().ok_or(DesktopError("invalidEndpoint"))?,
                &prepared.pins,
            );
        }
        let client = builder
            .build()
            .map_err(|_| DesktopError("imageProviderUnavailable"))?;
        let action = if source.is_some() {
            "edits"
        } else {
            "generations"
        };
        let mut request = client.post(format!("{}/images/{action}", prepared.base));
        let auth = self.key.with_bytes(|key| {
            let mut bytes = b"Bearer ".to_vec();
            bytes.extend_from_slice(key);
            let mut value = reqwest::header::HeaderValue::from_bytes(&bytes)
                .map_err(|_| DesktopError("credentialInvalid"))?;
            value.set_sensitive(true);
            Ok::<_, DesktopError>(value)
        })?;
        request = request.header(reqwest::header::AUTHORIZATION, auth);
        if let Some((_, png)) = source {
            dimensions(&png)?;
            let boundary = "tinker-synthetic-image-boundary-7d4f";
            if png
                .windows(boundary.len())
                .any(|w| w == boundary.as_bytes())
                || prompt.contains(boundary)
                || self.model.contains(boundary)
            {
                return Err(DesktopError("invalidParams"));
            }
            let mut body = Vec::new();
            for (name, value) in [
                ("model", self.model.as_str()),
                ("prompt", prompt),
                ("n", "1"),
            ] {
                body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n").as_bytes());
            }
            if self.protocol_model() == "dall-e-2" {
                body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"response_format\"\r\n\r\nb64_json\r\n").as_bytes());
            }
            let image_field = if self.protocol_model() == "dall-e-2" {
                "image"
            } else {
                "image[]"
            };
            body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{image_field}\"; filename=\"reference.png\"\r\nContent-Type: image/png\r\n\r\n").as_bytes());
            body.extend_from_slice(&png);
            body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
            request = request
                .header(
                    "Content-Type",
                    format!("multipart/form-data; boundary={boundary}"),
                )
                .body(body);
        } else {
            let mut body = serde_json::json!({"model":self.model,"prompt":prompt,"n":1});
            if matches!(self.protocol_model(), "dall-e-2" | "dall-e-3") {
                body["response_format"] = serde_json::json!("b64_json");
            }
            request = request.json(&body);
        }
        let mut response = request.send().await.map_err(|e| {
            if e.is_timeout() {
                DesktopError("channelTimeout")
            } else {
                DesktopError("imageProviderUnavailable")
            }
        })?;
        if !response.status().is_success() {
            let error = crate::run_types::RunError::from_http_status(response.status().as_u16());
            return Err(DesktopError(match error {
                crate::run_types::RunError::HttpStatus => "imageProviderFailed",
                crate::run_types::RunError::HttpTimeout => "channelTimeout",
                other => other.code(),
            }));
        }
        if response
            .content_length()
            .is_some_and(|n| n > MAX_RESPONSE as u64)
        {
            return Err(DesktopError("imageTooLarge"));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| DesktopError("imageProviderFailed"))?
        {
            if chunk.len() > MAX_RESPONSE - bytes.len() {
                return Err(DesktopError("imageTooLarge"));
            }
            bytes.extend_from_slice(&chunk);
        }
        if self
            .key
            .with_bytes(|key| super::provider::response_has_secret(&bytes, cancelled, key))?
        {
            return Err(DesktopError("invalidImageResponse"));
        }
        drop(response);
        // 常规base64借用HTTP缓冲，只有JSON转义字符串才拥有副本；固定1个结果。
        #[derive(serde::Deserialize)]
        struct Envelope<'a> {
            #[serde(borrow)]
            data: [Item<'a>; 1],
        }
        #[derive(serde::Deserialize)]
        struct Item<'a> {
            #[serde(borrow)]
            b64_json: std::borrow::Cow<'a, str>,
        }
        let png = {
            let Envelope { data: [item] } = serde_json::from_slice::<Envelope<'_>>(&bytes)
                .map_err(|_| DesktopError("invalidImageResponse"))?;
            STANDARD
                .decode(item.b64_json.as_bytes())
                .map_err(|_| DesktopError("invalidImageResponse"))?
        };
        // JSON及HTTP缓冲在展开像素前释放；PNG所有权交给原地辅助块清理。
        drop(bytes);
        self.key
            .with_bytes(|key| super::provider::vendor_png(png, cancelled, key))
    }
}

#[cfg(test)]
#[path = "credentialed_provider_tests.rs"]
mod tests;
