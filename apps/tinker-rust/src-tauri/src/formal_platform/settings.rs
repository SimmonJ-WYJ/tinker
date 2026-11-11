//! 原UI所需偏好白名单；不接受凭据、端点、文件路径或工具配置。
use super::{
    launch::PublicProfile,
    protocol::*,
    spotlight::{ConceptState, OnboardingState},
    workspace::DEFAULT_WORKSPACE_ID,
};
use crate::desktop_runtime::protocol::{DesktopError, Result};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Tab {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub session_id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TabState {
    pub tabs: Vec<Tab>,
    pub active_tab_id: Option<String>,
    #[serde(default)]
    pub active_tab_id_by_workspace: BTreeMap<String, String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TelemetryConsent {
    pub posthog_enabled: bool,
    pub agent_evolution_enabled: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NotificationSounds {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_complete: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permission_request: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit_plan_mode: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub theme: String,
    pub language: String,
    pub agent_channel_id: String,
    pub agent_channel_ids: Vec<String>,
    pub agent_model_id: String,
    pub agent_workspace_id: String,
    pub agent_effort: String,
    pub agent_permission_mode: String,
    pub notifications_enabled: bool,
    pub notification_sound_enabled: bool,
    pub notification_sounds: NotificationSounds,
    pub send_with_cmd_enter: bool,
    pub archive_after_days: u32,
    pub tab_state: TabState,
    pub sidebar_project_files_expanded_by_workspace: BTreeMap<String, bool>,
    pub telemetry_consent: TelemetryConsent,
    pub telemetry_dev_force_send: bool,
    pub onboarding_spotlight: OnboardingState,
    pub concept_spotlight: ConceptState,
}
impl Settings {
    pub(crate) fn initial(profiles: &[PublicProfile]) -> Self {
        let profile = &profiles[0];
        Self {
            theme: "system".into(),
            language: "en".into(),
            agent_channel_id: profile.profile_id.clone(),
            agent_channel_ids: profiles.iter().map(|p| p.profile_id.clone()).collect(),
            agent_model_id: profile.models[0].model_id.clone(),
            agent_workspace_id: DEFAULT_WORKSPACE_ID.into(),
            agent_effort: "high".into(),
            agent_permission_mode: "acceptEdits".into(),
            notifications_enabled: true,
            notification_sound_enabled: false,
            notification_sounds: NotificationSounds {
                task_complete: None,
                permission_request: None,
                exit_plan_mode: None,
            },
            send_with_cmd_enter: false,
            archive_after_days: 7,
            tab_state: TabState::default(),
            sidebar_project_files_expanded_by_workspace: BTreeMap::new(),
            telemetry_consent: TelemetryConsent {
                posthog_enabled: false,
                agent_evolution_enabled: false,
            },
            telemetry_dev_force_send: false,
            onboarding_spotlight: OnboardingState::initial(),
            concept_spotlight: ConceptState::default(),
        }
    }
    pub(crate) fn validate(&self, profiles: &[PublicProfile]) -> Result<()> {
        let invalid = || DesktopError("invalidParams");
        if !["system", "light", "dark"].contains(&self.theme.as_str())
            || !["en", "zh"].contains(&self.language.as_str())
            || self.agent_workspace_id != DEFAULT_WORKSPACE_ID
            || self.agent_permission_mode != "acceptEdits"
            || self.archive_after_days > 365
            || self.telemetry_consent.posthog_enabled
            || self.telemetry_consent.agent_evolution_enabled
            || self.telemetry_dev_force_send
        {
            return Err(invalid());
        }
        let profile = profiles
            .iter()
            .find(|p| p.profile_id == self.agent_channel_id)
            .ok_or(DesktopError("profileNotFound"))?;
        let model = profile
            .models
            .iter()
            .find(|m| m.model_id == self.agent_model_id)
            .ok_or(DesktopError("modelNotFound"))?;
        if !model.supported_efforts.contains(&self.agent_effort) {
            return Err(DesktopError("unsupportedEffort"));
        }
        if self.agent_channel_ids.is_empty()
            || self.agent_channel_ids.len() > profiles.len()
            || self.agent_channel_ids.iter().collect::<HashSet<_>>().len()
                != self.agent_channel_ids.len()
            || self
                .agent_channel_ids
                .iter()
                .any(|id| !profiles.iter().any(|p| p.profile_id == *id))
            || !self.agent_channel_ids.contains(&self.agent_channel_id)
        {
            return Err(invalid());
        }
        for sound in [
            &self.notification_sounds.task_complete,
            &self.notification_sounds.permission_request,
            &self.notification_sounds.exit_plan_mode,
        ]
        .into_iter()
        .flatten()
        {
            if ![
                "ding",
                "ding-dong",
                "discord",
                "done",
                "down-power",
                "food",
                "lite",
                "quiet",
                "none",
            ]
            .contains(&sound.as_str())
            {
                return Err(invalid());
            }
        }
        let tabs = &self.tab_state;
        if tabs.tabs.len() > 128
            || tabs.active_tab_id_by_workspace.len() > 1
            || self
                .sidebar_project_files_expanded_by_workspace
                .keys()
                .any(|k| k != DEFAULT_WORKSPACE_ID)
        {
            return Err(invalid());
        }
        let mut seen = HashSet::new();
        for t in &tabs.tabs {
            identifier(&t.id)?;
            identifier(&t.session_id)?;
            if t.kind != "agent"
                || t.title.len() > 1024
                || t.workspace_id
                    .as_ref()
                    .is_some_and(|s| s != DEFAULT_WORKSPACE_ID)
                || !seen.insert(&t.id)
            {
                return Err(invalid());
            }
        }
        if tabs
            .active_tab_id
            .as_ref()
            .is_some_and(|id| !seen.contains(id))
        {
            return Err(invalid());
        }
        // 原 UI 关闭标签后仍保留工作区记忆；仅当前激活标签必须存在。
        for (workspace, id) in &tabs.active_tab_id_by_workspace {
            if workspace != DEFAULT_WORKSPACE_ID {
                return Err(invalid());
            }
            identifier(id)?;
        }
        self.onboarding_spotlight.validate()?;
        self.concept_spotlight.validate()?;
        Ok(())
    }
}
