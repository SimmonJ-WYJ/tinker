//! 工具能力只能由宿主绑定；v2 门面保留完整有界类型状态。
use super::{
    execution::project_turn,
    profile::Profile,
    protocol::*,
    session::{Binding, Turn},
    Inner,
};
use crate::{
    chat_http::HttpProtocol, run_controller::RunController, run_types::RunError,
    tool_journal::ToolRunSnapshot, tool_types::*,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{collections::BTreeMap, sync::Arc};
pub struct TrustedToolBinding {
    pub profile_id: String,
    pub executor: Arc<dyn ToolExecutor>,
    pub options: ToolRunOptions,
}
pub(super) fn validate_bindings(
    profiles: &mut BTreeMap<String, Profile>,
    bindings: Vec<TrustedToolBinding>,
) -> Result<BTreeMap<String, TrustedToolBinding>> {
    let mut result = BTreeMap::new();
    for b in bindings {
        let p = profiles
            .get_mut(&b.profile_id)
            .ok_or(DesktopError("invalidProfile"))?;
        ToolRunOptions::new(
            b.options.workspace_revision.clone(),
            b.options.permission_timeout,
            b.options.run_timeout,
        )?;
        if p.protocol != HttpProtocol::OpenaiChat
            || b.executor.workspace_revision() != b.options.workspace_revision
            || result.contains_key(&b.profile_id)
        {
            return Err(DesktopError("invalidProfile"));
        }
        p.config_revision = format!("{}-tools-v1", p.config_revision);
        id(&p.config_revision)?;
        result.insert(b.profile_id.clone(), b);
    }
    Ok(result)
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Pending {
    #[serde(deserialize_with = "nullable")]
    session_id: Option<String>,
}
fn nullable<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> std::result::Result<Option<String>, D::Error> {
    Option::deserialize(d)
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Respond {
    session_id: String,
    run_id: String,
    permission_id: String,
    behavior: Behavior,
    always_allow: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum Behavior {
    Allow,
    Deny,
}
pub(super) fn project_tool_turn(b: &Binding, t: &ToolRunSnapshot) -> Turn {
    let mut turn = project_turn(b, None);
    turn.assistant_message = t.output.clone();
    turn.status = t.status;
    turn.sequence = t.sequence;
    turn.error_code = t.error_code.clone();
    turn
}
impl Inner {
    pub(super) fn turn_reply(&self, b: &Binding) -> Result<Value> {
        let mut turn = self.turn_v2(b)?;
        if turn["toolState"].is_null() {
            turn.as_object_mut()
                .ok_or(DesktopError("invalidReply"))?
                .remove("toolState");
        }
        bounded(turn)
    }
    pub(super) fn turn_v2(&self, b: &Binding) -> Result<Value> {
        let c = self
            .controllers
            .get(&b.request.session_id)
            .ok_or(DesktopError("sessionNotFound"))?;
        match c.read_tools(&b.request.request_id, 0, 1) {
            Ok(page) => {
                let mut v = json!(project_tool_turn(b, &page.snapshot));
                v["toolState"] = json!(page.snapshot);
                Ok(v)
            }
            Err(
                RunError::UnsupportedVersion | RunError::RunNotFound | RunError::ToolUnsupported,
            ) => {
                let mut v = json!(self.turn(b)?);
                v["toolState"] = Value::Null;
                Ok(v)
            }
            Err(e) => Err(e.into()),
        }
    }
    pub(super) fn cancel_run(
        &self,
        c: &RunController,
        run: &str,
    ) -> std::result::Result<(), RunError> {
        match c.cancel(run) {
            Err(RunError::UnsupportedVersion) => c.cancel_tools(run).map(|_| ()),
            result => result.map(|_| ()),
        }
    }
    pub(super) fn pending_permissions(&self, p: Pending) -> Result<Value> {
        if let Some(sid) = &p.session_id {
            self.session(sid)?;
        }
        let mut permissions = Vec::new();
        for (sid, bindings) in &self.bindings {
            if self.sessions[sid].deleted || p.session_id.as_ref().is_some_and(|s| s != sid) {
                continue;
            }
            for b in bindings {
                let t = self.turn_v2(b)?;
                if !t["toolState"]["pending"].is_null() {
                    permissions.push(t["toolState"]["pending"].clone());
                }
            }
        }
        bounded(json!({"permissions":permissions}))
    }
    pub(super) fn respond_permission(&self, p: Respond) -> Result<Value> {
        if p.always_allow {
            return Err(DesktopError("unsupported"));
        }
        self.binding(&p.session_id, &p.run_id)?;
        let c = self
            .controllers
            .get(&p.session_id)
            .ok_or(DesktopError("sessionNotFound"))?;
        Ok(json!(c.respond_permission(
            &p.run_id,
            PermissionReply {
                permission_id: p.permission_id,
                decision: match p.behavior {
                    Behavior::Allow => PermissionDecision::Granted,
                    Behavior::Deny => PermissionDecision::Denied,
                }
            }
        )?))
    }
    pub(super) fn events_v2(&self, p: Events) -> Result<Value> {
        let b = self.binding(&p.session_id, &p.request_id)?;
        if p.limit == 0 || p.limit > 256 {
            return Err(DesktopError("invalidLimit"));
        }
        let c = self
            .controllers
            .get(&p.session_id)
            .ok_or(DesktopError("sessionNotFound"))?;
        let page = match c.read_tools(&p.request_id, p.after_sequence, p.limit) {
            Ok(page) => page,
            Err(
                RunError::UnsupportedVersion | RunError::RunNotFound | RunError::ToolUnsupported,
            ) => {
                let mut page = self.events(p)?;
                page["turn"]["toolState"] = Value::Null;
                return bounded(page);
            }
            Err(e) => return Err(e.into()),
        };
        let mut turn = json!(project_tool_turn(b, &page.snapshot));
        turn["toolState"] = json!(page.snapshot);
        let mut out = json!({"turn":turn,"events":[],"nextAfterSequence":p.after_sequence,"hasMore":p.after_sequence<page.snapshot.sequence});
        bounded(out.clone())?;
        for event in page.events {
            let previous = out.clone();
            out["events"]
                .as_array_mut()
                .ok_or(DesktopError("invalidReply"))?
                .push(json!(event));
            out["nextAfterSequence"] = json!(event.sequence);
            out["hasMore"] = json!(event.sequence < page.snapshot.sequence);
            if bounded(out.clone()).is_err() {
                out = previous;
                break;
            }
        }
        if out["events"].as_array().is_some_and(Vec::is_empty)
            && p.after_sequence < page.snapshot.sequence
        {
            return Err(DesktopError("pageLimit"));
        }
        Ok(out)
    }
}
fn bounded(v: Value) -> Result<Value> {
    if serde_json::to_vec(&v)
        .map_err(|_| DesktopError("invalidReply"))?
        .len()
        > MAX_PAGE_BYTES
    {
        Err(DesktopError("pageLimit"))
    } else {
        Ok(v)
    }
}
