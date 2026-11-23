//! 原UI所需偏好白名单；不接受凭据、端点、文件路径或工具配置。
use super::{
    launch::PublicProfile,
    protocol::*,
    spotlight::{ConceptState, OnboardingState},
    workspace::{WorkspaceRecord, DEFAULT_WORKSPACE_ID},
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
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub session_drafts: BTreeMap<String, String>,
    pub sidebar_project_files_expanded_by_workspace: BTreeMap<String, bool>,
    pub telemetry_consent: TelemetryConsent,
    pub telemetry_dev_force_send: bool,
    pub onboarding_spotlight: OnboardingState,
    pub concept_spotlight: ConceptState,
}
impl Settings {
    pub(crate) fn initial(profiles: &[PublicProfile]) -> Self {
        let profile = profiles.first();
        Self {
            theme: "system".into(),
            language: "en".into(),
            agent_channel_id: profile.map(|p| p.profile_id.clone()).unwrap_or_default(),
            agent_channel_ids: profiles.iter().map(|p| p.profile_id.clone()).collect(),
            agent_model_id: profile
                .and_then(|p| p.models.first())
                .map(|m| m.model_id.clone())
                .unwrap_or_default(),
            agent_workspace_id: DEFAULT_WORKSPACE_ID.into(),
            agent_effort: if profiles.is_empty() {
                String::new()
            } else {
                "high".into()
            },
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
            session_drafts: BTreeMap::new(),
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
    pub(crate) fn validate(
        &self,
        profiles: &[PublicProfile],
        workspaces: &[WorkspaceRecord],
    ) -> Result<()> {
        self.validate_inner(profiles, false, |id| {
            workspaces.iter().any(|w| w.workspace.id == id)
        })
    }
    pub(crate) fn validate_managed_workspaces(
        &self,
        profiles: &[PublicProfile],
        records: &[WorkspaceRecord],
    ) -> Result<()> {
        self.validate_inner(profiles, true, |id| {
            records.iter().any(|r| r.workspace.id == id)
        })
    }
    fn validate_inner(
        &self,
        profiles: &[PublicProfile],
        managed: bool,
        knows_workspace: impl Fn(&str) -> bool,
    ) -> Result<()> {
        let invalid = || DesktopError("invalidParams");
        if managed && !["", "low", "medium", "high", "max"].contains(&self.agent_effort.as_str()) {
            return Err(DesktopError("unsupportedEffort"));
        }
        if !["system", "light", "dark"].contains(&self.theme.as_str())
            || !["en", "zh"].contains(&self.language.as_str())
            || !knows_workspace(&self.agent_workspace_id)
            || self.agent_permission_mode != "acceptEdits"
            || self.archive_after_days > 365
            || self.telemetry_consent.posthog_enabled
            || self.telemetry_consent.agent_evolution_enabled
            || self.telemetry_dev_force_send
        {
            return Err(invalid());
        }
        if self.agent_channel_id.is_empty() != self.agent_model_id.is_empty() {
            return Err(invalid());
        }
        let no_effort = managed && self.agent_effort.is_empty();
        let known_effort = profiles
            .iter()
            .flat_map(|p| &p.models)
            .any(|m| m.supported_efforts.contains(&self.agent_effort));
        if self.agent_channel_id.is_empty() && !profiles.is_empty() && !(no_effort || known_effort)
        {
            return Err(DesktopError("unsupportedEffort"));
        }
        if !self.agent_channel_id.is_empty() {
            let profile = profiles
                .iter()
                .find(|p| p.profile_id == self.agent_channel_id)
                .ok_or(DesktopError("profileNotFound"))?;
            let model = profile
                .models
                .iter()
                .find(|m| m.model_id == self.agent_model_id)
                .ok_or(DesktopError("modelNotFound"))?;
            if !(no_effort || model.supported_efforts.contains(&self.agent_effort)) {
                return Err(DesktopError("unsupportedEffort"));
            }
        }
        if self.agent_channel_ids.len() > profiles.len()
            || self.agent_channel_ids.iter().collect::<HashSet<_>>().len()
                != self.agent_channel_ids.len()
            || self
                .agent_channel_ids
                .iter()
                .any(|id| !profiles.iter().any(|p| p.profile_id == *id))
            || (!self.agent_channel_id.is_empty()
                && !self.agent_channel_ids.contains(&self.agent_channel_id))
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
        // 草稿限128会话、完整JSON合计64KiB；超限拒绝整个patch，不截断内容。
        if self.session_drafts.len() > 128
            || serde_json::to_vec(&self.session_drafts)
                .map_err(|_| invalid())?
                .len()
                > 64 * 1024
        {
            return Err(invalid());
        }
        for id in self.session_drafts.keys() {
            identifier(id)?;
        }
        let tabs = &self.tab_state;
        if tabs.tabs.len() > 128
            || self
                .sidebar_project_files_expanded_by_workspace
                .keys()
                .any(|k| !knows_workspace(k))
        {
            return Err(invalid());
        }
        let mut seen = HashSet::new();
        for t in &tabs.tabs {
            identifier(&t.id)?;
            identifier(&t.session_id)?;
            if t.kind != "agent"
                || t.title.len() > 1024
                || t.workspace_id.as_ref().is_some_and(|s| !knows_workspace(s))
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
            if !knows_workspace(workspace) {
                return Err(invalid());
            }
            identifier(id)?;
        }
        self.onboarding_spotlight.validate()?;
        self.concept_spotlight.validate()?;
        Ok(())
    }
}

#[cfg(test)]
mod credentialed_empty_tests {
    use super::*;
    #[test]
    fn empty_catalog_settings_do_not_invent_a_provider() {
        let settings = Settings::initial(&[]);
        assert!(settings.agent_channel_id.is_empty());
        assert!(settings.agent_model_id.is_empty());
        assert!(settings.agent_channel_ids.is_empty());
        assert!(settings
            .validate(&[], &[WorkspaceRecord::initial()])
            .is_ok());
    }
}

#[cfg(test)]
mod project_settings_tests {
    use super::super::project_catalog::ProjectCatalog;
    use super::*;
    use crate::{
        electron_import::SourceProject,
        formal_platform::{local_mock_profiles, FormalPlatform, HostEnvironment, TrustedRoot},
    };
    use serde_json::{json, Value};

    fn update(platform: &FormalPlatform, channel: &str, patch: Value) -> Result<()> {
        let revision = platform.bootstrap()?.revision;
        platform.invoke(PlatformRequest {
            version: VERSION,
            channel: channel.into(),
            args: vec![patch],
            mutation: Some(Mutation {
                mutation_id: format!("prefs-{revision}"),
                expected_revision: revision,
            }),
        })?;
        Ok(())
    }

    #[test]
    fn project_settings_accept_catalogued_ids_and_keep_global_tabs() {
        let base = std::env::temp_dir().canonicalize().unwrap();
        let tag = crate::credentialed_channels::catalog::random_reference().unwrap();
        let path = base.join(format!("tinker-tauri-formal-preview-test-prefs-{tag}"));
        let root = TrustedRoot::create_temporary(path.clone()).unwrap();
        let profiles = local_mock_profiles("http://127.0.0.1:23456/v1/chat/completions").unwrap();
        let open = || {
            FormalPlatform::open(
                &root,
                &profiles,
                HostEnvironment::new("darwin", false, false).unwrap(),
            )
            .unwrap()
        };
        let platform = open();
        let native = platform.create_project("Same name", None).unwrap();
        let src = SourceProject {
            source_project_id: "project-a".into(),
            name: "Same name".into(),
            created_at: 1,
            updated_at: 2,
            has_directory_hint: false,
        };
        let catalog = platform
            .import_projects(&[src], &["project-a".into()].into())
            .unwrap();
        let a = catalog.ids["project-a"].as_str();
        let b = native.id.as_str();
        let tabs = json!({
            "tabs": [
                {"id":"a","sessionId":"sa","title":"One","type":"agent","workspaceId":a},
                {"id":"b","sessionId":"sb","title":"Two","type":"agent","workspaceId":b},
                {"id":"g","sessionId":"sg","title":"Global","type":"agent"}
            ],
            "activeTabId":"b","activeTabIdByWorkspace":{(a):"a",(b):"b"}
        });
        update(
            &platform,
            "settings:update",
            json!({"agentWorkspaceId":b,"tabState":tabs}),
        )
        .unwrap();
        update(
            &platform,
            "settings:update-sync",
            json!({"sidebarProjectFilesExpandedByWorkspace":{(a):false,(b):true}}),
        )
        .unwrap();
        let before = platform.bootstrap().unwrap();
        drop(platform);
        let platform = open();
        let restored = platform.bootstrap().unwrap();
        assert_eq!(restored.revision, before.revision);
        assert_eq!(restored.settings, before.settings);
        assert_eq!(restored.settings.tab_state.tabs[2].workspace_id, None);
        assert_eq!(restored.settings.agent_workspace_id, b);
        assert!(restored
            .settings
            .validate_managed_workspaces(&platform.profiles, &[WorkspaceRecord::initial()])
            .is_err());
        for patch in [
            json!({"agentWorkspaceId":"other"}),
            json!({"sidebarProjectFilesExpandedByWorkspace":{"other":true}}),
            json!({"tabState":{"tabs":[],"activeTabId":null,"activeTabIdByWorkspace":{"other":"remembered-tab"}}}),
            json!({"tabState":{"tabs":[{"id":"x","sessionId":"sx","type":"agent","title":"","workspaceId":"other"}],"activeTabId":"x"}}),
        ] {
            assert!(update(&platform, "settings:update", patch).is_err());
            assert_eq!(platform.bootstrap().unwrap().settings, restored.settings);
        }
        drop(platform);
        std::fs::remove_dir_all(path).unwrap();
    }
}
