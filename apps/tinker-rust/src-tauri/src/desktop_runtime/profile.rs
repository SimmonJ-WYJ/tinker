//! 仅可信宿主初始化秘密配置，公开目录不包含端点或凭据。
use super::protocol::*;
use crate::{
    chat_http::{ChatHttpConfig, ChatHttpProvider},
    run_provider::RunProvider,
};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, sync::Arc};
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Model {
    pub model_id: String,
    pub label: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TrustedProfile {
    pub profile_id: String,
    pub label: String,
    pub config_revision: String,
    pub models: Vec<Model>,
    pub endpoint: String,
    pub key: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub profile_id: String,
    pub label: String,
    pub config_revision: String,
    pub models: Vec<Model>,
    #[serde(skip)]
    endpoint: String,
    #[serde(skip)]
    key: String,
}
impl Profile {
    pub fn from_trusted(p: TrustedProfile) -> Result<Self> {
        id(&p.profile_id)?;
        id(&p.config_revision)?;
        title(&p.label)?;
        if p.models.is_empty() || p.models.len() > 128 {
            return Err(DesktopError("invalidProfile"));
        }
        let url = reqwest::Url::parse(&p.endpoint).map_err(|_| DesktopError("invalidProfile"))?;
        if !url
            .host_str()
            .and_then(|s| s.trim_matches(['[', ']']).parse::<std::net::IpAddr>().ok())
            .is_some_and(|ip| ip.is_loopback())
        {
            return Err(DesktopError("invalidProfile"));
        }
        let mut seen = HashSet::new();
        for model in &p.models {
            model_id(&model.model_id)?;
            title(&model.label)?;
            if !seen.insert(&model.model_id) {
                return Err(DesktopError("invalidProfile"));
            }
            ChatHttpConfig::new(p.endpoint.clone(), p.key.clone(), model.model_id.clone())?;
        }
        Ok(Self {
            profile_id: p.profile_id,
            label: p.label,
            config_revision: p.config_revision,
            models: p.models,
            endpoint: p.endpoint,
            key: p.key,
        })
    }
    pub fn provider(&self, model: &str, effort: Option<&str>) -> Result<Arc<dyn RunProvider>> {
        if !self.models.iter().any(|m| m.model_id == model) {
            return Err(DesktopError("modelNotFound"));
        }
        if effort.is_some() {
            return Err(DesktopError("unsupportedEffort"));
        }
        Ok(Arc::new(ChatHttpProvider::new(ChatHttpConfig::new(
            self.endpoint.clone(),
            self.key.clone(),
            model.into(),
        )?)))
    }
}
