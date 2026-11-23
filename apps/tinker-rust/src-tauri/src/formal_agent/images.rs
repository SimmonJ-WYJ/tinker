//! 单宿主拥有回环连接；磁盘和 HTTP 工作在可取消的线程执行。actor 统一投递原 SDK 事件。
use super::{actor::Actor, image_projection::project, projection, Reply};
use crate::{
    desktop_runtime::protocol::{id, DesktopError, Result},
    formal_images::{
        ImageAdmission, ImageStatus, ImageStore, ImageTurn, ImportedImage, LoopbackImageProvider,
    },
};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, VecDeque},
    net::SocketAddr,
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread::{self, JoinHandle},
};

pub(super) struct ImageWorkflow {
    pub store: ImageStore,
    provider: LoopbackImageProvider,
    jobs: BTreeMap<String, Job>,
    deliveries: BTreeMap<String, VecDeque<(&'static str, Value)>>,
}
struct Job {
    id: String,
    started: u64,
    cancel: Arc<AtomicBool>,
    worker: JoinHandle<Result<ImageTurn>>,
    replies: Vec<Reply>,
}
impl ImageWorkflow {
    pub fn open(path: &Path, endpoint: SocketAddr) -> Result<Self> {
        Ok(Self {
            store: ImageStore::open(path)?,
            provider: LoopbackImageProvider::new(endpoint)?,
            jobs: BTreeMap::new(),
            deliveries: BTreeMap::new(),
        })
    }
    pub fn has_delivery(&self, sid: &str) -> bool {
        self.deliveries.contains_key(sid)
    }
    pub fn contains_request(&self, sid: &str, id: &str) -> Result<bool> {
        Ok(self.store.history(sid)?.iter().any(|t| t.request_id == id))
    }
    pub fn merge_history(&self, sid: &str, history: &mut Value) -> Result<()> {
        let (turns, imports) = self.store.snapshot(sid)?;
        Self::merge_turns(sid, history, &turns, &imports)
    }
    fn merge_turns(
        sid: &str,
        history: &mut Value,
        turns: &[ImageTurn],
        imports: &[ImportedImage],
    ) -> Result<()> {
        if turns.is_empty() {
            return Ok(());
        }
        for t in turns {
            let (plain, sdk) = project(sid, t, turns, imports);
            history["messages"]
                .as_array_mut()
                .ok_or(DesktopError("invalidReply"))?
                .extend(plain);
            history["sdkMessages"]
                .as_array_mut()
                .ok_or(DesktopError("invalidReply"))?
                .extend(sdk);
        }
        for (key, time) in [("messages", "createdAt"), ("sdkMessages", "_createdAt")] {
            history[key]
                .as_array_mut()
                .ok_or(DesktopError("invalidReply"))?
                .sort_by_key(|m| m[time].as_u64().unwrap_or(0));
        }
        Ok(())
    }
    fn abort(job: Job) {
        job.cancel.store(true, Ordering::Release);
        let _ = job.worker.join();
        for reply in job.replies {
            let _ = reply.send(Err(DesktopError("hostClosed")));
        }
    }
    pub fn active(&self, sid: &str) -> Option<Value> {
        let job = self.jobs.get(sid)?;
        let identity = json!({"sessionId":sid,"requestId":job.id,"startedAt":job.started});
        Some(
            json!({"sessionId":sid,"requestId":job.id,"startedAt":job.started,"cursor":0,
     "currentSnapshot":projection::stream(&identity,json!({"kind":"asci_event","event":{"type":"text_snapshot","text":"","model":"local-image"}}))}),
        )
    }
    pub fn active_runs(&self) -> Vec<Value> {
        self.jobs.keys().filter_map(|s| self.active(s)).collect()
    }
}
impl Drop for ImageWorkflow {
    fn drop(&mut self) {
        for job in self.jobs.values() {
            job.cancel.store(true, Ordering::Release);
        }
        for (_, job) in std::mem::take(&mut self.jobs) {
            Self::abort(job);
        }
    }
}
impl Actor {
    pub fn interrupt_images(&mut self) {
        if let Some(images) = &self.images {
            for job in images.jobs.values() {
                job.cancel.store(true, Ordering::Release);
            }
        }
    }
    pub fn drain_images(&mut self) {
        self.interrupt_images();
        if let Some(i) = &mut self.images {
            for (_, job) in std::mem::take(&mut i.jobs) {
                ImageWorkflow::abort(job);
            }
        }
    }
    pub fn finish_image_before_delete(&mut self, sid: &str) {
        if let Some(images) = &mut self.images {
            images.deliveries.remove(sid);
            if let Some(job) = images.jobs.remove(sid) {
                ImageWorkflow::abort(job);
            }
        }
    }
    pub fn stop_session_image(&self, sid: &str, expected: Option<&str>) -> Result<()> {
        if let Some(images) = &self.images {
            if let Some(job) = images
                .jobs
                .get(sid)
                .filter(|j| expected.is_none_or(|id| j.id == id))
            {
                images.store.stop(sid, &job.id, &job.cancel)?;
            }
        }
        Ok(())
    }
    /// 用接纳时的文字绑定身份确认跨类型顺序。没有因果证据的旧混排仍可浏览。
    pub(super) fn latest_retryable_task(&self, sid: &str) -> Result<Option<String>> {
        use crate::session_lifecycle::RunStatus;
        let text = self.runtime.latest_text_task(sid)?;
        let images = self.images.as_ref().ok_or(DesktopError("unsupported"))?;
        let image = images.store.latest_task(sid)?;
        let latest = if let Some(image) = image {
            if image.text_head_at_admission.is_none() {
                return Ok(None);
            }
            if self
                .runtime
                .image_follows_text(sid, text.as_ref(), &image)?
            {
                Some((image.request_id, image.status))
            } else {
                text.map(|t| (t.request_id, t.status))
            }
        } else {
            text.map(|t| (t.request_id, t.status))
        };
        Ok(latest.and_then(|(request, status)| {
            matches!(status, RunStatus::Failed | RunStatus::Interrupted).then_some(request)
        }))
    }
    pub fn image_busy(&self, sid: &str) -> bool {
        self.images
            .as_ref()
            .is_some_and(|i| i.jobs.contains_key(sid))
    }
    pub fn reusable_image_aware_draft(
        &self,
        original: Value,
        profile: &str,
        workspace: Option<&str>,
    ) -> Result<Value> {
        let images = self.images.as_ref().ok_or(DesktopError("unsupported"))?;
        let occupied = |s: &str| -> Result<bool> {
            if images.jobs.contains_key(s) {
                return Ok(true);
            }
            let (turns, imports) = images.store.snapshot(s)?;
            Ok(!turns.is_empty() || !imports.is_empty())
        };
        if !occupied(
            original["sessionId"]
                .as_str()
                .ok_or(DesktopError("invalidReply"))?,
        )? {
            return Ok(original);
        }
        for session in self.sessions()? {
            let sid = session["sessionId"]
                .as_str()
                .ok_or(DesktopError("invalidReply"))?;
            if session["importError"].is_null()
                && session["profileId"] == profile
                && session["workspaceId"].as_str() == workspace
                && session["archived"] == false
                && self.runtime.history_extent(sid)? == 0
                && !occupied(sid)?
            {
                return Ok(session);
            }
        }
        self.core(
            "sessions.create",
            json!({"title":"","profileId":profile,"workspaceId":workspace,"reuseDraft":false}),
        )
    }
    pub fn send_image(
        &mut self,
        input: &Value,
        sid: &str,
        request: &str,
        started: u64,
        retry_of: Option<&str>,
        reply: &Reply,
    ) -> Result<Option<Value>> {
        id(request)?;
        let action = input["nativeImageAction"]
            .as_str()
            .ok_or(DesktopError("invalidParams"))?;
        let selected = input
            .get("imageEditReferenceId")
            .map(|v| v.as_str().ok_or(DesktopError("invalidParams")))
            .transpose()?;
        if !matches!(action, "edit" | "generate") || action == "generate" && selected.is_some() {
            return Err(DesktopError("invalidParams"));
        }
        let prompt = input["userMessage"]
            .as_str()
            .ok_or(DesktopError("invalidParams"))?;
        let text_turns = self.turns(sid)?;
        if text_turns.iter().any(|t| t["requestId"] == request) {
            return Err(DesktopError("requestConflict"));
        }
        let text_head = self.runtime.latest_text_task(sid)?;
        let images = self.images.as_mut().ok_or(DesktopError("unsupported"))?;
        let (turns, imports) = images.store.snapshot(sid)?;
        let existing = turns.iter().find(|t| t.request_id == request);
        let base = if action == "edit" {
            let base = selected
                .or_else(|| existing.and_then(|t| t.base_image_id.as_deref()))
                .or_else(|| {
                    turns
                        .iter()
                        .rev()
                        .find_map(|t| t.asset.as_ref().map(|a| a.id.as_str()))
                })
                .ok_or(DesktopError("imageNotFound"))?;
            Some(base.to_owned())
        } else {
            None
        };
        if existing.is_none() {
            if self
                .entries
                .get(sid)
                .is_some_and(|e| projection::active(&e.turn))
                || images.jobs.contains_key(sid)
            {
                return Err(DesktopError("runBusy"));
            }
            let available = self.platform.availability()?;
            let enabled = if retry_of.is_some() {
                // 原图片服务固定由宿主控制，旧收据没有用于文字聊天的 UI 模型选择。
                available
                    .get(crate::formal_platform::MOCK_PROFILE_ID)
                    .is_some_and(|models| !models.is_empty())
            } else {
                let channel = input["channelId"]
                    .as_str()
                    .ok_or(DesktopError("invalidParams"))?;
                let model = input["modelId"]
                    .as_str()
                    .ok_or(DesktopError("invalidParams"))?;
                available
                    .get(channel)
                    .is_some_and(|models| models.contains(model))
            };
            if !enabled {
                return Err(DesktopError("modelUnavailable"));
            }
            if images.jobs.len() >= crate::desktop_runtime::protocol::MAX_ACTIVE
                || images.deliveries.contains_key(sid)
            {
                return Err(DesktopError("hostBusy"));
            }
            let mut history = projection::text_task_history(&text_turns);
            ImageWorkflow::merge_turns(sid, &mut history, &turns, &imports)?;
            let bytes = serde_json::to_vec(&history)
                .map_err(|_| DesktopError("invalidReply"))?
                .len();
            reserve_restore_capacity(bytes, prompt)?;
        }
        let pending = match images.store.admit(
            sid,
            request,
            prompt,
            base.as_deref(),
            started,
            retry_of,
            text_head.as_ref().map(|t| t.request_id.as_str()),
        )? {
            ImageAdmission::Replay(turn) => {
                if let Some(job) = images.jobs.get_mut(sid).filter(|j| j.id == request) {
                    if job.replies.len() >= 32 {
                        return Err(DesktopError("hostBusy"));
                    }
                    job.replies.push(reply.clone());
                    return Ok(None);
                }
                return terminal_result(&turn).map(Some);
            }
            ImageAdmission::New(pending) => pending,
        };
        let (_, messages) = project(sid, pending.turn(), &turns, &imports);
        let identity = json!({"sessionId":sid,"requestId":request,"startedAt":started});
        let cancel = Arc::new(AtomicBool::new(false));
        let provider = images.provider.clone();
        let token = cancel.clone();
        let worker = thread::Builder::new()
            .name("native-image".into())
            .spawn(move || pending.execute(&provider, &token))
            .map_err(|_| DesktopError("hostUnavailable"))?;
        images.jobs.insert(
            sid.into(),
            Job {
                id: request.into(),
                started,
                cancel,
                worker,
                replies: vec![reply.clone()],
            },
        );
        images.deliveries.insert(
            sid.into(),
            messages
                .into_iter()
                .map(|message| {
                    (
                        "agent:stream:event",
                        projection::stream(
                            &identity,
                            json!({"kind":"sdk_message","message":message}),
                        ),
                    )
                })
                .collect(),
        );
        Ok(None)
    }
    pub fn poll_images(&mut self) {
        if let Some(mut images) = self.images.take() {
            images.deliver_finished(self);
            self.images = Some(images);
        }
    }
}
fn terminal_result(turn: &ImageTurn) -> Result<Value> {
    match (&turn.status, &turn.asset) {
        (ImageStatus::Succeeded, Some(asset)) => Ok(json!({"value":null,"imageId":asset.id})),
        _ if turn.user_stopped() => Ok(json!({"value":null})),
        _ => Err(DesktopError("responseFailed")),
    }
}
// 一份用户文本投影至普通消息、SDK 用户消息和工具输入各一次。固定余量覆盖
// UUID、两张图片的元数据、嵌套工具结果以及 restore 外层，图片字节不进历史消息。
fn reserve_restore_capacity(history_bytes: usize, prompt: &str) -> Result<()> {
    let escaped = serde_json::to_vec(prompt)
        .map_err(|_| DesktopError("invalidParams"))?
        .len();
    if history_bytes
        .saturating_add(escaped.saturating_mul(3))
        .saturating_add(16 * 1024)
        > super::actor::MAX_FORMAL_REPLY
    {
        return Err(DesktopError("historyLimit"));
    }
    Ok(())
}
#[cfg(test)]
mod capacity_tests {
    use super::*;
    #[test]
    fn escaped_image_prompt_reserves_each_copy_before_any_network_write() {
        let prompt = "\u{1}".repeat(8192);
        assert!(reserve_restore_capacity(0, &prompt).is_ok());
        assert_eq!(
            reserve_restore_capacity(super::super::actor::MAX_FORMAL_REPLY - 100 * 1024, &prompt),
            Err(DesktopError("historyLimit"))
        );
    }
}
mod delivery;
