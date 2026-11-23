//! 显式、有界、仅GET的模型目录；先验证解码内容，再投影公共模型。
use super::{
    catalog::{EndpointPolicy, ModelCapability},
    endpoint::{self, PreparedEndpoint},
    vault::Secret,
    worker::{contains, guard, Known},
};
use crate::{
    chat_http::HttpProtocol,
    desktop_runtime::protocol::{DesktopError, Result},
};
use serde_json::{json, Value};
use std::{collections::BTreeSet, time::Duration};

pub(crate) fn catalog(
    policy: &EndpointPolicy,
    base: &str,
    protocol: HttpProtocol,
    key: &Secret,
    known: &Known,
    cancelled: &impl Fn() -> bool,
) -> Result<Vec<Value>> {
    let started = std::time::Instant::now();
    let endpoint = endpoint::prepare(policy, base, cancelled)?;
    let remaining = Duration::from_secs(2)
        .checked_sub(started.elapsed())
        .filter(|d| !d.is_zero())
        .ok_or(DesktopError("channelTimeout"))?;
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| DesktopError("catalogUnavailable"))?;
    rt.block_on(async {
        let operation = fetch(&endpoint, protocol, key, known, cancelled);
        tokio::select! {
            result = tokio::time::timeout(remaining, operation) => result.map_err(|_| DesktopError("channelTimeout"))?,
            () = async { while !cancelled() { tokio::time::sleep(Duration::from_millis(5)).await; } } => Err(DesktopError("staleGeneration")),
        }
    })
}
async fn fetch(
    endpoint: &PreparedEndpoint,
    protocol: HttpProtocol,
    key: &Secret,
    known: &Known,
    cancelled: &impl Fn() -> bool,
) -> Result<Vec<Value>> {
    if cancelled() {
        return Err(DesktopError("staleGeneration"));
    }
    let mut builder = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .dns_resolver(endpoint::RejectDns)
        .connect_timeout(Duration::from_secs(2));
    if !endpoint.pins.is_empty() {
        let url =
            reqwest::Url::parse(&endpoint.base).map_err(|_| DesktopError("invalidEndpoint"))?;
        builder = builder.resolve_to_addrs(
            url.host_str().ok_or(DesktopError("invalidEndpoint"))?,
            &endpoint.pins,
        );
    }
    let client = builder
        .build()
        .map_err(|_| DesktopError("catalogUnavailable"))?;
    let request = client
        .get(format!("{}/models", endpoint.base))
        .header("Accept", "application/json");
    let request = key.with_bytes(|bytes| {
        let key = std::str::from_utf8(bytes).map_err(|_| DesktopError("invalidCredential"))?;
        Ok::<_, DesktopError>(match protocol {
            HttpProtocol::OpenaiChat => request.bearer_auth(key),
            HttpProtocol::AnthropicMessages => request
                .header("x-api-key", key)
                .header("anthropic-version", "2023-06-01"),
        })
    })?;
    if cancelled() {
        return Err(DesktopError("staleGeneration"));
    }
    let mut response = request.send().await.map_err(|e| {
        DesktopError(if e.is_timeout() {
            "channelTimeout"
        } else {
            "catalogUnavailable"
        })
    })?;
    if !response.status().is_success() {
        use crate::run_types::RunError;
        let failure = RunError::from_http_status(response.status().as_u16());
        return Err(DesktopError(match failure {
            RunError::HttpTimeout => "channelTimeout",
            RunError::HttpStatus => "catalogUnavailable",
            other => other.code(),
        }));
    }
    let is_json = response
        .headers()
        .get("content-type")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.split(';').next())
        .is_some_and(|s| s.trim().eq_ignore_ascii_case("application/json"));
    if response.content_length().is_some_and(|n| n > 65536) || !is_json {
        return Err(DesktopError("catalogUnavailable"));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| DesktopError("catalogUnavailable"))?
    {
        if bytes.len() + chunk.len() > 65536 {
            return Err(DesktopError("catalogUnavailable"));
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| DesktopError("catalogUnavailable"))?;
    let models = validate_catalog(&value, protocol, key, known)?;
    if cancelled() {
        return Err(DesktopError("staleGeneration"));
    }
    Ok(models)
}
fn validate_catalog(
    value: &Value,
    protocol: HttpProtocol,
    key: &Secret,
    known: &Known,
) -> Result<Vec<Value>> {
    // 临时探测凭据只在此操作内检查；JSON转义必须先解码，且对象键也不能携带秘密。
    if key.with_bytes(|key| contains(value, key)) {
        return Err(DesktopError("catalogUnavailable"));
    }
    guard(value, known).map_err(|_| DesktopError("catalogUnavailable"))?;
    let data = value["data"]
        .as_array()
        .filter(|a| !a.is_empty() && a.len() <= 128)
        .ok_or(DesktopError("catalogUnavailable"))?;
    if value.get("has_more").is_some_and(|v| v != false) {
        return Err(DesktopError("catalogUnavailable"));
    }
    let mut seen = BTreeSet::new();
    let mut models = Vec::new();
    for model in data {
        let id = model["id"]
            .as_str()
            .ok_or(DesktopError("catalogUnavailable"))?;
        crate::desktop_runtime::protocol::model_id(id)
            .map_err(|_| DesktopError("catalogUnavailable"))?;
        if !seen.insert(id) {
            return Err(DesktopError("catalogUnavailable"));
        }
        let name = if protocol == HttpProtocol::AnthropicMessages {
            model
                .get("display_name")
                .and_then(Value::as_str)
                .unwrap_or(id)
        } else {
            id
        };
        if name.trim().is_empty() || name.len() > 256 || name.chars().any(char::is_control) {
            return Err(DesktopError("catalogUnavailable"));
        }
        let (capability, edits) = discovered_route(protocol, id, model);
        let mut row = json!({"id":id,"name":name,"enabled":capability != ModelCapability::Unsupported,"capability":capability});
        if capability == ModelCapability::Image {
            row["supportsImageEdits"] = json!(edits);
        }
        models.push(row);
    }
    Ok(models)
}

