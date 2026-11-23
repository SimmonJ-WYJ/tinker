//! 回环图片测试协议；端口只由宿主注入，不接受重定向、代理或上游图片 URL。
use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::json;
use std::{net::SocketAddr, time::Duration};

const MAX_RESPONSE: usize = 704 * 1024;
pub(crate) const MAX_PNG: usize = 512 * 1024;
pub(super) const MODEL: &str = "local-image";
pub(super) const CHANNEL: &str = "local-image-mock";

#[derive(Clone)]
pub struct LoopbackImageProvider(SocketAddr);
impl LoopbackImageProvider {
    pub fn new(address: SocketAddr) -> Result<Self> {
        if !address.ip().is_loopback() || address.port() == 0 {
            return Err(DesktopError("invalidImageEndpoint"));
        }
        Ok(Self(address))
    }

    pub(super) fn request(
        &self,
        prompt: &str,
        source: Option<(&str, Vec<u8>)>,
        cancelled: &AtomicBool,
    ) -> Result<(Vec<u8>, u32, u32)> {
        if tokio::runtime::Handle::try_current().is_ok() {
            return Err(DesktopError("imageWorkerRequired"));
        }
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()?;
        runtime.block_on(async {
            let send = self.fetch(prompt, source);
            tokio::pin!(send);
            loop {
                if cancelled.load(Ordering::Acquire) {
                    return Err(DesktopError("imageInterrupted"));
                }
                tokio::select! {
                    value = &mut send => return value,
                    _ = tokio::time::sleep(Duration::from_millis(10)) => {}
                }
            }
        })
    }

    async fn fetch(
        &self,
        prompt: &str,
        source: Option<(&str, Vec<u8>)>,
    ) -> Result<(Vec<u8>, u32, u32)> {
        let mut body = json!({"model":MODEL, "prompt":prompt, "n":1, "response_format":"b64_json"});
        let action = if let Some((id, bytes)) = source {
            body["referenceImage"] = json!({"id":id, "b64_json":STANDARD.encode(bytes)});
            "edits"
        } else {
            "generations"
        };
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(12))
            .build()
            .map_err(|_| DesktopError("imageProviderUnavailable"))?;
        let mut response = client
            .post(format!("http://{}/v1/images/{action}", self.0))
            .json(&body)
            .send()
            .await
            .map_err(|_| DesktopError("imageProviderUnavailable"))?;
        if !response.status().is_success() {
            return Err(DesktopError("imageProviderFailed"));
        }
        if response
            .content_length()
            .is_some_and(|v| v > MAX_RESPONSE as u64)
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
        #[derive(Deserialize)]
        struct Output {
            data: [Item; 1],
        }
        #[derive(Deserialize)]
        struct Item {
            b64_json: String,
        }
        let Output { data: [item] } =
            serde_json::from_slice(&bytes).map_err(|_| DesktopError("invalidImageResponse"))?;
        let png = STANDARD
            .decode(item.b64_json)
            .map_err(|_| DesktopError("invalidImageResponse"))?;
        let (width, height) = dimensions(&png)?;
        Ok((png, width, height))
    }
}

pub(crate) fn validate_pixel_count(width: u32, height: u32) -> Result<()> {
    if width > 4096 || height > 4096 || u64::from(width) * u64::from(height) > 4_194_304 {
        return Err(DesktopError("imageTooLarge"));
    }
    Ok(())
}

pub(crate) fn dimensions(bytes: &[u8]) -> Result<(u32, u32)> {
    let invalid = DesktopError("invalidImageResponse");
    if bytes.len() > MAX_PNG {
        return Err(DesktopError("imageTooLarge"));
    }
    if !bytes.ends_with(b"\x00\x00\x00\x00IEND\xae\x42\x60\x82") {
        return Err(invalid);
    }
    let mut decoder = png::Decoder::new(bytes);
    decoder.set_limits(png::Limits {
        bytes: 32 * 1024 * 1024,
    });
    decoder.set_ignore_text_chunk(true);
    decoder.set_ignore_iccp_chunk(true);
    let mut reader = decoder.read_info().map_err(|_| invalid)?;
    let info = reader.info();
    let (w, h) = (info.width, info.height);
    validate_pixel_count(w, h)?;
    if info.animation_control.is_some()
        || w == 0
        || h == 0
        || reader.output_buffer_size() > 16 * 1024 * 1024
    {
        return Err(invalid);
    }
    reader
        .next_frame(&mut vec![0; reader.output_buffer_size()])
        .map_err(|_| invalid)?;
    reader.finish().map_err(|_| invalid)?;
    Ok((w, h))
}
