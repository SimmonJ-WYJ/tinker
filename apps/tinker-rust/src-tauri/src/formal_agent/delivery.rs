//! 单actor分配序号并try_send；满队列不阻塞actor，后续轮询自动补完整快照。
use super::{
    actor::{Actor, Entry, TerminalReceipt, TerminalStage},
    projection,
    protocol::EventEnvelope,
};
use crate::desktop_runtime::protocol::{DesktopError, Result};
use serde_json::{json, Value};
use std::time::Instant;
impl Actor {
    pub fn emit(&mut self, channel: &str, payload: Value) -> bool {
        if !self.attached {
            return false;
        }
        let sequence = self.sequence + 1;
        let envelope = EventEnvelope {
            version: 1,
            generation: self.generation.clone(),
            delivery_sequence: sequence,
            channel: channel.into(),
            payload,
        };
        match self.out.try_send(envelope) {
            Ok(()) => {
                self.sequence = sequence;
                true
            }
            Err(_) => false,
        }
    }
    pub fn poll(&mut self) {
        self.barriers.retain(|_, b| b.deadline > Instant::now());
        let ids: Vec<_> = self.entries.keys().cloned().collect();
        for sid in ids {
            let Some(mut e) = self.entries.remove(&sid) else {
                continue;
            };
            let result = self.poll_entry(&sid, &mut e);
            match result {
                Ok(delivered) => {
                    if !delivered {
                        self.entries.insert(sid, e);
                    }
                }
                Err(error) => {
                    // 捕获request身份后取消；故障不得转换为未来run的取消。
                    match self.core(
                        "chat.cancel",
                        json!({"sessionId":sid,"requestId":e.turn["requestId"]}),
                    ) {
                        Ok(turn) => e.turn = turn,
                        // 连取消身份也无法核验时冻结宿主，actor退出会回收全部provider。
                        Err(_) => self.draining = true,
                    }
                    e.terminal_error = Some(error);
                    e.terminal_stage = TerminalStage::Error;
                    if !self.poll_fault(&sid, &mut e, error) {
                        self.entries.insert(sid, e);
                    }
                }
            }
        }
    }
    fn poll_entry(&mut self, sid: &str, e: &mut Entry) -> Result<bool> {
        if let Some(error) = e.terminal_error {
            return Ok(self.poll_fault(sid, e, error));
        }
        if e.settled
            && !projection::active(&e.turn)
            && (!self.attached || self.barriers.contains_key(sid))
        {
            e.resync = true;
            return Ok(false);
        }
        let page=self.core("chat.events",json!({"sessionId":sid,"requestId":e.turn["requestId"],"afterSequence":e.cursor,"limit":128}))?;
        let turn = page["turn"].clone();
        if turn["requestId"] != e.turn["requestId"]
            || turn["sessionId"] != sid
            || turn["startedAt"] != e.turn["startedAt"]
        {
            return Err(DesktopError("invalidReply"));
        }
        e.turn = turn;
        let mut terminal_history = None;
        if !projection::active(&e.turn) && !e.settled {
            // SEND成功还须能读取其持久历史；不能先resolve再把投影失败变为流错误。
            terminal_history = Some(self.history(sid)?);
            let outcome = if matches!(e.turn["status"].as_str(), Some("failed" | "interrupted")) {
                Err(DesktopError("responseFailed"))
            } else {
                Ok(json!({"value":null}))
            };
            for waiter in e.waiters.drain(..) {
                let _ = waiter.send(outcome.clone());
            }
            e.settled = true;
        }
        if !self.attached || self.barriers.contains_key(sid) {
            e.resync = true;
            return Ok(false);
        }
        if e.resync {
            if !self.emit("agent:stream:event", projection::snapshot(&e.turn)) {
                return Ok(false);
            }
            e.cursor = e.turn["sequence"]
                .as_u64()
                .ok_or(DesktopError("invalidReply"))?;
            e.resync = false;
            e.terminal_stage = TerminalStage::SdkMessage;
        } else {
            for event in page["events"]
                .as_array()
                .ok_or(DesktopError("invalidReply"))?
            {
                let seq = event["sequence"]
                    .as_u64()
                    .ok_or(DesktopError("invalidReply"))?;
                if seq <= e.cursor {
                    return Err(DesktopError("invalidReply"));
                }
                if event["kind"]=="delta"&&!event["text"].is_null()&&!self.emit("agent:stream:event",projection::stream(&e.turn,json!({"kind":"asci_event","event":{"type":"text_delta","text":event["text"],"turnId":e.turn["runId"]}}))){e.resync=true;return Ok(false);}
                e.cursor = seq;
            }
        }
        if projection::active(&e.turn)
            || e.cursor
                < e.turn["sequence"]
                    .as_u64()
                    .ok_or(DesktopError("invalidReply"))?
        {
            return Ok(false);
        }
        let history = match terminal_history {
            Some(history) => history,
            None => self.history(sid)?,
        };
        if e.terminal_stage == TerminalStage::SdkMessage {
            let projected = projection::history(std::slice::from_ref(&e.turn));
            if let Some(final_message) = projected["sdkMessages"].get(1) {
                if !self.emit(
                    "agent:stream:event",
                    projection::stream(
                        &e.turn,
                        json!({"kind":"sdk_message","message":final_message}),
                    ),
                ) {
                    return Ok(false);
                }
            }
            e.terminal_stage = TerminalStage::Error;
        }
        if e.terminal_stage == TerminalStage::Error {
            if matches!(e.turn["status"].as_str(), Some("failed" | "interrupted"))
                && !self.emit("agent:stream:error", json!({"sessionId":sid,"requestId":e.turn["requestId"],"startedAt":e.turn["startedAt"],"error":"responseFailed"}))
            {
                return Ok(false);
            }
            e.terminal_stage = TerminalStage::Complete;
        }
        let delivered=self.emit("agent:stream:complete",json!({"sessionId":sid,"requestId":e.turn["requestId"],"startedAt":e.turn["startedAt"],"messages":history["messages"],"stoppedByUser":e.turn["status"]=="cancelled","resultSubtype":if e.turn["status"]=="completed"{"success"}else{"error_during_execution"}}));
        if delivered {
            self.record_terminal(sid, e);
        }
        Ok(delivered)
    }
    fn poll_fault(&mut self, sid: &str, e: &mut Entry, error: DesktopError) -> bool {
        // 故障也是终态计划：重试不得再次取消或重复已入队的ERROR。
        for waiter in e.waiters.drain(..) {
            let _ = waiter.send(Err(error));
        }
        e.settled = true;
        if !self.attached || self.barriers.contains_key(sid) {
            e.resync = true;
            return false;
        }
        if e.resync {
            if !self.emit("agent:stream:event", projection::snapshot(&e.turn)) {
                return false;
            }
            e.resync = false;
            e.terminal_stage = TerminalStage::Error;
        }
        if e.terminal_stage == TerminalStage::Error {
            if !self.emit("agent:stream:error", json!({"sessionId":sid,"requestId":e.turn["requestId"],"startedAt":e.turn["startedAt"],"error":error.0})) {
                return false;
            }
            e.terminal_stage = TerminalStage::Complete;
        }
        let delivered = self.emit("agent:stream:complete", json!({"sessionId":sid,"requestId":e.turn["requestId"],"startedAt":e.turn["startedAt"],"resultSubtype":"error_during_execution"}));
        if delivered {
            self.record_terminal(sid, e);
        }
        delivered
    }
    fn record_terminal(&mut self, sid: &str, e: &Entry) {
        self.terminal_receipts.insert(
            sid.into(),
            TerminalReceipt {
                turn: e.turn.clone(),
                sequence: self.sequence,
            },
        );
    }
}
