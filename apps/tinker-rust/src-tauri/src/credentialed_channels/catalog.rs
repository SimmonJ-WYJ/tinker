//! 严格目录协议与不可变连接版本；renderer没有网络授权。
use crate::{
    chat_http::HttpProtocol,
    desktop_runtime::{
        protocol::{DesktopError, Result},
        Model,
    },
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ModelCapability {
    #[default]
    Text,
    Image,
    Unsupported,
}
#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChannelModel {
    pub model_id: String,
    pub label: String,
    // 旧版本原样序列化，保持历史修订和已提交回执一致。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capability: Option<ModelCapability>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supports_image_edits: Option<bool>,
    #[serde(default)]
    pub supported_efforts: Vec<String>,
    #[serde(default = "model_enabled")]
    pub enabled: bool,
}
fn model_enabled() -> bool {
    true
}
impl ChannelModel {
    pub fn capability(&self, protocol: HttpProtocol) -> ModelCapability {
        match self.capability.unwrap_or_default() {
            ModelCapability::Image if protocol != HttpProtocol::OpenaiChat => {
                ModelCapability::Unsupported
            }
            capability => capability,
        }
    }
    fn can_edit_image(&self) -> bool {
        self.supports_image_edits == Some(true)
            && !matches!(self.model_id.as_str(), "dall-e-3" | "openai/dall-e-3")
    }
    pub fn selectable(&self) -> bool {
        self.enabled && self.capability != Some(ModelCapability::Unsupported)
    }
    pub fn runtime_model(&self) -> Model {
        Model {
            model_id: self.model_id.clone(),
            label: self.label.clone(),
            supported_efforts: self.supported_efforts.clone(),
        }
    }
}
#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChannelSpec {
    pub id: String,
    pub name: String,
    pub protocol: HttpProtocol,
    pub base_url: String,
    pub enabled: bool,
    pub models: Vec<ChannelModel>,
}
#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub enum CredentialChange {
    Keep,
    Replace(String),
}
#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChannelWrite {
    pub channel: ChannelSpec,
    pub credential: CredentialChange,
}
#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectionRevision {
    pub id: String,
    pub channel: ChannelSpec,
    pub credential_ref: String,
}
#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChannelRecord {
    pub current_revision: String,
    pub deleted: bool,
}
#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Catalog {
    pub version: u32,
    pub store_namespace: String,
    pub channels: BTreeMap<String, ChannelRecord>,
    pub revisions: BTreeMap<String, ConnectionRevision>,
}
#[derive(Clone)]
pub enum EndpointPolicy {
    Https,
    OwnedQa(OwnedQaEndpoint),
}
#[derive(Clone)]
pub struct OwnedQaEndpoint {
    bases: Vec<String>,
}
impl EndpointPolicy {
    /// listener必须是本宿主仍持有的QA服务；renderer不能构造此能力。
    pub fn owned_qa(listener: &std::net::TcpListener, path: &str) -> Result<Self> {
        let address = listener
            .local_addr()
            .map_err(|_| DesktopError("invalidEndpoint"))?;
        if !address.ip().is_loopback() || !matches!(path, "" | "/v1") {
            return Err(DesktopError("invalidEndpoint"));
        }
        Ok(Self::OwnedQa(OwnedQaEndpoint {
            bases: vec![format!("http://{address}{path}")],
        }))
    }
    #[cfg(any(test, feature = "formal-native-qa"))]
    pub fn combine_owned(&self, other: &Self) -> Result<Self> {
        match (self, other) {
            (Self::OwnedQa(a), Self::OwnedQa(b))
                if a.bases.len() == 1 && b.bases.len() == 1 && a.bases != b.bases =>
            {
                Ok(Self::OwnedQa(OwnedQaEndpoint {
                    bases: vec![a.bases[0].clone(), b.bases[0].clone()],
                }))
            }
            _ => Err(DesktopError("invalidEndpoint")),
        }
    }
    pub fn normalize(&self, base: &str) -> Result<String> {
        if base.len() > 2048 || base.chars().any(char::is_control) || base.trim() != base {
            return Err(DesktopError("invalidEndpoint"));
        }
        let u = reqwest::Url::parse(base).map_err(|_| DesktopError("invalidEndpoint"))?;
        if !u.username().is_empty()
            || u.password().is_some()
            || u.query().is_some()
            || u.fragment().is_some()
            || u.port() == Some(0)
            || u.host_str().is_none()
        {
            return Err(DesktopError("invalidEndpoint"));
        }
        let normalized = u.as_str().trim_end_matches('/').to_string();
        match self {
            Self::Https if u.scheme() == "https" => {
                if u.host_str()
                    .and_then(|h| h.trim_matches(['[', ']']).parse::<std::net::IpAddr>().ok())
                    .is_some_and(|ip| !public_address(ip))
                {
                    return Err(DesktopError("invalidEndpoint"));
                }
            }
            Self::OwnedQa(owned) if owned.bases.contains(&normalized) => {}
            _ => return Err(DesktopError("invalidEndpoint")),
        }
        Ok(normalized)
    }
}
pub fn public_address(ip: std::net::IpAddr) -> bool {
    use std::net::IpAddr;
    match ip {
        IpAddr::V4(v) => {
            let o = v.octets();
            !v.is_private()
                && !v.is_loopback()
                && !v.is_link_local()
                && !v.is_unspecified()
                && !v.is_multicast()
                && !v.is_broadcast()
                && !v.is_documentation()
                && o[0] != 0
                && o[0] < 224
                && !(o[0] == 100 && (64..128).contains(&o[1]))
                && !(o[0] == 192 && o[1] == 0 && o[2] == 0)
                && !(o[0] == 198 && (o[1] == 18 || o[1] == 19))
        }
        IpAddr::V6(v) => {
            if let Some(v4) = v.to_ipv4_mapped() {
                return public_address(IpAddr::V4(v4));
            }
            let s = v.segments();
            !v.is_unspecified()
                && !v.is_loopback()
                && !v.is_multicast()
                && (s[0] & 0xe000) == 0x2000
                && !(s[0] == 0x2001 && (s[1] == 0xdb8 || s[1] < 0x200))
                && s[0] != 0x2002
        }
    }
}
pub fn opaque_reference(value: &str) -> Result<()> {
    if value.len() != 32
        || !value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        Err(DesktopError("invalidCredentialReference"))
    } else {
        Ok(())
    }
}
pub fn random_reference() -> Result<String> {
    use std::io::Read;
    let mut bytes = [0u8; 16];
    std::fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut bytes))
        .map_err(|_| DesktopError("secureRandomUnavailable"))?;
    Ok(bytes.iter().map(|v| format!("{v:02x}")).collect())
}
impl ChannelSpec {
    pub fn normalize(mut self, policy: &EndpointPolicy) -> Result<Self> {
        crate::formal_platform::protocol::identifier(&self.id)?;
        if self.id == crate::desktop_runtime::UNCONFIGURED_PROFILE_ID
            || self.name.trim().is_empty()
            || self.name.len() > 256
            || self.name.chars().any(char::is_control)
            || self.models.is_empty()
            || self.models.len() > 128
        {
            return Err(DesktopError("invalidChannel"));
        }
        self.base_url = policy.normalize(&self.base_url)?;
        let mut ids = std::collections::BTreeSet::new();
        for model in &self.models {
            crate::desktop_runtime::protocol::model_id(&model.model_id)?;
            if model.label.trim().is_empty()
                || model.label.len() > 256
                || model.label.chars().any(char::is_control)
                || !ids.insert(&model.model_id)
            {
                return Err(DesktopError("invalidChannel"));
            }
            if model.capability == Some(ModelCapability::Image)
                && self.protocol != HttpProtocol::OpenaiChat
                || model.capability != Some(ModelCapability::Image)
                    && model.supports_image_edits.is_some()
                || model.capability(self.protocol) != ModelCapability::Text
                    && !model.supported_efforts.is_empty()
            {
                return Err(DesktopError("modelCapabilityMismatch"));
            }
            let mut efforts = std::collections::BTreeSet::new();
            if model.supported_efforts.iter().any(|e| {
                !self.protocol.allowed_efforts().contains(&e.as_str()) || !efforts.insert(e)
            }) {
                return Err(DesktopError("unsupportedEffort"));
            }
        }
        Ok(self)
    }
}
impl Catalog {
    pub fn empty(namespace: String) -> Result<Self> {
        opaque_reference(&namespace)?;
        Ok(Self {
            version: 1,
            store_namespace: namespace,
            channels: BTreeMap::new(),
            revisions: BTreeMap::new(),
        })
    }
    pub fn validate(&self, policy: &EndpointPolicy) -> Result<()> {
        if self.version != 1 {
            return Err(DesktopError("unsupportedVersion"));
        }
        opaque_reference(&self.store_namespace)?;
        if self.revisions.len() > 128
            || self.channels.len() > 128
            || self.channels.values().filter(|v| !v.deleted).count() > 16
        {
            return Err(DesktopError("storageLimit"));
        }
        for (id, revision) in &self.revisions {
            crate::formal_platform::protocol::identifier(id)?;
            opaque_reference(&revision.credential_ref)?;
            if revision.id != *id
                || revision.channel.clone().normalize(policy)? != revision.channel
                || !self.channels.contains_key(&revision.channel.id)
            {
                return Err(DesktopError("corruptCatalog"));
            }
        }
        for (id, record) in &self.channels {
            if self
                .revisions
                .get(&record.current_revision)
                .is_none_or(|r| r.channel.id != *id)
            {
                return Err(DesktopError("corruptCatalog"));
            }
        }
        Ok(())
    }
    pub fn apply(
        &mut self,
        channel: &str,
        args: &[serde_json::Value],
        mutation_id: &str,
        policy: &EndpointPolicy,
    ) -> Result<()> {
        crate::formal_platform::protocol::identifier(mutation_id)?;
        if mutation_id.len() > 96 || args.len() != 1 {
            return Err(DesktopError("invalidParams"));
        }
        if channel == "channel:delete" {
            let id = args[0].as_str().ok_or(DesktopError("invalidParams"))?;
            let record = self
                .channels
                .get_mut(id)
                .filter(|c| !c.deleted)
                .ok_or(DesktopError("channelNotFound"))?;
            record.deleted = true;
            return Ok(());
        }
        if !matches!(channel, "channel:create" | "channel:update") {
            return Err(DesktopError("unsupported"));
        }
        let mut write: ChannelWrite =
            serde_json::from_value(args[0].clone()).map_err(|_| DesktopError("invalidParams"))?;
        write.channel = write.channel.normalize(policy)?;
        let old = self.channels.get(&write.channel.id);
        if (channel == "channel:create" && old.is_some())
            || (channel == "channel:update" && old.is_none_or(|c| c.deleted))
        {
            return Err(DesktopError("channelConflict"));
        }
        if self.revisions.len() >= 128
            || (old.is_none() && self.channels.values().filter(|v| !v.deleted).count() >= 16)
        {
            return Err(DesktopError("storageLimit"));
        }
        let reference = match write.credential {
            CredentialChange::Replace(reference) => {
                opaque_reference(&reference)?;
                reference
            }
            CredentialChange::Keep => {
                let old = old
                    .and_then(|r| self.revisions.get(&r.current_revision))
                    .ok_or(DesktopError("credentialRequired"))?;
                if old.channel.protocol != write.channel.protocol
                    || old.channel.base_url != write.channel.base_url
                {
                    return Err(DesktopError("credentialReplacementRequired"));
                }
                old.credential_ref.clone()
            }
        };
        let revision_id = format!("revision-{mutation_id}");
        if self.revisions.contains_key(&revision_id) {
            return Err(DesktopError("revisionConflict"));
        }
        self.channels.insert(
            write.channel.id.clone(),
            ChannelRecord {
                current_revision: revision_id.clone(),
                deleted: false,
            },
        );
        self.revisions.insert(
            revision_id.clone(),
            ConnectionRevision {
                id: revision_id,
                channel: write.channel,
                credential_ref: reference,
            },
        );
        Ok(())
    }
    pub fn current(&self) -> impl Iterator<Item = &ConnectionRevision> {
        self.channels
            .values()
            .filter(|r| !r.deleted)
            .filter_map(|r| self.revisions.get(&r.current_revision))
    }
    pub fn image_revision(
        &self,
        channel: &str,
        model: &str,
        is_edit: bool,
    ) -> Result<&ConnectionRevision> {
        let revision = self
            .current()
            .find(|r| r.channel.id == channel && r.channel.enabled)
            .ok_or(DesktopError("sourceChannelUnavailable"))?;
        let selected = revision
            .channel
            .models
            .iter()
            .find(|m| m.model_id == model && m.enabled)
            .ok_or(DesktopError("sourceChannelUnavailable"))?;
        if selected.capability(revision.channel.protocol) != ModelCapability::Image
            || is_edit && !selected.can_edit_image()
        {
            return Err(DesktopError("modelCapabilityMismatch"));
        }
        Ok(revision)
    }
    pub fn public_list(&self) -> serde_json::Value {
        use serde_json::json;
        serde_json::Value::Array(self.current().map(|r| {
            let channel = &r.channel;
            let provider = match channel.protocol {
                HttpProtocol::OpenaiChat => "custom-openai",
                HttpProtocol::AnthropicMessages => "custom-anthropic",
            };
            let models: Vec<_> = channel.models.iter().map(|m| {
                let mut row = json!({"id":m.model_id,"name":m.label,"enabled":m.enabled,
                    "supportedEfforts":m.supported_efforts,"capability":m.capability(channel.protocol)});
                if m.supports_image_edits.is_some() { row["supportsImageEdits"] = json!(m.can_edit_image()); }
                row
            }).collect();
            json!({"id":channel.id,"name":channel.name,"provider":provider,"baseUrl":channel.base_url,
                "enabled":channel.enabled,"hasCredential":true,"apiKey":"","models":models})
        }).collect())
    }
}
