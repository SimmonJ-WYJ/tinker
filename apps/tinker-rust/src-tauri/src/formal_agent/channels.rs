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
                "agent:permission:respond"
                    | "agent:create-workspace"
                    | "agent:update-workspace"
                    | "agent:create-session"
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
        if self.credentialed.is_some() && c == "channel:decrypt-key" {
            return Err(DesktopError("unsupported"));
        }
        if c == "agent:send-message"
            && args
                .first()
                .is_some_and(|v| v.get("retryOfRequestId").is_some())
        {
            if !self.native_task_lifecycle() || mutation.is_some() {
                return Err(DesktopError("unsupported"));
            }
            arity(&args, 1, 1)?;
            let retry = crate::desktop_runtime::protocol::decode(args[0].clone())?;
            return self.retry_task(retry, reply);
        }
        let image_send = c == "agent:send-message"
            && mutation.is_none()
            && args
                .first()
                .is_some_and(|v| v.get("nativeImageAction").is_some());
        if !image_send && self.needs_credential_work(c, mutation.is_some()) {
            return self.start_credential_work(c, args, mutation, reply);
        }
        if mutation.is_some() {
            let result = self
                .platform
                .invoke(PlatformRequest {
                    version: 1,
                    channel: c.into(),
                    args,
                    mutation,
                })
                .and_then(|r| {
                    if c == "channel:update"
                        && self
                            .runtime
                            .set_availability(self.platform.availability()?)
                            .is_err()
                    {
                        self.runtime.freeze_availability();
                        return Err(DesktopError("recoveryRequired"));
                    }
                    serde_json::to_value(r)
                        .map(Some)
                        .map_err(|_| DesktopError("invalidReply"))
                });
            if c == "channel:update"
                && result.as_ref().is_err_and(|e| {
                    matches!(
                        e.0,
                        "storeIo"
                            | "recoveryRequired"
                            | "storeChanged"
                            | "unsafePath"
                            | "invalidRoot"
                    )
                })
            {
                self.runtime.freeze_availability();
            }
            return result;
        }
        let value = match c {
            "agent:read-image-thumbnail" if self.images.is_some() => {
                return self.queue_thumbnail(&args, reply);
            }
            "agent:read-image-range" if self.images.is_some() => self.read_image_range(&args)?,
            "chat:read-attachment"
            | "agent:list-directory"
            | "agent:stat-file"
            | "agent:preview-read-binary"
            | "agent:preview-read-text"
                if self.images.is_some() =>
            {
                self.image_file(c, &args)?
            }

            "channel:list" => {
                arity(&args, 0, 0)?;
                self.platform.channels()?
            }
            "channel:decrypt-key"
            | "channel:test"
            | "channel:test-direct"
            | "channel:fetch-models" => return self.channel_discovery(c, &args, reply),
            "agent:search-messages" => {
                arity(&args, 1, 1)?;
                return self.start_search(
                    args[0].as_str().ok_or(DesktopError("invalidParams"))?,
                    reply,
                );
            }
            "agent:update-workspace" if self.synthetic_projects() => {
                arity(&args, 2, 2)?;
                let id = string(&args, 0)?;
                let patch = args[1]
                    .as_object()
                    .filter(|p| p.len() == 1)
                    .ok_or(DesktopError("invalidParams"))?;
                let name = patch
                    .get("name")
                    .and_then(Value::as_str)
                    .ok_or(DesktopError("invalidParams"))?;
                json!(self.platform.project_platform()?.rename_project(id, name)?)
            }
            "agent:create-workspace" if self.synthetic_projects() => {
                arity(&args, 1, 2)?;
                let name = string(&args, 0)?;
                let from = optional(&args, 1)?;
                json!(self
                    .platform
                    .project_platform()?
                    .create_project(name, from.as_deref())?)
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
                        .unwrap_or(if self.credentialed.is_some() {
                            crate::desktop_runtime::UNCONFIGURED_PROFILE_ID
                        } else {
                            ""
                        })
                        .into()
                });
                let workspace = optional(&args, offset + 1)?;
                self.workspace(workspace.as_deref())?;
                let mut s=self.core("sessions.create",json!({"title":title,"profileId":profile,"workspaceId":workspace,"reuseDraft":draft}))?;
                if draft && self.images.is_some() {
                    s = self.reusable_image_aware_draft(s, &profile, workspace.as_deref())?;
                }
                projection::session(&s)
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
                self.finish_image_before_delete(sid);
                self.reserve_deleted_delivery(sid)?;
                self.delete_queue(sid)?;
                self.stop(sid, None)?;
                self.poll();
                self.core("sessions.delete", json!({"sessionId":sid}))?;
                if let Some(search) = &mut self.search {
                    search.forget(sid);
                }
                // tombstone 后不再读 session；保留有界终态计划直到背压解除。
                if let Some(entry) = self.entries.get_mut(sid) {
                    // 已删正文不可再访问；只保存精确身份，用空 snapshot 清理此 run。
                    entry.turn = json!({"sessionId":entry.turn["sessionId"],"requestId":entry.turn["requestId"],"runId":entry.turn["runId"],"startedAt":entry.turn["startedAt"],"sequence":entry.turn["sequence"],"status":entry.turn["status"]});
                    entry.deleted_history = Some(json!({"messages":[],"sdkMessages":[]}));
                    entry.resync = true;
                }
                self.barriers.remove(sid);
                self.terminal_receipts.remove(sid);
                self.permission_owners.retain(|_, (owner, _)| owner != sid);
                Value::Null
            }
            "agent:send-message" => {
                arity(&args, 1, 1)?;
                return self.send(args[0].clone(), reply);
            }
            "agent:stop" => {
                arity(&args, 1, 2)?;
                let expected = if args.len() == 2 {
                    Some(string(&args, 1)?)
                } else {
                    None
                };
                self.stop(string(&args, 0)?, expected)?;
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
            "agent:permission:respond" => {
                arity(&args, 1, 1)?;
                self.permission_response(args[0].clone())?
            }
            "agent:get-pending-requests" => {
                arity(&args, 0, 1)?;
                self.pending_requests(optional(&args, 0)?.as_deref())?
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
    pub(super) fn sessions(&self) -> Result<Vec<Value>> {
        self.core("sessions.list", json!({}))?["sessions"]
            .as_array()
            .cloned()
            .ok_or(DesktopError("invalidReply"))
    }
    pub(super) fn session(&self, sid: &str) -> Result<Value> {
        self.sessions()?
            .into_iter()
            .find(|s| s["sessionId"] == sid)
            .ok_or(DesktopError("sessionNotFound"))
    }
    fn workspace(&self, id: Option<&str>) -> Result<()> {
        if let Some(id) = id {
            self.platform
                .require_workspace(crate::formal_platform::workspace::WorkspaceKey::Id(id))?;
        }
        Ok(())
    }
    fn workspace_slug(&self, slug: &str) -> Result<()> {
        self.platform
            .require_workspace(crate::formal_platform::workspace::WorkspaceKey::Slug(slug))
    }
    fn retry_task(
        &mut self,
        retry: crate::desktop_runtime::TextRetry,
        reply: &Reply,
    ) -> Result<Option<Value>> {
        if !self.gate.allows_send() {
            return Err(DesktopError("closing"));
        }
        let sid = &retry.session_id;
        self.session(sid)?;
        let images = self.images.as_ref().ok_or(DesktopError("unsupported"))?;
        if images.contains_request(sid, &retry.retry_of_request_id)? {
            let source =
                images
                    .store
                    .retry_source(sid, &retry.retry_of_request_id, &retry.request_id)?;
            if !images.contains_request(sid, &retry.request_id)?
                && self.latest_retryable_task(sid)?.as_deref() != Some(&source.request_id)
            {
                return Err(DesktopError("requestConflict"));
            }
            let mut input = json!({"userMessage":source.prompt,"nativeImageAction": if source.base_image_id.is_some() {"edit"} else {"generate"}});
            if let Some(base) = source.base_image_id {
                input["imageEditReferenceId"] = json!(base);
            }
            return self.send_image(
                &input,
                sid,
                &retry.request_id,
                retry.started_at,
                Some(&retry.retry_of_request_id),
                reply,
            );
        }
        let source = retry.retry_of_request_id.clone();
        let (send, is_new) = self.runtime.resolve_text_retry(retry)?;
        if is_new.is_some()
            && self.latest_retryable_task(&send.session_id)?.as_deref() != Some(&source)
        {
            return Err(DesktopError("requestConflict"));
        }
        let mut input = json!({"sessionId":send.session_id, "requestId":send.request_id, "startedAt":send.started_at,
            "userMessage":send.user_message, "channelId":send.profile_id, "modelId":send.model_id});
        if let Some(effort) = send.effort {
            input["effort"] = json!(effort);
        }
        if is_new.is_some() && self.credentialed.as_ref().is_some_and(|c| !c.bypass) {
            // The worker only prepares credentials. Re-enter with the original retry command
            // so the actor rechecks the source revision and latest turn before binding.
            let identity = json!({"sessionId":send.session_id, "requestId":send.request_id,
                "startedAt":send.started_at,"retryOfRequestId":source});
            return self.prepare_credential_invoke(
                "agent:send-message",
                vec![identity],
                None,
                reply,
                Some(input),
            );
        }
        self.send(input, reply)
    }
    fn stop(&mut self, sid: &str, expected: Option<&str>) -> Result<()> {
        self.session(sid)?;
        if let Some(id) = expected {
            crate::desktop_runtime::protocol::id(id)?;
        }
        self.cancel_credential_send(sid, expected);
        self.stop_session_image(sid, expected)?;
        if let Some(e) = self
            .entries
            .get(sid)
            .filter(|e| expected.is_none_or(|id| e.turn["requestId"] == id))
        {
            let request = e.turn["requestId"].clone();
            self.core("chat.cancel", json!({"sessionId":sid,"requestId":request}))?;
        }
        Ok(())
    }
    pub(super) fn send(&mut self, input: Value, reply: &Reply) -> Result<Option<Value>> {
        self.gate.expire();
        if !self.gate.allows_send() {
            return Err(DesktopError("closing"));
        }
        let object = input.as_object().ok_or(DesktopError("invalidParams"))?;
        for (key, value) in object {
            match key.as_str() {
                "sessionId" | "userMessage" | "channelId" | "modelId" | "workspaceId"
                | "startedAt" | "requestId" | "taskMode" | "effort" => {}
                "nativeImageAction" | "imageEditReferenceId" if self.images.is_some() => {}
                "nativeImageReferenceInferred"
                    if self.credentialed.is_some()
                        && input["nativeImageAction"] == "edit"
                        && value == true => {}
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
        if input.get("nativeImageAction").is_some() {
            return self.send_image(&input, sid, &request, started, None, reply);
        }
        if input.get("imageEditReferenceId").is_some() {
            return Err(DesktopError("unsupported"));
        }
        let effort = input
            .get("effort")
            .filter(|v| !(self.credentialed.is_some() && v.as_str() == Some("")))
            .cloned()
            .unwrap_or(Value::Null);
        if self.queueing {
            return self.begin_queue(json!({"sessionId":sid,"requestId":request,"startedAt":started,"profileId":input["channelId"],"modelId":input["modelId"],"userMessage":text,"effort":effort}));
        }
        let mut superseded = self.runtime.superseded_request(sid, &request)?;
        if let Some(images) = &self.images {
            if images.contains_request(sid, &request)? {
                return Err(DesktopError("requestConflict"));
            }
            let text = self.runtime.latest_text_task(sid)?;
            let already_bound =
                superseded || text.as_ref().is_some_and(|t| t.request_id == request);
            if !already_bound && self.image_busy(sid) {
                return Err(DesktopError("runBusy"));
            }
            if !already_bound && images.has_delivery(sid) {
                return Err(DesktopError("hostBusy"));
            }
            if already_bound {
                if let Some(image) = images.store.latest_task(sid)? {
                    superseded |= self
                        .runtime
                        .image_follows_text(sid, text.as_ref(), &image)?
                        || self.image_busy(sid)
                        || images.has_delivery(sid);
                }
            }
        }
        let existing = self.entries.get(sid);
        if !superseded
            && existing
                .is_some_and(|e| projection::active(&e.turn) && e.turn["requestId"] != request)
        {
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
        let turn=self.core("chat.send",json!({"sessionId":sid,"requestId":request,"startedAt":started,"profileId":input["channelId"],"modelId":input["modelId"],"userMessage":text,"effort":effort}))?;

        if superseded {
            // 旧请求的回执不能替换后续任务的流投递条目。
            return if matches!(turn["status"].as_str(), Some("failed" | "interrupted")) {
                Err(DesktopError(projection::turn_error(&turn)))
            } else {
                Ok(Some(json!({"value":null})))
            };
        }
        if let Some(e) = self.entries.get_mut(sid) {
            if e.turn["requestId"] == request {
                e.waiters.push(reply.clone());
                e.settled = false;
                return Ok(None);
            }
        }
        let user =
            projection::text_task_history(std::slice::from_ref(&turn))["sdkMessages"][0].clone();
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
                sdk_index: 1,
                deleted_history: None,
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
