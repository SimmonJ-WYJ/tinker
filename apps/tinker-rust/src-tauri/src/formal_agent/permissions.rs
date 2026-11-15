//! 原权限 API 精确归属到持久 run；已解决 ID 仍能幂等重试，不猜当前会话。
use super::{actor::Actor, tool_projection};
use crate::desktop_runtime::protocol::{DesktopError, Result};
use serde::Deserialize;
use serde_json::{json, Value};
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Response {
    request_id: String,
    behavior: String,
    always_allow: bool,
}
impl Actor {
    pub fn register_permissions(&mut self, turn: &Value) -> Result<()> {
        let sid = turn["sessionId"]
            .as_str()
            .ok_or(DesktopError("invalidReply"))?;
        let run = turn["runId"].as_str().ok_or(DesktopError("invalidReply"))?;
        if let Some(messages) = turn["toolState"]["transcript"]["messages"].as_array() {
            for m in messages {
                if m["kind"] == "assistant" && !m["call"].is_null() {
                    let round = m["round"].as_u64().ok_or(DesktopError("invalidReply"))?;
                    let id = format!("p-{run}-{round}");
                    let owner = (sid.to_owned(), run.to_owned());
                    if self
                        .permission_owners
                        .get(&id)
                        .is_some_and(|old| old != &owner)
                    {
                        return Err(DesktopError("invalidReply"));
                    }
                    self.permission_owners.insert(id, owner);
                }
            }
        }
        Ok(())
    }
    fn permission_owner(&mut self, id: &str) -> Result<(String, String)> {
        if let Some(owner) = self.permission_owners.get(id) {
            return Ok(owner.clone());
        }
        // 进程重启后按持久 transcript 建立历史归属；已解决的 ID 不随 pending 出队删除。
        let sessions = self.core("sessions.list", json!({}))?;
        for s in sessions["sessions"]
            .as_array()
            .ok_or(DesktopError("invalidReply"))?
        {
            let sid = s["sessionId"]
                .as_str()
                .ok_or(DesktopError("invalidReply"))?;
            for turn in self.turns(sid)? {
                self.register_permissions(&turn)?;
                if let Some(owner) = self.permission_owners.get(id) {
                    return Ok(owner.clone());
                }
            }
        }
        Err(DesktopError("permissionNotFound"))
    }

    pub fn pending_requests(&self, session: Option<&str>) -> Result<Value> {
        let sessions = self.core("sessions.list", json!({}))?;
        if let Some(sid) = session {
            if !sessions["sessions"]
                .as_array()
                .is_some_and(|ss| ss.iter().any(|s| s["sessionId"] == sid))
            {
                return Err(DesktopError("sessionNotFound"));
            }
        }
        let mut permissions = Vec::new();
        for s in sessions["sessions"]
            .as_array()
            .ok_or(DesktopError("invalidReply"))?
        {
            let sid = s["sessionId"]
                .as_str()
                .ok_or(DesktopError("invalidReply"))?;
            if session.is_some_and(|v| v != sid) {
                continue;
            }
            for turn in self.turns(sid)? {
                let pending = &turn["toolState"]["pending"];
                if !pending.is_null() {
                    permissions.push(tool_projection::permission(&turn, pending));
                }
            }
        }
        Ok(json!({"permissions":permissions,"askUsers":[],"exitPlans":[]}))
    }
    pub fn permission_response(&mut self, value: Value) -> Result<Value> {
        self.gate.expire();
        if !self.gate.allows_send() {
            return Err(DesktopError("closing"));
        }
        let response: Response =
            serde_json::from_value(value).map_err(|_| DesktopError("invalidParams"))?;
        if response.always_allow || !matches!(response.behavior.as_str(), "allow" | "deny") {
            return Err(DesktopError("unsupported"));
        }
        let (sid, run) = self.permission_owner(&response.request_id)?;
        self.core("chat.permissionRespond",json!({"sessionId":sid,"runId":run,"permissionId":response.request_id,"behavior":response.behavior,"alwaysAllow":false}))?;
        self.poll();
        Ok(Value::Null)
    }
}
