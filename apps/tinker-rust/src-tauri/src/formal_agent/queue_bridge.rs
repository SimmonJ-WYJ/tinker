//! 有限链投递状态；接受、顺序、停止与启动均委托唯一 core journal。
use super::{actor::Actor, projection, queue_projection, Reply};
use crate::desktop_runtime::protocol::{DesktopError, Result};
use serde::Deserialize;
use serde_json::{json, Value};
#[derive(Clone)]
pub(super) struct QueueTerminalReceipt {
    session: String,
    chain: String,
    started: u64,
    sequence: u64,
    deleted_snapshot: Option<Value>,
}
pub(super) struct QueueDelivery {
    pub state: Value,
    pub turn: Value,
    pub snapshot: Value,
    pub started: u64,
    pub delivered: Option<(u64, u64)>,
    staged: Vec<Value>,
    stage_index: usize,
    stage_signature: Option<(u64, u64)>,
    pub badge_clear_revision: u64,
    error_delivered: bool,
    deleted: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct QueueInput {
    session_id: String,
    uuid: String,
    user_message: String,
    #[serde(default)]
    interrupt: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Query {
    session_id: String,
    #[serde(default)]
    uuid: Option<String>,
}
impl Actor {
    pub fn queue_invoke(
        &mut self,
        channel: &str,
        args: Vec<Value>,
        chain: Option<&str>,
        reply: &Reply,
    ) -> Result<Option<Value>> {
        let chain = chain.ok_or(DesktopError("staleQueue"))?;
        if args.len() != 1 {
            return Err(DesktopError("invalidParams"));
        }
        self.gate.expire();
        if !self.gate.allows_send() && channel != "agent:queue-state" && channel != "agent:stop" {
            return Err(DesktopError("closing"));
        }
        let value = match channel {
            "agent:send-message" => {
                if args[0]["requestId"] != chain {
                    return Err(DesktopError("staleQueue"));
                }
                return self.send(args[0].clone(), reply);
            }
            "agent:queue-message" => {
                let p: QueueInput = serde_json::from_value(args[0].clone())
                    .map_err(|_| DesktopError("invalidParams"))?;
                self.core("chat.queue",json!({"sessionId":p.session_id,"chainId":chain,"uuid":p.uuid,"userMessage":p.user_message,"interrupt":p.interrupt}))?
            }
            "agent:queue-state" => {
                let p: Query = serde_json::from_value(args[0].clone())
                    .map_err(|_| DesktopError("invalidParams"))?;
                let mut q = json!({"sessionId":p.session_id,"chainId":chain});
                if let Some(uuid) = p.uuid {
                    q["uuid"] = json!(uuid)
                }
                self.core("chat.queueState", q)?
            }
            "agent:stop" => {
                let sid = args[0].as_str().ok_or(DesktopError("invalidParams"))?;
                self.core(
                    "chat.stopChain",
                    json!({"sessionId":sid,"chainId":chain,"reason":"stop"}),
                )?;
                Value::Null
            }
            _ => return Err(DesktopError("unsupported")),
        };
        Ok(Some(json!({"value":value})))
    }
    pub fn begin_queue(&mut self, params: Value) -> Result<Option<Value>> {
        let cid = params["requestId"]
            .as_str()
            .ok_or(DesktopError("invalidParams"))?
            .to_owned();
        let sid = params["sessionId"]
            .as_str()
            .ok_or(DesktopError("invalidParams"))?
            .to_owned();
        crate::desktop_runtime::protocol::id(&cid)?;
        crate::desktop_runtime::protocol::id(&sid)?;
        let started = params["startedAt"]
            .as_u64()
            .ok_or(DesktopError("invalidParams"))?;
        if !self.queue_entries.contains_key(&cid) && self.queue_entries.len() >= 128 {
            return Err(DesktopError("hostBusy"));
        }
        // core 可能先持久化、启动，再返回错误；调用前先保留有限生命周期归属。
        let reserved = !self.queue_entries.contains_key(&cid);
        self.queue_entries
            .entry(cid.clone())
            .or_insert(QueueDelivery {
                state: json!({"sessionId":sid,"chainId":cid,"closureReason":null}),
                turn: Value::Null,
                snapshot: Value::Null,
                started,
                delivered: None,
                staged: Vec::new(),
                stage_index: 0,
                stage_signature: None,
                badge_clear_revision: 0,
                error_delivered: false,
                deleted: false,
            });
        let state = match self.core("chat.beginChain", params) {
            Ok(state) => state,
            Err(error) => {
                // 已有归属的重试失败不得删除或关闭原链。
                if reserved {
                    match self.core("chat.queueState", json!({"sessionId":sid,"chainId":cid})) {
                        Ok(state) => {
                            self.queue_entries.get_mut(&cid).expect("已保留归属").state = state;
                            self.close_failed_begin(&sid, &cid);
                        }
                        Err(proof) if matches!(proof.0, "chainNotFound" | "sessionNotFound") => {
                            // 只读查询明确证明没有接受，才移除本次新建的预留。
                            self.queue_entries.remove(&cid);
                        }
                        Err(_) => self.draining = true,
                    }
                }
                return Err(error);
            }
        };
        self.queue_entries.get_mut(&cid).expect("已保留归属").state = state.clone();
        #[cfg(test)]
        if let Some(after_begin) = self.queue_after_begin.take() {
            after_begin(self);
        }
        let projected = (|| {
            let turns = self.turns(&sid)?;
            let turn = self.queue_turn(&state)?;
            let snapshot = queue_projection::snapshot(&state, &turns, started)?;
            Ok::<_, DesktopError>((turn, snapshot))
        })();
        match projected {
            Ok((turn, snapshot)) => {
                let entry = self.queue_entries.get_mut(&cid).expect("已保留归属");
                entry.turn = turn;
                entry.snapshot = snapshot;
            }
            Err(error) => {
                self.close_failed_begin(&sid, &cid);
                return Err(error);
            }
        }
        Ok(Some(
            json!({"value":{"chainId":state["chainId"],"accepted":true,"closureReason":state["closureReason"]}}),
        ))
    }
    fn close_failed_begin(&mut self, sid: &str, cid: &str) {
        match self.core(
            "chat.stopChain",
            json!({"sessionId":sid,"chainId":cid,"reason":"failure"}),
        ) {
            // stopChain 成功才证明持久关闭及取消安全；错误由调用方用原身份只读核对。
            Ok(_) => {
                self.queue_entries.remove(cid);
            }
            Err(_) => {
                self.draining = true;
            }
        }
    }
    fn queue_turn(&self, state: &Value) -> Result<Value> {
        let r = &state["activeExecution"];
        let page=self.core("chat.eventsV2",json!({"sessionId":state["sessionId"],"requestId":r["requestId"],"afterSequence":0,"limit":1}))?;
        let t = &page["turn"];
        if t["sessionId"] != r["sessionId"]
            || t["requestId"] != r["requestId"]
            || t["runId"] != r["runId"]
            || t["sequence"].as_u64() < r["sequence"].as_u64()
        {
            return Err(DesktopError("invalidReply"));
        }
        Ok(t.clone())
    }
    pub fn poll_queues(&mut self) {
        if !self.queueing {
            return;
        }
        let ids: Vec<_> = self.queue_entries.keys().cloned().collect();
        for id in ids {
            let Some(mut e) = self.queue_entries.remove(&id) else {
                continue;
            };
            match self.poll_queue(&mut e) {
                Ok(true) => {
                    if self.queue_terminal_receipts.len() >= 128 {
                        if let Some(old) = self
                            .queue_terminal_receipts
                            .iter()
                            .min_by_key(|(_, r)| r.sequence)
                            .map(|(id, _)| id.clone())
                        {
                            self.queue_terminal_receipts.remove(&old);
                        }
                    }
                    self.queue_terminal_receipts.insert(
                        id.clone(),
                        QueueTerminalReceipt {
                            session: e.state["sessionId"].as_str().unwrap_or_default().into(),
                            chain: id,
                            started: e.started,
                            sequence: self.sequence,
                            deleted_snapshot: e.deleted.then_some(e.snapshot),
                        },
                    );
                }
                Ok(false) => {
                    self.queue_entries.insert(id, e);
                }
                Err(_) => {
                    // 持久化或取消不确定时冻结所有新启动，不能伪造已完成。
                    self.draining = true;
                    self.queue_entries.insert(id, e);
                    let _ = self.stop_all_queues("failure");
                    return;
                }
            }
        }
    }
    fn poll_queue(&mut self, e: &mut QueueDelivery) -> Result<bool> {
        let sid = e.state["sessionId"]
            .as_str()
            .ok_or(DesktopError("invalidReply"))?
            .to_owned();
        let chain = e.state["chainId"].clone();
        if e.deleted {
            if !self.attached || self.barriers.contains_key(&sid) {
                return Ok(false);
            }
            if e.delivered.is_none() {
                if !self.emit("agent:stream:event", e.snapshot.clone()) {
                    return Ok(false);
                }
                e.delivered = Some((0, 0));
            }
            return Ok(self.emit("agent:stream:complete",json!({"sessionId":sid,"requestId":chain,"startedAt":e.started,"messages":[],"stoppedByUser":true,"resultSubtype":"success"})));
        }
        let previous_boundary = e.state["badgeClearBoundary"].as_u64().unwrap_or(0);
        e.state = self.core("chat.queueState", json!({"sessionId":sid,"chainId":chain}))?;
        e.turn = self.queue_turn(&e.state)?;
        if e.state["closureReason"].is_null()
            && !projection::active(&e.turn)
            && self.gate.allows_send()
        {
            e.state=self.core("chat.advanceQueue",json!({"sessionId":sid,"chainId":chain,"expectedActiveRequestId":e.turn["requestId"],"expectedQueueRevision":e.state["revision"]}))?;
            e.turn = self.queue_turn(&e.state)?;
        }
        self.register_permissions(&e.turn)?;
        let signature = (
            e.state["revision"]
                .as_u64()
                .ok_or(DesktopError("invalidReply"))?,
            e.turn["sequence"]
                .as_u64()
                .ok_or(DesktopError("invalidReply"))?,
        );
        if e.state["badgeClearBoundary"].as_u64().unwrap_or(0) > previous_boundary {
            e.badge_clear_revision = signature.0;
        }
        // 未完成阶段不可被后续 core 进展改写；满 outbox 只保留下一个待发送索引。
        if e.staged.is_empty() && e.delivered != Some(signature) {
            e.snapshot = queue_projection::snapshot(&e.state, &self.turns(&sid)?, e.started)?;
            e.snapshot["snapshotSequence"] = json!(signature.1);
            e.snapshot["payload"]["event"]["badgeClearRevision"] = json!(e.badge_clear_revision);
            e.staged = super::queue_frames::frames(&e.snapshot)?;
            e.stage_signature = Some(signature);
            e.stage_index = 0;
        }
        if !self.attached || self.barriers.contains_key(&sid) {
            return Ok(false);
        }
        while let Some(frame) = e.staged.get(e.stage_index) {
            if !self.emit("agent:stream:event", frame.clone()) {
                return Ok(false);
            }
            e.stage_index += 1;
        }
        if !e.staged.is_empty() {
            e.delivered = e.stage_signature;
            e.staged.clear();
        }
        if e.delivered != Some(signature) {
            return Ok(false);
        }
        if e.state["closureReason"].is_null() {
            return Ok(false);
        }
        let failed = matches!(
            e.state["closureReason"].as_str(),
            Some("failure" | "recovered")
        );
        if failed && !e.error_delivered {
            if !self.emit("agent:stream:error",json!({"sessionId":sid,"requestId":chain,"startedAt":e.started,"error":"responseFailed"})){return Ok(false)}
            e.error_delivered = true;
        }
        self.history(&sid)?;
        Ok(self.emit("agent:stream:complete",json!({"sessionId":sid,"requestId":chain,"startedAt":e.started,"stoppedByUser":e.state["closureReason"]=="stop","resultSubtype":if failed {"error_during_execution"}else{"success"}})))
    }
    pub fn replay_queue_terminals(
        &mut self,
        _observed: &std::collections::BTreeMap<String, u64>,
    ) -> Result<()> {
        let receipts: Vec<_> = self
            .queue_terminal_receipts
            .values()
            .filter(|r| !self.queue_entries.contains_key(&r.chain))
            .cloned()
            .collect();
        for receipt in receipts {
            let deleted = receipt.deleted_snapshot.is_some();
            let (state, turn, snapshot) = if let Some(snapshot) = receipt.deleted_snapshot {
                (
                    json!({"sessionId":receipt.session,"chainId":receipt.chain,"closureReason":"delete"}),
                    Value::Null,
                    snapshot,
                )
            } else {
                let state = self.core(
                    "chat.queueState",
                    json!({"sessionId":receipt.session,"chainId":receipt.chain}),
                )?;
                let turn = self.queue_turn(&state)?;
                let snapshot = queue_projection::snapshot(
                    &state,
                    &self.turns(&receipt.session)?,
                    receipt.started,
                )?;
                (state, turn, snapshot)
            };
            self.queue_entries.insert(
                receipt.chain,
                QueueDelivery {
                    state,
                    turn,
                    snapshot,
                    started: receipt.started,
                    delivered: None,
                    staged: Vec::new(),
                    stage_index: 0,
                    stage_signature: None,
                    badge_clear_revision: 0,
                    error_delivered: false,
                    deleted,
                },
            );
        }
        Ok(())
    }
    pub fn reset_session_queue_delivery(&mut self, sid: &str) {
        for e in self
            .queue_entries
            .values_mut()
            .filter(|e| e.state["sessionId"] == sid)
        {
            e.delivered = None;
            e.staged.clear();
            e.stage_index = 0;
        }
    }
    pub fn reset_queue_delivery(&mut self) {
        for e in self.queue_entries.values_mut() {
            e.delivered = None;
            e.staged.clear();
            e.stage_index = 0;
        }
    }
    pub fn stop_all_queues(&mut self, reason: &str) -> Result<()> {
        for e in self.queue_entries.values().filter(|e| !e.deleted) {
            self.core("chat.stopChain",json!({"sessionId":e.state["sessionId"],"chainId":e.state["chainId"],"reason":reason}))?;
        }
        Ok(())
    }
    pub fn delete_queue(&mut self, sid: &str) -> Result<()> {
        if !self.queueing {
            return Ok(());
        }
        let states = self.chain_states(sid)?;
        for state in states {
            if state["closureReason"].is_null() {
                self.core(
                    "chat.stopChain",
                    json!({"sessionId":sid,"chainId":state["chainId"],"reason":"delete"}),
                )?;
            }
        }
        for receipt in self
            .queue_terminal_receipts
            .values_mut()
            .filter(|r| r.session == sid)
        {
            receipt.deleted_snapshot = Some(
                json!({"sessionId":sid,"requestId":receipt.chain,"startedAt":receipt.started,"payload":{"kind":"asci_event","event":{"type":"native_chain_snapshot","chainId":receipt.chain,"revision":0,"badgeClearBoundary":0,"activeRequestId":null,"closureReason":"delete","executions":[],"pendingMessages":[],"receipts":[]}}}),
            );
        }
        let turns = self.turns(sid)?;
        let ids: Vec<_> = self
            .queue_entries
            .iter()
            .filter(|(_, e)| e.state["sessionId"] == sid)
            .map(|(id, _)| id.clone())
            .collect();
        for id in ids {
            let state = self.core("chat.queueState", json!({"sessionId":sid,"chainId":id}))?;
            let e = self
                .queue_entries
                .get_mut(&id)
                .ok_or(DesktopError("invalidReply"))?;
            let mut snapshot = queue_projection::snapshot(&state, &turns, e.started)?;
            let event = &mut snapshot["payload"]["event"];
            for group in event["executions"].as_array_mut().into_iter().flatten() {
                group["snapshot"] = json!({"type":"tool_run_snapshot","sdkMessages":[],"activeText":"","pendingPermissions":[]});
            }
            event["pendingMessages"] = json!([]);
            for receipt in event["receipts"].as_array_mut().into_iter().flatten() {
                receipt["userMessage"] = Value::Null;
            }
            e.state = json!({"sessionId":sid,"chainId":id,"closureReason":"delete"});
            e.turn = Value::Null;
            e.snapshot = snapshot;
            e.staged.clear();
            e.stage_index = 0;
            e.delivered = None;
            e.deleted = true;
        }
        Ok(())
    }
}
