//! 原正式preload的固定allowlist与参数适配；未迁移能力明确拒绝。
use super::{
    actor::{Actor, Entry},
    projection, Reply,
};
use crate::{
    desktop_runtime::protocol::{DesktopError, Result},
    formal_platform::{protocol::Mutation, PlatformRequest},
};
use serde_json::{json, Value};
use std::{
    fs,
    time::{SystemTime, UNIX_EPOCH},
};
impl Actor {
    pub fn invoke(
        &mut self,
        c: &str,
        args: Vec<Value>,
        mutation: Option<Mutation>,
        reply: &Reply,
    ) -> Result<Option<Value>> {
        if self.draining {
            return Err(DesktopError("closing"));
        }
        self.gate.expire();
        if !self.gate.allows_send()
            && (matches!(
                c,
                "agent:create-session"
                    | "agent:get-or-create-draft-session"
                    | "agent:update-title"
                    | "agent:delete-session"
                    | "agent:toggle-pin"
                    | "agent:toggle-archive"
            ) || (mutation.is_some()
                && !matches!(c, "settings:update" | "settings:update-sync")))
        {
            return Err(DesktopError("closing"));
        }
        if mutation.is_some() {
            return self
                .platform
                .invoke(PlatformRequest {
                    version: 1,
                    channel: c.into(),
                    args,
                    mutation,
                })
                .and_then(|r| {
                    serde_json::to_value(r)
                        .map(Some)
                        .map_err(|_| DesktopError("invalidReply"))
                });
        }
        let value = match c {
            "channel:list" => {
                arity(&args, 0, 0)?;
                let p = self.core("profiles.list", json!({}))?;
                let profiles = p["profiles"]
                    .as_array()
                    .ok_or(DesktopError("invalidReply"))?;
                let mut channels = Vec::new();
                for profile in profiles {
                    let models = profile["models"]
                        .as_array()
                        .ok_or(DesktopError("invalidReply"))?;
                    let provider = if profile["protocol"] == "anthropic-messages" {
                        "custom-anthropic"
                    } else {
                        "custom-openai"
                    };
                    channels.push(json!({
                        "id": profile["profileId"], "name": profile["label"], "provider": provider,
                        "baseUrl": "", "apiKey": "", "enabled": true, "createdAt": 0, "updatedAt": 0,
                        "models": models.iter().map(|m| json!({"id":m["modelId"],"name":m["label"],"enabled":true})).collect::<Vec<_>>()
                    }));
                }
                json!(channels)
            }
            "agent:list-sessions" => {
                arity(&args, 0, 0)?;
                json!(self
                    .sessions()?
                    .iter()
                    .map(projection::session)
                    .collect::<Vec<_>>())
            }
            "agent:create-session" | "agent:get-or-create-draft-session" => {
                let draft = c == "agent:get-or-create-draft-session";
                arity(&args, 0, if draft { 2 } else { 3 })?;
                let offset = usize::from(!draft);
                let title = if draft {
                    String::new()
                } else {
                    optional(&args, 0)?.unwrap_or_default()
                };
                let profiles = self.core("profiles.list", json!({}))?;
                let profile = optional(&args, offset)?.unwrap_or_else(|| {
                    profiles["profiles"][0]["profileId"]
                        .as_str()
                        .unwrap_or_default()
                        .into()
                });
                let workspace = optional(&args, offset + 1)?;
                self.workspace(workspace.as_deref())?;
                projection::session(&self.core("sessions.create",json!({"title":title,"profileId":profile,"workspaceId":workspace,"reuseDraft":draft}))?)
            }
            "agent:get-messages" => {
                arity(&args, 1, 1)?;
                self.history(string(&args, 0)?)?["messages"].clone()
            }
            "agent:get-sdk-messages" => return Err(DesktopError("restoreRequired")),
            "agent:update-title" => {
                arity(&args, 2, 2)?;
                projection::session(&self.core(
                    "sessions.update",
                    json!({"sessionId":string(&args,0)?,"title":string(&args,1)?}),
                )?)
            }
            "agent:toggle-pin" | "agent:toggle-archive" => {
                arity(&args, 1, 1)?;
                let sid = string(&args, 0)?;
                let s = self.session(sid)?;
                let (field, other) = if c == "agent:toggle-pin" {
                    ("pinned", "archived")
                } else {
                    ("archived", "pinned")
                };
                let on = s[field] != true;
                let mut p = json!({"sessionId":sid});
                p[field] = json!(on);
                if on {
                    p[other] = json!(false);
                }
                projection::session(&self.core("sessions.update", p)?)
            }
            "agent:delete-session" => {
                arity(&args, 1, 1)?;
                let sid = string(&args, 0)?;
                self.stop(sid)?;
                self.poll();
                self.core("sessions.delete", json!({"sessionId":sid}))?;
                self.entries.remove(sid);
                self.barriers.remove(sid);
                self.terminal_receipts.remove(sid);
                Value::Null
            }
            "agent:send-message" => {
                arity(&args, 1, 1)?;
                return self.send(args[0].clone(), reply);
            }
            "agent:stop" => {
                arity(&args, 1, 1)?;
                self.stop(string(&args, 0)?)?;
                Value::Null
            }
            "agent:get-session-path" => {
                arity(&args, 1, 2)?;
                let sid = string(&args, args.len() - 1)?;
                let session = self.session(sid)?;
                if args.len() == 2 {
                    let workspace = optional(&args, 0)?;
                    self.workspace(workspace.as_deref())?;
                    if session["workspaceId"].as_str() != workspace.as_deref() {
                        return Err(DesktopError("workspaceMismatch"));
                    }
                }
                self.root.validate()?;
                let parent = self.root.path().join("deliverables");
                let path = parent.join(sid);
                for p in [&parent, &path] {
                    match fs::create_dir(p) {
                        Ok(()) => {
                            #[cfg(unix)]
                            {
                                use std::os::unix::fs::PermissionsExt;
                                fs::set_permissions(p, fs::Permissions::from_mode(0o700))
                                    .map_err(|_| DesktopError("storeIo"))?;
                            }
                        }
                        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
                        Err(_) => return Err(DesktopError("storeIo")),
                    }
                    let meta = fs::symlink_metadata(p).map_err(|_| DesktopError("invalidPath"))?;
                    if !meta.is_dir()
                        || meta.file_type().is_symlink()
                        || fs::canonicalize(p).map_err(|_| DesktopError("invalidPath"))? != *p
                    {
                        return Err(DesktopError("invalidPath"));
                    }
                }
                json!(path)
            }
            "agent:get-pending-requests" => {
                arity(&args, 0, 1)?;
                if !args.is_empty() {
                    self.session(string(&args, 0)?)?;
                }
                json!({"permissions":[],"askUsers":[],"exitPlans":[]})
            }
            "agent:get-capabilities" => {
                arity(&args, 0, 1)?;
                if !args.is_empty() {
                    self.workspace_slug(string(&args, 0)?)?;
                }
                json!({"mcpServers":[],"skills":[]})
            }
            "agent:get-skills" => {
                arity(&args, 0, 1)?;
                if !args.is_empty() {
                    self.workspace_slug(string(&args, 0)?)?;
                }
                json!([])
            }
            "agent:get-mcp-config" => {
                arity(&args, 0, 0)?;
                json!({"mcpServers":{}})
            }
            "agent:get-team-data" => {
                arity(&args, 0, 1)?;
                if !args.is_empty() {
                    self.session(string(&args, 0)?)?;
                }
                Value::Null
            }
            _ => {
                return self
                    .platform
                    .invoke(PlatformRequest {
                        version: 1,
                        channel: c.into(),
                        args,
                        mutation: None,
                    })
                    .and_then(|r| {
                        serde_json::to_value(r)
                            .map(Some)
                            .map_err(|_| DesktopError("invalidReply"))
                    })
            }
        };
        Ok(Some(json!({"value":value})))
    }
    fn sessions(&self) -> Result<Vec<Value>> {
        self.core("sessions.list", json!({}))?["sessions"]
            .as_array()
            .cloned()
            .ok_or(DesktopError("invalidReply"))
    }
    fn session(&self, sid: &str) -> Result<Value> {
        self.sessions()?
            .into_iter()
            .find(|s| s["sessionId"] == sid)
            .ok_or(DesktopError("sessionNotFound"))
    }
    fn workspace(&self, id: Option<&str>) -> Result<()> {
        if let Some(id) = id {
            if !self
                .platform
                .bootstrap()?
                .workspaces
                .iter()
                .any(|w| w.id == id)
            {
                return Err(DesktopError("workspaceNotFound"));
            }
        }
        Ok(())
    }
    fn workspace_slug(&self, slug: &str) -> Result<()> {
        if !self
            .platform
            .bootstrap()?
            .workspaces
            .iter()
            .any(|w| w.slug == slug)
        {
            return Err(DesktopError("workspaceNotFound"));
        }
        Ok(())
    }
    fn stop(&mut self, sid: &str) -> Result<()> {
        self.session(sid)?;
        if let Some(e) = self.entries.get(sid) {
            let request = e.turn["requestId"].clone();
            self.core("chat.cancel", json!({"sessionId":sid,"requestId":request}))?;
        }
        Ok(())
    }
    fn send(&mut self, input: Value, reply: &Reply) -> Result<Option<Value>> {
        self.gate.expire();
        if !self.gate.allows_send() {
            return Err(DesktopError("closing"));
        }
        let object = input.as_object().ok_or(DesktopError("invalidParams"))?;
        for (key, value) in object {
            match key.as_str() {
                "sessionId" | "userMessage" | "channelId" | "modelId" | "workspaceId"
                | "startedAt" | "requestId" | "taskMode" | "effort" => {}
                "additionalDirectories"
                | "mentionedSkills"
                | "mentionedMcpServers"
                | "mentionedZoteroItems"
                | "mentionedZoteroCollections"
                | "zoteroAttachments"
                | "mentionedEvidenceSets"
                    if value.as_array().is_some_and(Vec::is_empty) => {}
                _ => return Err(DesktopError("unsupported")),
            }
        }
        for key in ["sessionId", "userMessage", "channelId", "modelId"] {
            if !input[key].is_string() {
                return Err(DesktopError("invalidParams"));
            }
        }
        for key in ["workspaceId", "requestId", "taskMode", "effort"] {
            if object.contains_key(key) && !input[key].is_string() {
                return Err(DesktopError("invalidParams"));
            }
        }
        if object.contains_key("startedAt") && !input["startedAt"].is_u64() {
            return Err(DesktopError("invalidTime"));
        }
        let sid = input["sessionId"]
            .as_str()
            .ok_or(DesktopError("invalidParams"))?;
        let text = input["userMessage"]
            .as_str()
            .ok_or(DesktopError("invalidParams"))?;
        if input["taskMode"].as_str().is_some_and(|v| v != "search")
            || text.contains("<attached_files>")
            || text.contains("<referenced_directory")
            || text
                .split_whitespace()
                .any(|w| w.starts_with("@file:") || w.starts_with("@dir:"))
        {
            return Err(DesktopError("unsupported"));
        }
        let session = self.session(sid)?;
        if let Some(w) = input["workspaceId"].as_str() {
            self.workspace(Some(w))?;
            if session["workspaceId"] != w {
                return Err(DesktopError("workspaceMismatch"));
            }
        }
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| DesktopError("invalidTime"))?
            .as_millis() as u64;
        let started = input["startedAt"].as_u64().unwrap_or(now);
        self.token_seq += 1;
        let request = input["requestId"]
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| {
                if object.contains_key("startedAt") {
                    format!("legacy-{sid}-{started}")
                } else {
                    format!("native-{now}-{}", self.token_seq)
                }
            });
        let existing = self.entries.get(sid);
        if existing.is_some_and(|e| projection::active(&e.turn) && e.turn["requestId"] != request) {
            return Err(DesktopError("runBusy"));
        }
        if self
            .entries
            .values()
            .map(|e| e.waiters.len())
            .sum::<usize>()
            >= 256
        {
            return Err(DesktopError("hostBusy"));
        }
        let turn=self.core("chat.send",json!({"sessionId":sid,"requestId":request,"startedAt":started,"profileId":input["channelId"],"modelId":input["modelId"],"userMessage":text,"effort":input.get("effort").cloned().unwrap_or(Value::Null)}))?;

        if let Some(e) = self.entries.get_mut(sid) {
            if e.turn["requestId"] == request {
                e.waiters.push(reply.clone());
                e.settled = false;
                return Ok(None);
            }
        }
        let user = projection::history(std::slice::from_ref(&turn))["sdkMessages"][0].clone();
        self.emit(
            "agent:stream:event",
            projection::stream(&turn, json!({"kind":"sdk_message","message":user})),
        );
        self.entries.insert(
            sid.into(),
            Entry {
                turn,
                cursor: 0,
                resync: !self.attached,
                waiters: vec![reply.clone()],
                settled: false,
                terminal_stage: Default::default(),
                terminal_error: None,
            },
        );
        Ok(None)
    }
}
fn arity(args: &[Value], min: usize, max: usize) -> Result<()> {
    if args.len() < min || args.len() > max {
        Err(DesktopError("invalidParams"))
    } else {
        Ok(())
    }
}
fn string(args: &[Value], i: usize) -> Result<&str> {
    args.get(i)
        .and_then(Value::as_str)
        .ok_or(DesktopError("invalidParams"))
}
fn optional(args: &[Value], i: usize) -> Result<Option<String>> {
    match args.get(i) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.clone())),
        _ => Err(DesktopError("invalidParams")),
    }
}
