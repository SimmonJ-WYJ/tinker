//! 新目录事实源的归约和恢复；历史回执只包含已归一化的非秘密引用。
use super::*;
fn profiles(catalog: &Catalog) -> Vec<PublicProfile> {
    catalog
        .current()
        .map(|r| PublicProfile {
            profile_id: r.channel.id.clone(),
            label: r.channel.name.clone(),
            endpoint: r.channel.base_url.clone(),
            protocol: r.channel.protocol,
            models: r.channel.models.iter().map(|m| m.runtime_model()).collect(),
        })
        .collect()
}
pub(super) fn validate_request(r: &PlatformRequest) -> Result<()> {
    if matches!(
        r.channel.as_str(),
        "channel:create" | "channel:update" | "channel:delete"
    ) {
        if r.version != VERSION
            || r.args.len() != 1
            || serde_json::to_vec(r)
                .map_err(|_| DesktopError("invalidParams"))?
                .len()
                > MAX_REQUEST_BYTES
        {
            return Err(DesktopError("invalidParams"));
        }
        let m = r.mutation.as_ref().ok_or(DesktopError("invalidParams"))?;
        identifier(&m.mutation_id)?;
        if m.expected_revision >= MAX_SAFE_INTEGER {
            return Err(DesktopError("invalidParams"));
        }
        if r.channel == "channel:delete" {
            identifier(r.args[0].as_str().ok_or(DesktopError("invalidParams"))?)?;
        } else {
            let _: ChannelWrite = decode(r.args[0].clone())?;
        }
        Ok(())
    } else {
        super::super::validate_request(r).map(|_| ())
    }
}
fn selection_valid(s: &settings::Settings, c: &Catalog) -> bool {
    let active: Vec<_> = c
        .current()
        .filter(|r| r.channel.enabled && r.channel.models.iter().any(|m| m.selectable()))
        .collect();
    s.agent_channel_ids
        .iter()
        .all(|id| active.iter().any(|r| &r.channel.id == id))
        && (s.agent_channel_id.is_empty()
            || active.iter().any(|r| {
                r.channel.id == s.agent_channel_id
                    && r.channel
                        .models
                        .iter()
                        .any(|m| m.selectable() && m.model_id == s.agent_model_id)
            }))
}
fn reconcile(s: &mut settings::Settings, c: &Catalog) {
    let active: Vec<_> = c
        .current()
        .filter(|r| r.channel.enabled && r.channel.models.iter().any(|m| m.selectable()))
        .collect();
    s.agent_channel_ids = active.iter().map(|r| r.channel.id.clone()).collect();
    let selected = active
        .iter()
        .find(|r| r.channel.id == s.agent_channel_id)
        .or_else(|| active.first());
    if let Some(r) = selected {
        s.agent_channel_id = r.channel.id.clone();
        let model = r
            .channel
            .models
            .iter()
            .find(|m| m.selectable() && m.model_id == s.agent_model_id)
            .or_else(|| r.channel.models.iter().find(|m| m.selectable()))
            .expect("已筛选启用模型");
        s.agent_model_id = model.model_id.clone();
        if !model.supported_efforts.contains(&s.agent_effort) {
            s.agent_effort.clear();
        }
    } else {
        s.agent_channel_id.clear();
        s.agent_model_id.clear();
        s.agent_effort.clear();
    }
}
pub(super) fn apply(
    state: &mut Persisted,
    r: &PlatformRequest,
    policy: &EndpointPolicy,
) -> Result<()> {
    if matches!(
        r.channel.as_str(),
        "channel:create" | "channel:update" | "channel:delete"
    ) {
        let c = state
            .credential_catalog
            .as_mut()
            .ok_or(DesktopError("corruptCatalog"))?;
        c.apply(
            &r.channel,
            &r.args,
            &r.mutation
                .as_ref()
                .ok_or(DesktopError("invalidParams"))?
                .mutation_id,
            policy,
        )?;
        reconcile(&mut state.settings, c);
        state.workspaces[0].effort = state.settings.agent_effort.clone();
        return Ok(());
    }
    let c = state
        .credential_catalog
        .as_ref()
        .ok_or(DesktopError("corruptCatalog"))?;
    let p = profiles(c);
    if matches!(
        r.channel.as_str(),
        "settings:update" | "settings:update-sync"
    ) {
        if r.args.len() != 1
            || r.args[0].get("onboardingSpotlight").is_some()
            || r.args[0].get("conceptSpotlight").is_some()
        {
            return Err(DesktopError("invalidParams"));
        }
        let mut settings: settings::Settings = patch(&state.settings, &r.args[0])?;
        // 切换模型时，旧模型的专属档位不应使本次选模失败。
        if (settings.agent_channel_id != state.settings.agent_channel_id
            || settings.agent_model_id != state.settings.agent_model_id)
            && r.args[0].get("agentEffort").is_none()
        {
            if let Some(model) = c
                .current()
                .find(|r| r.channel.id == settings.agent_channel_id)
                .and_then(|r| {
                    r.channel
                        .models
                        .iter()
                        .find(|m| m.model_id == settings.agent_model_id)
                })
            {
                if !model.supported_efforts.contains(&settings.agent_effort) {
                    settings.agent_effort.clear();
                }
            }
        }
        settings.validate_managed_workspaces(&p, &state.workspaces)?;
        if !selection_valid(&settings, c) {
            return Err(DesktopError("invalidParams"));
        }
        state.workspaces[0].effort = settings.agent_effort.clone();
        state.settings = settings;
        return Ok(());
    }
    if r.channel == "agent:set-reasoning-effort" {
        let slug = state.workspace(&r.args, 2)?.workspace.slug.clone();
        let effort = r.args[1].as_str().ok_or(DesktopError("invalidParams"))?;
        let mut settings = state.settings.clone();
        settings.agent_effort = effort.into();
        settings.validate_managed_workspaces(&p, &state.workspaces)?;
        let record = state
            .workspaces
            .iter_mut()
            .find(|r| r.workspace.slug == slug)
            .ok_or(DesktopError("workspaceNotFound"))?;
        record.effort = effort.into();
        if slug == workspace::DEFAULT_WORKSPACE_SLUG {
            state.settings = settings;
        }
        return Ok(());
    }
    state.apply(r, &p)
}
pub(super) fn validate(s: &Persisted, policy: &EndpointPolicy) -> Result<()> {
    let c = s
        .credential_catalog
        .as_ref()
        .ok_or(DesktopError("corruptCatalog"))?;
    c.validate(policy)?;
    if s.version != VERSION
        || s.channel_overlay.is_some()
        || s.revision > MAX_SAFE_INTEGER
        || (s.workspaces.is_empty() || s.workspaces.len() > project_catalog::MAX_PROJECTS + 1)
        || s.receipts.len() > MAX_RECEIPTS
        || s.revision != s.receipts.len() as u64
    {
        return Err(DesktopError("corruptSnapshot"));
    }
    project_catalog::validate_catalog(&s.workspaces, true)?;
    s.settings
        .validate_managed_workspaces(&profiles(c), &s.workspaces)?;
    validate_user(&s.user_profile)?;
    s.workspaces[0].validate_managed()?;
    if s.workspaces[0].effort != s.settings.agent_effort {
        return Err(DesktopError("corruptSnapshot"));
    }
    if !selection_valid(&s.settings, c) {
        return Err(DesktopError("corruptSnapshot"));
    }
    let mut ordered: Vec<_> = s.receipts.iter().collect();
    ordered.sort_by_key(|(_, r)| r.revision);
    let mut replay = Persisted::initial(&[]);
    replay.workspaces.extend_from_slice(&s.workspaces[1..]);
    replay.workspaces[0].effort.clear();
    replay.credential_catalog = Some(Catalog::empty(c.store_namespace.clone())?);
    for (index, (id, r)) in ordered.into_iter().enumerate() {
        r.validate()?;
        validate_request(&r.request)?;
        if r.revision != index as u64 + 1
            || r.request
                .mutation
                .as_ref()
                .is_none_or(|m| m.mutation_id != *id || m.expected_revision + 1 != r.revision)
        {
            return Err(DesktopError("corruptSnapshot"));
        }
        apply(&mut replay, &r.request, policy)?;
    }
    if replay.credential_catalog != s.credential_catalog {
        return Err(DesktopError("corruptCatalog"));
    }
    Ok(())
}
pub(super) fn reply(
    s: &Persisted,
    env: &HostEnvironment,
    r: &PlatformRequest,
) -> Result<PlatformReply> {
    let snapshot = s.snapshot(env);
    let value = match r.channel.as_str() {
        "channel:create" | "channel:update" => {
            let write: ChannelWrite = decode(r.args[0].clone())?;
            s.credential_catalog
                .as_ref()
                .ok_or(DesktopError("corruptCatalog"))?
                .public_list()
                .as_array()
                .and_then(|a| a.iter().find(|c| c["id"] == write.channel.id).cloned())
                .unwrap_or(Value::Null)
        }
        "channel:delete" => json!(true),
        "agent:get-reasoning-effort" => {
            let preference = &s.workspace(&r.args, 1)?.effort;
            let catalog = s
                .credential_catalog
                .as_ref()
                .ok_or(DesktopError("corruptCatalog"))?;
            let supported = catalog
                .current()
                .find(|r| r.channel.id == s.settings.agent_channel_id)
                .and_then(|r| {
                    r.channel
                        .models
                        .iter()
                        .find(|m| m.model_id == s.settings.agent_model_id)
                })
                .is_some_and(|m| m.supported_efforts.contains(preference));
            json!(if supported { preference.as_str() } else { "" })
        }
        _ => s.value(r, &snapshot)?,
    };
    Ok(PlatformReply {
        version: VERSION,
        revision: s.revision,
        value,
        snapshot: r.mutation.is_some().then_some(snapshot),
    })
}
