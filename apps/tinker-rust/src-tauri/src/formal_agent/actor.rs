//! 单actor串行协调generation、平台revision、执行归属与关闭阶段。
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
        FormalPlatform, TrustedRoot,
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
    pub platform: FormalPlatform,
    pub root: TrustedRoot,
    pub entries: BTreeMap<String, Entry>,
    pub barriers: BTreeMap<String, Barrier>,
    pub terminal_receipts: BTreeMap<String, TerminalReceipt>,
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
        platform: FormalPlatform,
        root: TrustedRoot,
        out: SyncSender<EventEnvelope>,
    ) -> Self {
        Self {
            runtime,
            platform,
            root,
            entries: BTreeMap::new(),
            barriers: BTreeMap::new(),
            terminal_receipts: BTreeMap::new(),
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
            match rx.recv_timeout(Duration::from_millis(10)) {
                Ok(Message::Call(command, reply)) => {
                    let result = self.handle(command, &reply);
                    if self.draining {
                        let result =
                            result.and_then(|_| self.cancel_all().map(|_| json!({"closed":true})));
                        self.reject_waiters();
                        drop(self);
                        let _ = reply.send(result);
                        return;
                    }
                    if let Some(result) = result.transpose() {
                        let _ = reply.send(result);
                    }
                }
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
            self.poll();
            if self.draining {
                self.reject_waiters();
                return;
            }
        }
    }
    fn reject_waiters(&mut self) {
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
                "sessions.history",
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
        let h = projection::history(&self.turns(session)?);
        if serde_json::to_vec(&h)
            .map_err(|_| DesktopError("invalidReply"))?
            .len()
            > 16 * 1024 * 1024
        {
            return Err(DesktopError("historyLimit"));
        }
        Ok(h)
    }
    fn handle(&mut self, command: Command, reply: &Reply) -> Result<Option<Value>> {
        if let Some(g) = command.generation() {
            if g != self.generation || g.is_empty() {
                return Err(DesktopError("staleGeneration"));
            }
        }
        match command {
            Command::Bootstrap {} => {
                if let Some(t) = self.ticket.take() {
                    let _ = self.gate.abort(&t.close_token);
                }
                self.generation_seq += 1;
                self.generation = format!("document-{}", self.generation_seq);
                self.attached = false;
                self.barriers.clear();
                self.terminal_receipts.clear();
                self.refresh()?;
                for e in self.entries.values_mut() {
                    e.resync = true;
                }
                Ok(Some(
                    json!({"version":1,"generation":self.generation,"platformSnapshot":self.platform.bootstrap()?,"activeRuns":self.active_runs()}),
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
                self.attached = true;
                self.refresh()?;
                for e in self.entries.values_mut() {
                    e.resync = true;
                }
                // reply只报告权威active；实际补快照仍由单actor按序进入outbox。
                let runs = self.active_runs();
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
                ..
            } => self.invoke(&channel, args, mutation, reply),
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
                let history = projection::history(&turns);
                self.token_seq += 1;
                let token = format!("{}-restore-{}", self.generation, self.token_seq);
                let turn = turns.last();
                let active = turn.filter(|t| projection::active(t));
                let bundle = json!({"restoreToken":token,"deliverySequence":self.sequence,"messages":history["messages"],"sdkMessages":history["sdkMessages"],"activeSnapshot":active.map(projection::active_run),"cursor":turn.map(|t|t["sequence"].clone()).unwrap_or(json!(0))});
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
                let ticket = self
                    .gate
                    .begin(&self.generation, self.platform.bootstrap()?.revision)?;
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
            },
        );
    }
    fn active_runs(&self) -> Vec<Value> {
        self.entries
            .values()
            .filter(|e| projection::active(&e.turn))
            .map(|e| projection::active_run(&e.turn))
            .collect()
    }
    pub fn refresh(&mut self) -> Result<()> {
        let ids: Vec<_> = self.entries.keys().cloned().collect();
        for sid in ids {
            let e = &self.entries[&sid];
            let page=self.core("chat.events",json!({"sessionId":sid,"requestId":e.turn["requestId"],"afterSequence":e.cursor,"limit":128}))?;
            if let Some(e) = self.entries.get_mut(&sid) {
                e.turn = page["turn"].clone();
            }
        }
        Ok(())
    }
    pub fn cancel_all(&mut self) -> Result<()> {
        let runs: Vec<_> = self
            .entries
            .values()
            .filter(|e| projection::active(&e.turn))
            .map(|e| json!({"sessionId":e.turn["sessionId"],"requestId":e.turn["requestId"]}))
            .collect();
        let mut failure = None;
        for run in runs {
            if let Err(e) = self.core("chat.cancel", run) {
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
        "runBusy" => "runBusy",
        "requestConflict" => "requestConflict",
        "sessionNotFound" => "sessionNotFound",
        "profileNotFound" => "profileNotFound",
        "modelNotFound" => "modelNotFound",
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
        "requestNotFound" => "requestNotFound",
        "invalidCursor" => "invalidCursor",
        "recoveryRequired" => "recoveryRequired",
        "storeIo" => "storeIo",
        _ => "runtimeUnavailable",
    })
}

#[cfg(test)]
#[path = "delivery_tests.rs"]
mod delivery_tests;
