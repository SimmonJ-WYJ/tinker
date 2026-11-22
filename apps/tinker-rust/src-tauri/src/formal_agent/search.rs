//! 分片执行的只读历史搜索；每轮最多读取一条链或一页历史，交还 actor 处理 Stop/流式事件。
use super::{actor::Actor, projection, queue_projection, search_text, Reply};
use crate::desktop_runtime::protocol::{DesktopError, Result};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, VecDeque},
    time::{Duration, Instant},
};

const MAX_HITS: usize = 30;
const SEARCH_BUDGET: Duration = Duration::from_secs(20);
#[derive(Default)]
struct Cursor {
    chains: VecDeque<String>,
    owners: BTreeMap<String, String>,
    queued_hit: Option<Value>,
    after: u64,
    extent: usize,
}
pub(super) struct Search {
    query: String,
    reply: Reply,
    sessions: VecDeque<String>,
    current: Option<Cursor>,
    hits: BTreeMap<String, Value>,
    deadline: Instant,
}

fn recent_sessions(actor: &Actor) -> Result<Vec<Value>> {
    let mut sessions = actor.sessions()?;
    sessions.sort_by_key(|s| std::cmp::Reverse(s["updatedAt"].as_u64().unwrap_or_default()));
    Ok(sessions)
}
impl Actor {
    pub(super) fn cancel_search(&mut self, code: &'static str) {
        if let Some(search) = self.search.take() {
            let _ = search.reply.send(Err(DesktopError(code)));
        }
    }
    pub(super) fn start_search(&mut self, query: &str, reply: &Reply) -> Result<Option<Value>> {
        if !self.gate.allows_send() {
            return Err(DesktopError("closing"));
        }
        self.cancel_search("staleGeneration");
        if query.encode_utf16().take(2).count() < 2 {
            return Ok(Some(json!({"value":[]})));
        }
        if query.len() > 4096 {
            return Err(DesktopError("inputTooLarge"));
        }
        let sessions = recent_sessions(self)?
            .into_iter()
            .map(|s| id(&s["sessionId"]))
            .collect::<Result<_>>()?;
        self.search = Some(Search {
            query: query.to_lowercase(),
            reply: reply.clone(),
            sessions,
            current: None,
            hits: BTreeMap::new(),
            deadline: Instant::now() + SEARCH_BUDGET,
        });
        Ok(None)
    }
    pub(super) fn poll_search(&mut self) {
        let Some(mut search) = self.search.take() else {
            return;
        };
        match search.step(self) {
            Ok(None) => self.search = Some(search),
            result => {
                let _ = search.reply.send(result.map(|v| json!({"value":v})));
            }
        }
    }
}
fn id(value: &Value) -> Result<String> {
    value
        .as_str()
        .map(str::to_owned)
        .ok_or(DesktopError("invalidReply"))
}
fn items(value: &Value) -> Result<&Vec<Value>> {
    value.as_array().ok_or(DesktopError("invalidReply"))
}
impl Search {
    pub(super) fn forget(&mut self, id: &str) {
        self.hits.remove(id);
        if self.sessions.front().is_some_and(|sid| sid == id) {
            self.current = None;
        }
        self.sessions.retain(|sid| sid != id);
    }
    fn step(&mut self, actor: &Actor) -> Result<Option<Vec<Value>>> {
        if Instant::now() >= self.deadline {
            return Err(DesktopError("transportTimeout"));
        }
        let Some(sid) = self
            .sessions
            .front()
            .cloned()
            .filter(|_| self.hits.len() < MAX_HITS)
        else {
            let mut out = vec![];
            // 读取期间可删除/改名/归档。只返回交付时仍可见的会话及最新元数据。
            for session in recent_sessions(actor)? {
                let sid = id(&session["sessionId"])?;
                if let Some(mut hit) = self.hits.remove(&sid) {
                    hit["sessionId"] = json!(sid);
                    hit["sessionTitle"] = session["title"].clone();
                    hit["archived"] = session["archived"].clone();
                    out.push(hit);
                }
            }
            return Ok(Some(out));
        };
        match self.session_step(actor, &sid) {
            Ok(true) | Err(DesktopError("sessionNotFound")) => {
                self.current = None;
                self.sessions.pop_front();
            }
            Err(err) => return Err(err),
            Ok(false) => {}
        }
        Ok(None)
    }
    fn session_step(&mut self, actor: &Actor, sid: &str) -> Result<bool> {
        if self.current.is_none() {
            let mut cursor = Cursor {
                extent: actor.runtime.history_extent(sid)?,
                ..Default::default()
            };
            if actor.queueing {
                let list = actor.core("chat.listChains", json!({"sessionId":sid}))?;
                cursor.chains = items(&list["chains"])?
                    .iter()
                    .map(|c| id(&c["chainId"]))
                    .collect::<Result<_>>()?;
            }
            self.current = Some(cursor);
            return Ok(false);
        }
        let cursor = self.current.as_mut().expect("已设置当前游标");
        if let Some(chain) = cursor.chains.pop_front() {
            let state = actor.core("chat.queueState", json!({"sessionId":sid,"chainId":chain}))?;
            cursor.owners.insert(chain.clone(), chain.clone());
            for message in items(&state["messages"])? {
                if let Some(request) = message["requestId"].as_str() {
                    cursor.owners.insert(request.to_owned(), chain.clone());
                } else if cursor.queued_hit.is_none() {
                    cursor.queued_hit = search_text::hit(
                        &self.query,
                        &queue_projection::pending_message(&state, message),
                    );
                }
            }
            return Ok(false);
        }
        if cursor.after as usize >= cursor.extent {
            if let Some(hit) = cursor.queued_hit.take() {
                self.hits.insert(sid.to_owned(), hit);
            }
            return Ok(true);
        }
        let page = actor.core(
            "sessions.historyV2",
            json!({"sessionId":sid,"after":cursor.after,"limit":1}),
        )?;
        for turn in items(&page["turns"])? {
            let messages = if let Some(chain) = turn["requestId"]
                .as_str()
                .and_then(|request| cursor.owners.get(request))
            {
                queue_projection::execution(&json!({"chainId":chain}), turn)["snapshot"]
                    ["sdkMessages"]
                    .take()
            } else {
                projection::history(std::slice::from_ref(turn))["sdkMessages"].take()
            };
            if let Some(hit) = search_text::turn_hit(&self.query, items(&messages)?) {
                self.hits.insert(sid.to_owned(), hit);
                return Ok(true);
            }
        }
        cursor.after = page["nextAfter"]
            .as_u64()
            .filter(|next| *next > cursor.after)
            .ok_or(DesktopError("invalidReply"))?;
        Ok(false)
    }
}
