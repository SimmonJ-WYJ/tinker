//! 草稿只保留当前正文；receipt 用稳定摘要核对幂等与冲突，兼容旧完整request。
use super::protocol::PlatformRequest;
use crate::desktop_runtime::protocol::{DesktopError, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Receipt {
    pub request: PlatformRequest,
    pub revision: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    request_digest: Option<String>,
}
fn without_drafts(request: &PlatformRequest) -> PlatformRequest {
    let mut result = request.clone();
    if matches!(
        result.channel.as_str(),
        "settings:update" | "settings:update-sync"
    ) {
        if let Some(patch) = result.args.first_mut().and_then(Value::as_object_mut) {
            if let Some(drafts) = patch.get_mut("sessionDrafts") {
                *drafts = serde_json::json!({});
            }
        }
    }
    result
}
fn canonical(value: Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.into_iter().map(canonical).collect()),
        Value::Object(items) => {
            let mut pairs = items.into_iter().collect::<Vec<_>>();
            pairs.sort_by(|a, b| a.0.cmp(&b.0));
            Value::Object(
                pairs
                    .into_iter()
                    .map(|(key, value)| (key, canonical(value)))
                    .collect(),
            )
        }
        other => other,
    }
}
fn fingerprint(request: &PlatformRequest) -> Result<String> {
    let value =
        canonical(serde_json::to_value(request).map_err(|_| DesktopError("invalidParams"))?);
    let bytes = serde_json::to_vec(&value).map_err(|_| DesktopError("invalidParams"))?;
    let mut digest = Sha256::new();
    digest.update(b"tinker-formal-receipt-v1\n");
    digest.update(bytes);
    Ok(format!("{:x}", digest.finalize()))
}
impl Receipt {
    pub fn new(request: PlatformRequest, revision: u64) -> Result<Self> {
        let mut receipt = Self {
            request,
            revision,
            request_digest: None,
        };
        receipt.compact()?;
        Ok(receipt)
    }
    pub fn compact(&mut self) -> Result<()> {
        let stripped = without_drafts(&self.request);
        if self.request_digest.is_none() && stripped != self.request {
            self.request_digest = Some(fingerprint(&self.request)?);
            self.request = stripped;
        }
        Ok(())
    }
    pub fn matches(&self, request: &PlatformRequest) -> Result<bool> {
        match &self.request_digest {
            Some(digest) => {
                Ok(without_drafts(request) == self.request && fingerprint(request)? == *digest)
            }
            None => Ok(self.request == *request),
        }
    }
    pub fn validate(&self) -> Result<()> {
        if self.request_digest.as_ref().is_some_and(|digest| {
            digest.len() != 64
                || !digest
                    .bytes()
                    .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
                || without_drafts(&self.request) != self.request
        }) {
            return Err(DesktopError("corruptSnapshot"));
        }
        Ok(())
    }
}
