#[cfg(test)]
use crate::formal_platform::FormalPlatform;
// 单actor串行协调generation、平台revision、执行归属与关闭阶段。
use super::{
    projection,
    protocol::{Command, EventEnvelope},
    Message, Reply, RESTORE_TIMEOUT,
};
use crate::{
    desktop_runtime::{
        protocol::{DesktopError, Result},
        DesktopRuntime,
    },
    formal_platform::{
        close::{CloseGate, CloseTicket},
        TrustedRoot,
    },
};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    sync::{
        mpsc::{Receiver, RecvTimeoutError, SyncSender},
        Arc,
    },
    time::{Duration, Instant},
};
pub(super) const MAX_FORMAL_REPLY: usize = 16 * 1024 * 1024;
#[derive(Default, PartialEq)]
pub(super) enum TerminalStage {
    #[default]
    SdkMessage,
    Error,
    Complete,
}
pub(super) struct Entry {
    pub turn: Value,
    pub cursor: u64,
    pub resync: bool,
    pub waiters: Vec<Reply>,
    pub settled: bool,
    // 只保存下一条未入队终态，不因outbox背压重置已成功投递的阶段。
    pub terminal_stage: TerminalStage,
    pub terminal_error: Option<DesktopError>,
    pub sdk_index: usize,
    pub deleted_history: Option<Value>,
}
pub(super) struct TerminalReceipt {
    pub turn: Value,
    pub sequence: u64,
}
pub(super) struct Barrier {
    pub token: String,
    pub bundle: Value,
    pub deadline: Instant,
}
pub(super) struct Actor {
    pub runtime: Arc<DesktopRuntime>,
    pub images: Option<super::images::ImageWorkflow>,
    pub probe_worker: Option<std::thread::JoinHandle<()>>,
    pub probe_epoch: Arc<std::sync::atomic::AtomicU64>,
    pub search: Option<super::search::Search>,
    pub queueing: bool,
    #[cfg(test)]
    pub queue_after_begin: Option<fn(&Actor)>,
    pub queue_terminal_receipts: BTreeMap<String, super::queue_bridge::QueueTerminalReceipt>,
    pub queue_entries: BTreeMap<String, super::queue_bridge::QueueDelivery>,
    pub platform: super::platform::HostPlatform,
    pub credentialed: Option<super::credentialed::Credentialed>,
    pub root: TrustedRoot,
    pub entries: BTreeMap<String, Entry>,
    pub barriers: BTreeMap<String, Barrier>,
    pub terminal_receipts: BTreeMap<String, TerminalReceipt>,
    pub permission_owners: BTreeMap<String, (String, String)>,
    #[cfg(all(target_os = "macos", feature = "formal-preview"))]
    pub pending_backup: Option<super::project_backup::Pending>,
    pub generation: String,
    pub generation_seq: u64,
    pub sequence: u64,
    pub token_seq: u64,
    pub attached: bool,
    pub out: SyncSender<EventEnvelope>,
    pub gate: CloseGate,
    pub ticket: Option<CloseTicket>,
    pub draining: bool,
}
impl Actor {
    pub fn new(
        runtime: Arc<DesktopRuntime>,
        platform: impl Into<super::platform::HostPlatform>,
        root: TrustedRoot,
        out: SyncSender<EventEnvelope>,
    ) -> Self {
        Self {
            runtime,
            images: None,
            probe_worker: None,
            probe_epoch: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            search: None,
            queueing: false,
            #[cfg(test)]
            queue_after_begin: None,
            queue_terminal_receipts: BTreeMap::new(),
            queue_entries: BTreeMap::new(),
            platform: platform.into(),
            credentialed: None,
            root,
            entries: BTreeMap::new(),
            barriers: BTreeMap::new(),
            terminal_receipts: BTreeMap::new(),
            permission_owners: BTreeMap::new(),
            #[cfg(all(target_os = "macos", feature = "formal-preview"))]
            pending_backup: None,
            generation: String::new(),
            generation_seq: 0,
            sequence: 0,
            token_seq: 0,
            attached: false,
            out,
            gate: CloseGate::new(Duration::from_secs(10)).expect("固定关闭超时合法"),
            ticket: None,
            draining: false,
        }
    }
    pub fn run(mut self, rx: Receiver<Message>) {
        loop {
            let timeout = if self.search.is_some() {
                Duration::ZERO
            } else {
                Duration::from_millis(10)
            };
            match rx.recv_timeout(timeout) {
                Ok(Message::Call(command, reply)) => {
                    let result = self.handle(command, &reply);
                    if self.draining {
                        let result = result.and_then(|_| {
                            self.cancel_all()
                                .map(|_| json!({"closed":true}))
                                .map_err(|_| DesktopError("closeFailed"))
                        });
                        self.reject_waiters();
                        drop(self);
                        let _ = reply.send(result);
                        return;
                    }
                    let result = result.and_then(|value| {
                        if value.as_ref().is_some_and(|v| {
                            serde_json::to_vec(v)
                                .map_or(true, |bytes| bytes.len() > MAX_FORMAL_REPLY)
                        }) {
                            return Err(DesktopError("historyLimit"));
                        }
                        Ok(value)
                    });
                    if let Some(result) = result.transpose() {
                        let _ = reply.send(result);
                    }
                }
                #[cfg(all(target_os = "macos", feature = "formal-preview"))]
                Ok(Message::ImageGrant(grant)) => self.process_image_grant(grant),
                #[cfg(all(target_os = "macos", feature = "formal-preview"))]
                Ok(Message::SessionImport(call)) => self.session_import(call),
                Ok(Message::Environment(environment, reply)) => {
                    let result = self
                        .platform
                        .set_host_environment(environment)
                        .and_then(|s| {
                            serde_json::to_value(s).map_err(|_| DesktopError("invalidReply"))
                        });
                    let _ = reply.send(result);
                }
                Ok(Message::Shutdown(reply)) => {
                    let result = self.cancel_all();
                    self.reject_waiters();
                    drop(self);
                    let _ = reply.send(result.map(|_| Value::Null));
                    return;
                }
                Err(RecvTimeoutError::Disconnected) => {
                    let _ = self.cancel_all();
                    self.reject_waiters();
                    return;
                }
                Err(RecvTimeoutError::Timeout) => {}
            }
            self.gate.expire();
            self.poll_images();
            self.poll_thumbnail();
            self.poll_credential_work();
            self.poll();
            self.poll_search();
            if self.draining {
                self.reject_waiters();
                return;
            }
        }
    }
    fn reject_waiters(&mut self) {
        self.cancel_search("hostClosed");
        for entry in self.entries.values_mut() {
            for w in entry.waiters.drain(..) {
                let _ = w.send(Err(DesktopError("hostClosed")));
            }
        }
    }
    pub fn core(&self, method: &str, params: Value) -> Result<Value> {
        let reply = self
            .runtime
            .dispatch(json!({"version":1,"id":"formal-host","method":method,"params":params}))?;
        if let Some(error) = reply.error {
            return Err(core_error(&error.code));
        }
        reply.result.ok_or(DesktopError("invalidReply"))
    }
    pub fn turns(&self, session: &str) -> Result<Vec<Value>> {
        let mut turns = Vec::new();
        let mut after = 0;
        let mut bytes = 0;
        loop {
            let page = self.core(
                "sessions.historyV2",
                json!({"sessionId":session,"after":after,"limit":32}),
            )?;
            bytes += serde_json::to_vec(&page)
                .map_err(|_| DesktopError("invalidReply"))?
                .len();
            if bytes > 8 * 1024 * 1024 {
                return Err(DesktopError("historyLimit"));
            }
            let part = page["turns"]
                .as_array()
                .ok_or(DesktopError("invalidReply"))?;
            turns.extend(part.iter().cloned());
            if page["hasMore"] == false {
                return Ok(turns);
            }
            let next = page["nextAfter"]
                .as_u64()
                .ok_or(DesktopError("invalidReply"))?;
            if next <= after {
                return Err(DesktopError("invalidReply"));
            }
            after = next;
        }
    }
    pub fn history(&self, session: &str) -> Result<Value> {
        let turns = self.turns(session)?;
        self.history_from_turns(session, &turns)
    }
    pub(super) fn history_from_turns(&self, session: &str, turns: &[Value]) -> Result<Value> {
        let mut h = if self.queueing {
            self.queue_history(session, turns)?
        } else {
            projection::text_task_history(turns)
        };
        if let Some(images) = &self.images {
            images.merge_history(session, &mut h)?;
            if self.native_task_lifecycle() {
                let retryable = self.latest_retryable_task(session)?;
                for message in h["sdkMessages"]
                    .as_array_mut()
                    .into_iter()
                    .flatten()
                    .filter(|m| m["type"] == "assistant")
                {
                    if let Some(id) = message["_desktopTextTaskRequestId"]
                        .as_str()
                        .or_else(|| message["_desktopImageTaskRequestId"].as_str())
                    {
                        message["_desktopTaskRetryable"] = json!(retryable.as_deref() == Some(id));
                    }
                }
            }
        }
        if serde_json::to_vec(&h)
            .map_err(|_| DesktopError("invalidReply"))?
            .len()
            > MAX_FORMAL_REPLY
        {
            return Err(DesktopError("historyLimit"));
        }
        Ok(h)
    }
    fn project_task_statuses(&self, workspace: &str) -> Result<Value> {
        let images = self.images.as_ref().ok_or(DesktopError("unsupported"))?;
        let mut rows = Vec::new();
        for (sid, text) in self.runtime.project_task_candidates(workspace)? {
            if let Some(image) = images.store.latest_task(&sid)? {
                if self
                    .runtime
                    .image_follows_text(&sid, text.as_ref(), &image)?
                {
                    let kind = if image.is_edit {
                        "imageEdit"
                    } else {
                        "imageGenerate"
                    };
                    rows.push(json!({"sessionId":sid,"requestId":image.request_id,"status":image.status,"kind":kind}));
                    continue;
                }
            }
            if let Some(text) = text {
                rows.push(json!({"sessionId":sid,"requestId":text.request_id,"status":text.status,"kind":"text"}));
            }
        }
        Ok(json!({"value":rows}))
    }
    pub(super) fn projects_supported(&self) -> bool {
        self.images.is_some()
    }
    pub(super) fn native_task_lifecycle(&self) -> bool {
        cfg!(all(target_os = "macos", feature = "formal-preview")) && self.images.is_some()
    }
    fn handle(&mut self, command: Command, reply: &Reply) -> Result<Option<Value>> {
        if let Some(g) = command.generation() {
            if g != self.generation || g.is_empty() {
                return Err(DesktopError("staleGeneration"));
            }
        }
        match command {
            Command::Bootstrap {} => {
                if let Some(images) = &mut self.images {
                    images.originals.clear();
                    images.thumbnails.cancel("staleGeneration");
                }
                self.cancel_search("staleGeneration");
                self.cancel_credential_work();
                self.cancel_probe();
                if let Some(t) = self.ticket.take() {
                    let _ = self.gate.abort(&t.close_token);
                }
                self.generation_seq += 1;
                #[cfg(all(target_os = "macos", feature = "formal-preview"))]
                {
                    self.pending_backup = None;
                }
                self.generation = format!("document-{}", self.generation_seq);
                self.attached = false;
                self.barriers.clear();
                self.terminal_receipts.clear();
                self.queue_terminal_receipts.clear();
                self.refresh()?;
                self.reset_queue_delivery();
                for e in self.entries.values_mut() {
                    e.resync = true;
                }
                Ok(Some(
                    json!({"version":1,"generation":self.generation,"platformSnapshot":self.platform.bootstrap()?,"activeRuns":self.active_runs()?,"queueing":self.queueing,"nativeImages":self.images.is_some(),"nativeImageAssetReads":self.images.is_some(),"nativeTaskLifecycle":self.native_task_lifecycle(),"nativeImageTaskLifecycle":self.native_task_lifecycle(),"nativeProjectTaskStatuses":self.native_task_lifecycle()&&self.projects_supported(),"nativeProjectBackups":cfg!(all(target_os="macos",feature="formal-preview"))&&self.projects_supported(),"nativeProjectDocuments":cfg!(all(target_os="macos",feature="formal-preview"))&&self.projects_supported(),"nativeProjectBinding":cfg!(all(target_os="macos",feature="formal-preview"))&&self.projects_supported(),"nativeSessionImport":cfg!(all(target_os="macos",feature="formal-preview"))&&self.projects_supported(),"nativeImageFiles":cfg!(all(target_os="macos",feature="formal-preview"))&&self.images.is_some(),"credentialedChannels":self.credentialed.is_some()}),
                ))
            }
            Command::Attach { observed, .. } => {
                if observed.len() > 128
                    || observed.values().any(|sequence| *sequence > self.sequence)
                {
                    return Err(DesktopError("invalidCursor"));
                }
                let missing: Vec<_> = self
                    .terminal_receipts
                    .iter()
                    .filter(|(sid, receipt)| {
                        observed.get(*sid).copied().unwrap_or(0) < receipt.sequence
                            && !self.entries.contains_key(*sid)
                    })
                    .map(|(sid, receipt)| (sid.clone(), receipt.turn.clone()))
                    .collect();
                for (sid, turn) in missing {
                    self.retain_terminal(sid, turn);
                }
                self.replay_queue_terminals(&observed)?;
                self.attached = true;
                self.refresh()?;
                self.reset_queue_delivery();
                for e in self.entries.values_mut() {
                    e.resync = true;
                }
                // reply只报告权威active；实际补快照仍由单actor按序进入outbox。
                let runs = self.active_runs()?;
                self.poll();
                Ok(Some(json!({"activeRuns":runs,"attached":self.attached})))
            }
            Command::Detach { .. } => {
                self.attached = false;
                Ok(Some(Value::Null))
            }
            Command::Invoke {
                channel,
                args,
                mutation,
                expected_chain_id,
                ..
            } => {
                if self.queueing
                    && matches!(
                        channel.as_str(),
                        "agent:send-message"
                            | "agent:queue-message"
                            | "agent:queue-state"
                            | "agent:stop"
                    )
                {
                    if mutation.is_some() {
                        return Err(DesktopError("invalidParams"));
                    }
                    self.queue_invoke(&channel, args, expected_chain_id.as_deref(), reply)
                } else {
                    if expected_chain_id.is_some() {
                        return Err(DesktopError("unsupported"));
                    }
                    self.invoke(&channel, args, mutation, reply)
                }
            }
            #[cfg(all(target_os = "macos", feature = "formal-preview"))]
            Command::PrepareHistoryImage {
                generation,
                session_id,
                message_id,
                filename,
            } => self
                .prepare_history_image(&generation, &session_id, &message_id, &filename)
                .map(Some),
            Command::ProjectTaskStatuses { workspace_id, .. } => {
                if !self.native_task_lifecycle() || !self.projects_supported() {
                    return Err(DesktopError("unsupported"));
                }
                if self.draining {
                    return Err(DesktopError("closing"));
                }
                self.platform.require_workspace(
                    crate::formal_platform::workspace::WorkspaceKey::Id(&workspace_id),
                )?;
                Ok(Some(self.project_task_statuses(&workspace_id)?))
            }
            Command::Restore {
                session_id,
                observed_delivery_sequence,
                ..
            } => {
                if observed_delivery_sequence > self.sequence {
                    return Err(DesktopError("invalidCursor"));
                }
                if !self.attached {
                    return Err(DesktopError("notReady"));
                }
                if let Some(b) = self.barriers.get(&session_id) {
                    if b.deadline > Instant::now() {
                        return Ok(Some(b.bundle.clone()));
                    }
                }
                let turns = self.turns(&session_id)?;
                let history = self.history_from_turns(&session_id, &turns)?;
                self.token_seq += 1;
                let token = format!("{}-restore-{}", self.generation, self.token_seq);
                let turn = turns.last();
                let active = turn.filter(|t| projection::active(t));
                let mut bundle = json!({"restoreToken":token,"deliverySequence":self.sequence,"messages":history["messages"],"sdkMessages":history["sdkMessages"],"activeSnapshot":active.map(projection::active_run),"cursor":turn.map(|t|t["sequence"].clone()).unwrap_or(json!(0))});
                if let Some(active) = self.images.as_ref().and_then(|i| i.active(&session_id)) {
                    let running = bundle["sdkMessages"].as_array().is_some_and(|messages| {
                        messages.iter().any(|m| {
                            m["type"] == "assistant"
                                && m["_desktopImageTaskRequestId"] == active["requestId"]
                                && m["_desktopImageTaskStatus"] == "running"
                        })
                    });
                    if running {
                        bundle["activeSnapshot"] = active;
                    }
                }
                if self.queueing {
                    self.queue_restore(&session_id, &turns, &mut bundle)?;
                    self.reset_session_queue_delivery(&session_id);
                }
                // 已入outbox但尚未被原订阅者观察的终态，须在屏障后重投一次。
                // observed来自transport实际dispatch完成的位置；已观察终态不再触发历史刷新。
                if let Some(t) = turn {
                    if self
                        .terminal_receipts
                        .get(&session_id)
                        .is_some_and(|receipt| {
                            receipt.sequence > observed_delivery_sequence
                                && receipt.turn["requestId"] == t["requestId"]
                        })
                        && !self.entries.contains_key(&session_id)
                    {
                        self.retain_terminal(session_id.clone(), t.clone());
                    }
                }
                // 同一history最后turn同时作为恢复游标，暂停期间不缓存delta。
                if let Some(t) = turn {
                    if let Some(e) = self.entries.get_mut(&session_id) {
                        if e.turn["requestId"] == t["requestId"] {
                            e.turn = t.clone();
                            e.cursor = t["sequence"].as_u64().unwrap_or(0);
                            e.resync = true;
                        }
                    }
                }
                self.barriers.insert(
                    session_id,
                    Barrier {
                        token,
                        bundle: bundle.clone(),
                        deadline: Instant::now() + RESTORE_TIMEOUT,
                    },
                );
                Ok(Some(bundle))
            }
            Command::Resume { restore_token, .. } => {
                let sid = self
                    .barriers
                    .iter()
                    .find(|(_, b)| b.token == restore_token)
                    .map(|(s, _)| s.clone())
                    .ok_or(DesktopError("invalidRestoreToken"))?;
                let b = self
                    .barriers
                    .remove(&sid)
                    .ok_or(DesktopError("invalidRestoreToken"))?;
                if b.deadline <= Instant::now() {
                    return Err(DesktopError("restoreTimeout"));
                }
                if let Some(e) = self.entries.get_mut(&sid) {
                    e.resync = true;
                }
                self.poll();
                Ok(Some(Value::Null))
            }
            Command::BeginClose { .. } => {
                self.cancel_search("closing");
                self.cancel_credential_work();
                self.cancel_probe();
                let ticket = self
                    .gate
                    .begin(&self.generation, self.platform.bootstrap()?.revision)?;
                #[cfg(all(target_os = "macos", feature = "formal-preview"))]
                {
                    self.pending_backup = None;
                }
                self.ticket = Some(ticket.clone());
                Ok(Some(json!(ticket)))
            }
            Command::AbortClose { close_token, .. } => {
                self.gate.abort(&close_token)?;
                self.ticket = None;
                Ok(Some(Value::Null))
            }
            Command::CloseReady {
                close_token,
                committed_revision,
                ..
            } => {
                self.gate.ready(
                    &self.generation,
                    &close_token,
                    committed_revision,
                    self.platform.bootstrap()?.revision,
                )?;
                self.draining = true;
                Ok(Some(Value::Null))
            }
        }
    }
    fn retain_terminal(&mut self, session: String, turn: Value) {
        self.entries.insert(
            session,
            Entry {
                cursor: turn["sequence"].as_u64().unwrap_or(0),
                turn,
                resync: true,
                waiters: Vec::new(),
                settled: true,
                terminal_stage: TerminalStage::default(),
                terminal_error: None,
                sdk_index: 1,
                deleted_history: None,
            },
        );
    }
    fn active_runs(&self) -> Result<Vec<Value>> {
        let mut runs: Vec<Value> = self
            .entries
            .values()
            .filter(|e| projection::active(&e.turn))
            .map(|e| projection::active_run(&e.turn))
            .collect();
        let sessions: std::collections::BTreeSet<_> = self
            .queue_entries
            .values()
            .filter(|e| e.state["closureReason"].is_null())
            .filter_map(|e| e.state["sessionId"].as_str())
            .collect();
        for sid in sessions {
            let mut bundle = json!({});
            self.queue_restore(sid, &self.turns(sid)?, &mut bundle)?;
            if !bundle["activeSnapshot"].is_null() {
                runs.push(bundle["activeSnapshot"].clone());
            }
        }
        if let Some(i) = &self.images {
            runs.extend(i.active_runs());
        }
        Ok(runs)
    }
    pub fn refresh(&mut self) -> Result<()> {
        let ids: Vec<_> = self.entries.keys().cloned().collect();
        for sid in ids {
            let e = &self.entries[&sid];
            if e.deleted_history.is_some() {
                continue;
            }
            let page=self.core("chat.eventsV2",json!({"sessionId":sid,"requestId":e.turn["requestId"],"afterSequence":e.cursor,"limit":128}))?;
            if let Some(e) = self.entries.get_mut(&sid) {
                e.turn = page["turn"].clone();
            }
        }
        Ok(())
    }
    pub fn cancel_all(&mut self) -> Result<()> {
        self.drain_images();
        self.cancel_credential_work();
        self.cancel_probe();
        self.stop_all_queues("close")?;
        let mut failure = None;
        for run in self
            .entries
            .values()
            .map(|e| &e.turn)
            .filter(|t| projection::active(t))
        {
            let stopped = if run["toolState"].is_null() {
                self.runtime.interrupt_text(
                    run["sessionId"]
                        .as_str()
                        .ok_or(DesktopError("invalidReply"))?,
                    run["requestId"]
                        .as_str()
                        .ok_or(DesktopError("invalidReply"))?,
                )
            } else {
                self.core(
                    "chat.cancel",
                    json!({"sessionId":run["sessionId"],"requestId":run["requestId"]}),
                )
                .map(|_| ())
            };
            if let Err(e) = stopped {
                failure = Some(e);
            }
        }
        self.poll();
        if let Some(e) = failure {
            Err(e)
        } else {
            Ok(())
        }
    }
}
// core错误来自固定枚举，但跨JSON后仍以静态allowlist收口，绝不转发任意服务文本。
fn core_error(code: &str) -> DesktopError {
    DesktopError(match code {
        "chainNotFound" => "chainNotFound",
        "chainClosed" => "chainClosed",
        "staleQueue" => "staleQueue",
        "queueLimit" => "queueLimit",
        "queuePayloadLimit" => "queuePayloadLimit",
        "requestNotFound" => "requestNotFound",
        "permissionNotFound" => "permissionNotFound",
        "permissionConflict" => "permissionConflict",
        "permissionExpired" => "permissionExpired",
        "contextUnsupported" => "contextUnsupported",
        "toolUnsupported" => "toolUnsupported",
        "runTimeout" => "runTimeout",
        "runBusy" => "runBusy",
        "requestConflict" => "requestConflict",
        "sessionNotFound" => "sessionNotFound",
        "profileNotFound" => "profileNotFound",
        "modelNotFound" => "modelNotFound",
        "modelUnavailable" => "modelUnavailable",
        "unsupportedEffort" => "unsupportedEffort",
        "invalidParams" => "invalidParams",
        "invalidId" => "invalidId",
        "emptyInput" => "emptyInput",
        "inputTooLarge" => "inputTooLarge",
        "invalidTime" => "invalidTime",
        "activeLimit" => "activeLimit",
        "requestLimit" => "requestLimit",
        "sessionLimit" => "sessionLimit",
        "pageLimit" => "historyLimit",
        "invalidCursor" => "invalidCursor",
        "recoveryRequired" => "recoveryRequired",
        "storeIo" => "storeIo",
        _ => "runtimeUnavailable",
    })
}

#[cfg(test)]
#[path = "delivery_tests.rs"]
mod delivery_tests;

#[cfg(test)]
#[path = "queue_fault_tests.rs"]
mod queue_fault_tests;