/// 只检查输出和 API 端点；识图输入能力不能授权生成。旧目录的重放不经过发现。
fn discovered_route(protocol: HttpProtocol, id: &str, row: &Value) -> (ModelCapability, bool) {
    use ModelCapability::{Image, Text, Unsupported};
    let id = id.strip_prefix("openai/").unwrap_or(id);
    let edits = id
        .strip_prefix("gpt-image-")
        .is_some_and(|s| s.as_bytes().first().is_some_and(u8::is_ascii_digit))
        || id == "dall-e-2";
    let image = edits || id == "dall-e-3";
    if let Some(endpoints) = row.get("supported_endpoints") {
        let Some(list) = endpoints
            .as_array()
            .filter(|a| a.iter().all(Value::is_string))
        else {
            return (Unsupported, false);
        };
        let has = |path| {
            list.iter()
                .filter_map(Value::as_str)
                .any(|p| p.strip_prefix("/v1").unwrap_or(p) == path)
        };
        if protocol == HttpProtocol::OpenaiChat && has("/images/generations") {
            return (Image, id != "dall-e-3" && has("/images/edits"));
        }
        let chat = match protocol {
            HttpProtocol::OpenaiChat => "/chat/completions",
            HttpProtocol::AnthropicMessages => "/messages",
        };
        return (if has(chat) { Text } else { Unsupported }, false);
    }
    if let Some(output) = row
        .get("output_modalities")
        .or_else(|| row.pointer("/architecture/output_modalities"))
    {
        return match output
            .as_array()
            .and_then(|v| if v.len() == 1 { v[0].as_str() } else { None })
        {
            Some("image") if protocol == HttpProtocol::OpenaiChat => (Image, edits),
            Some("text") => (Text, false),
            _ => (Unsupported, false),
        };
    }
    if image {
        return (
            if protocol == HttpProtocol::OpenaiChat {
                Image
            } else {
                Unsupported
            },
            edits,
        );
    }
    if [
        "text-embedding-",
        "whisper-",
        "tts-",
        "omni-moderation-",
        "text-moderation-",
        "sora-",
    ]
    .iter()
    .any(|p| id.starts_with(p))
    {
        return (Unsupported, false);
    }
    (Text, false)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn discovery_uses_endpoint_or_output_authority_and_never_mistakes_image_input_for_output() {
        let key = Secret::new(b"local-test-secret-98765".to_vec()).unwrap();
        let known = Known::default();
        let rows = json!({"data":[
            {"id":"shared-alias","supported_endpoints":["/v1/images/generations","/v1/images/edits"]},
            {"id":"dall-e-3"},
            {"id":"gpt-image-1"},
            {"id":"arbitrary-image-discussion"},
            {"id":"sees-pictures","architecture":{"input_modalities":["text","image"],"output_modalities":["text"]}},
            {"id":"embeddings","supported_endpoints":["/v1/embeddings"]},
            {"id":"speech","output_modalities":["audio"]},
            {"id":"custom-art","output_modalities":["image"]},
            {"id":"gpt-image-2","supported_endpoints":["/v1/chat/completions"]},
            {"id":"vision","output_modalities":["text","image"]}
        ]});
        let got = validate_catalog(&rows, HttpProtocol::OpenaiChat, &key, &known).unwrap();
        let kinds: Vec<_> = got.iter().map(|r| r["capability"].as_str()).collect();
        assert_eq!(
            kinds,
            [
                "image",
                "image",
                "image",
                "text",
                "text",
                "unsupported",
                "unsupported",
                "image",
                "text",
                "unsupported"
            ]
            .map(Some)
        );
        assert_eq!(got[0]["supportsImageEdits"], true);
        assert_eq!(got[1]["supportsImageEdits"], false);
        assert_eq!(got[2]["supportsImageEdits"], true);
        assert_eq!(got[7]["supportsImageEdits"], false);
    }
}
