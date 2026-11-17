//! 受信任连接上的非秘密元数据；renderer 不获得连接写入权限。
use super::{launch::PublicProfile, protocol::*, settings::Settings, MOCK_KEY};
use crate::{
    chat_http::HttpProtocol,
    desktop_runtime::{
        availability::Availability,
        protocol::{DesktopError, Result},
    },
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub(crate) struct ModelMetadata {
    pub id: String,
    pub name: String,
    pub enabled: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub(crate) struct ChannelMetadata {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub models: Vec<ModelMetadata>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub(crate) struct Overlay {
    version: u32,
    channels: Vec<ChannelMetadata>,
}
fn invalid() -> DesktopError {
    DesktopError("invalidParams")
}
fn name(s: &str) -> Result<()> {
    if s.trim().is_empty() || s.len() > 256 || s.chars().any(char::is_control) {
        Err(invalid())
    } else {
        Ok(())
    }
}
pub(crate) fn provider(p: &PublicProfile) -> &'static str {
    if p.protocol == HttpProtocol::AnthropicMessages {
        "custom-anthropic"
    } else {
        "custom-openai"
    }
}
pub(crate) fn base_url(p: &PublicProfile) -> String {
    p.endpoint
        .strip_suffix("/chat/completions")
        .unwrap_or(&p.endpoint)
        .to_string()
}
fn capabilities() -> Value {
    json!({"supportsPdfDocumentBlock":true,"imageProtocol":"openai-images","imageQualityPriority":0,"imageMaxReferences":4})
}
impl Overlay {
    pub fn initial(profiles: &[PublicProfile]) -> Self {
        Self {
            version: 1,
            channels: profiles
                .iter()
                .map(|p| ChannelMetadata {
                    id: p.profile_id.clone(),
                    name: p.label.clone(),
                    enabled: true,
                    models: p
                        .models
                        .iter()
                        .map(|m| ModelMetadata {
                            id: m.model_id.clone(),
                            name: m.label.clone(),
                            enabled: true,
                        })
                        .collect(),
                })
                .collect(),
        }
    }
    pub fn validate(&self, profiles: &[PublicProfile]) -> Result<()> {
        if self.version != 1 || self.channels.len() != profiles.len() {
            return Err(invalid());
        }
        let mut seen = BTreeSet::new();
        for c in &self.channels {
            let p = profiles
                .iter()
                .find(|p| p.profile_id == c.id)
                .ok_or_else(invalid)?;
            name(&c.name)?;
            if !seen.insert(&c.id) || c.models.len() > p.models.len() {
                return Err(invalid());
            }
            let mut models = BTreeSet::new();
            for m in &c.models {
                name(&m.name)?;
                if !models.insert(&m.id) || !p.models.iter().any(|k| k.model_id == m.id) {
                    return Err(invalid());
                }
            }
        }
        Ok(())
    }
    pub fn update(&mut self, args: &[Value], profiles: &[PublicProfile]) -> Result<()> {
        if args.len() != 2 {
            return Err(invalid());
        }
        let id = args[0].as_str().ok_or_else(invalid)?;
        let c = self
            .channels
            .iter_mut()
            .find(|c| c.id == id)
            .ok_or(DesktopError("profileNotFound"))?;
        let mut v = encoded(c)?;
        let patch = args[1]
            .as_object()
            .filter(|p| !p.is_empty())
            .ok_or_else(invalid)?;
        for (k, x) in patch {
            if !["name", "enabled", "models"].contains(&k.as_str()) || x.is_null() {
                return Err(invalid());
            }
            v[k] = x.clone();
        }
        *c = decode(v)?;
        self.validate(profiles)
    }
    pub fn channel(&self, id: &str, profiles: &[PublicProfile]) -> Result<Value> {
        let c = self
            .channels
            .iter()
            .find(|c| c.id == id)
            .ok_or(DesktopError("profileNotFound"))?;
        let p = profiles
            .iter()
            .find(|p| p.profile_id == id)
            .ok_or(DesktopError("profileNotFound"))?;
        Ok(
            json!({"id":c.id,"name":c.name,"enabled":c.enabled,"models":c.models,"provider":provider(p),"baseUrl":base_url(p),"apiKey":"","createdAt":0,"updatedAt":0,"capabilities":capabilities()}),
        )
    }
    pub fn list(&self, profiles: &[PublicProfile]) -> Result<Value> {
        self.channels
            .iter()
            .map(|c| self.channel(&c.id, profiles))
            .collect::<Result<Vec<_>>>()
            .map(Value::Array)
    }
    pub fn availability(&self) -> Availability {
        self.channels
            .iter()
            .map(|c| {
                (
                    c.id.clone(),
                    c.models
                        .iter()
                        .filter(|m| c.enabled && m.enabled)
                        .map(|m| m.id.clone())
                        .collect(),
                )
            })
            .collect()
    }
    pub fn selection_valid(&self, s: &Settings) -> bool {
        s.agent_channel_id.is_empty() && s.agent_model_id.is_empty()
            || self.channels.iter().any(|c| {
                c.id == s.agent_channel_id
                    && c.enabled
                    && c.models
                        .iter()
                        .any(|m| m.enabled && m.id == s.agent_model_id)
            })
    }
    pub fn reconcile(&self, s: &mut Settings) {
        s.agent_channel_ids
            .retain(|id| self.channels.iter().any(|c| c.id == *id && c.enabled));
        if self.selection_valid(s) {
            return;
        }
        let picked = self
            .channels
            .iter()
            .find(|c| c.id == s.agent_channel_id && c.enabled)
            .and_then(|c| {
                c.models
                    .iter()
                    .find(|m| m.enabled)
                    .map(|m| (c.id.clone(), m.id.clone()))
            });
        let (c, m) = picked.unwrap_or_default();
        s.agent_channel_id = c;
        s.agent_model_id = m;
    }
}
pub(crate) fn normalize(r: &mut PlatformRequest, profiles: &[PublicProfile]) -> Result<()> {
    if r.channel != "channel:update" {
        return Ok(());
    }
    if r.args.len() != 2 {
        return Err(invalid());
    }
    let id = r.args[0].as_str().ok_or_else(invalid)?;
    let p = profiles
        .iter()
        .find(|p| p.profile_id == id)
        .ok_or(DesktopError("profileNotFound"))?;
    let patch = r.args[1].as_object_mut().ok_or_else(invalid)?;
    for (key, value) in patch.iter() {
        let ok = match key.as_str() {
            "name" | "enabled" | "models" => true,
            "provider" => *value == provider(p),
            "baseUrl" => *value == base_url(p),
            "apiKey" => value == "" || value == MOCK_KEY,
            "capabilities" => value
                .as_object()
                .is_some_and(|o| o.iter().all(|(k, v)| capabilities().get(k) == Some(v))),
            _ => false,
        };
        if !ok {
            return Err(invalid());
        }
    }
    for k in ["provider", "baseUrl", "apiKey", "capabilities"] {
        patch.remove(k);
    }
    if patch.is_empty() {
        return Err(invalid());
    }
    Ok(())
}
