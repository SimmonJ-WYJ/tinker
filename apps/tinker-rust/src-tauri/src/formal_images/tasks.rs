//! 图片任务的接纳、持久收据与终态互斥。原 v1 账本仍是图片及执行结果的唯一来源。
use super::*;

#[derive(Clone, Debug)]
pub(crate) struct ImageTaskSummary {
    pub request_id: String,
    pub status: RunStatus,
    pub created_at: u64,
    pub is_edit: bool,
    pub text_head_at_admission: Option<Option<String>>,
}
impl ImageTurn {
    pub(crate) fn route(&self) -> Option<&ImageRoute> {
        self.route.as_ref()
    }
    pub(crate) fn user_stopped(&self) -> bool {
        self.status == ImageStatus::Failed && self.error.as_deref() == Some("imageCancelled")
    }
    pub(crate) fn task_status(&self) -> RunStatus {
        match self.status {
            ImageStatus::Pending => RunStatus::Running,
            ImageStatus::Succeeded => RunStatus::Completed,
            ImageStatus::Failed if self.user_stopped() => RunStatus::Cancelled,
            ImageStatus::Failed => RunStatus::Failed,
            ImageStatus::Interrupted => RunStatus::Interrupted,
        }
    }
}

pub(crate) enum ImageAdmission {
    Replay(ImageTurn),
    New(PendingImage),
}
pub(crate) struct PendingImage {
    store: ImageStore,
    sid: String,
    pending: ImageTurn,
    reference: Option<Vec<u8>>,
}

// 只保存 v1 无法表示的接纳因果，不复制正文、图片和执行状态。
// 两分区的游标还可识别旧版本回退后追加的记录。
const ORDER: &str = "task-order.json";
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Admission {
    request: String,
    text_head: Option<String>,
    retry_of: Option<String>,
    original: usize,
    derived: usize,
    in_derived: bool,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Order {
    version: u32,
    admissions: Vec<Admission>,
}
impl Order {
    fn read(dir: &Path, images: &SessionImages) -> Result<Self> {
        let Some(bytes) = disk::read_index(dir, ORDER)? else {
            return Ok(Self {
                version: 1,
                admissions: vec![],
            });
        };
        let mut order: Self =
            serde_json::from_slice(&bytes).map_err(|_| DesktopError("corruptImages"))?;
        if order.version != 1 {
            return Err(DesktopError("unsupportedVersion"));
        }
        if order.admissions.len() > LIMIT {
            return Err(DesktopError("corruptImages"));
        }
        // 崩溃可以只留下已经同步的最后一个接纳意图；只有 v1 承诺了该请求才可展示或重放。
        if order.admissions.last().is_some_and(|a| {
            !images
                .original
                .iter()
                .chain(&images.derived)
                .any(|t| t.request_id == a.request)
        }) {
            order.admissions.pop();
        }
        let mut prev = (0, 0);
        let mut seen = HashSet::new();
        for a in &order.admissions {
            let target = if a.in_derived {
                images.derived.get(a.derived.saturating_sub(1))
            } else {
                images.original.get(a.original.saturating_sub(1))
            };
            if id(&a.request).is_err()
                || !seen.insert(a.request.as_str())
                || a.original > images.original.len()
                || a.derived > images.derived.len()
                || a.original < prev.0
                || a.derived < prev.1
                || (if a.in_derived {
                    a.derived <= prev.1
                } else {
                    a.original <= prev.0
                })
                || target.is_none_or(|t| t.request_id != a.request)
                || a.text_head.as_deref().is_some_and(|v| id(v).is_err())
            {
                return Err(DesktopError("corruptImages"));
            }
            if let Some(source) = &a.retry_of {
                let target = target.ok_or(DesktopError("corruptImages"))?;
                let earlier = images.original[..a.original]
                    .iter()
                    .chain(&images.derived[..a.derived]);
                if !earlier.into_iter().any(|t| {
                    t.request_id == *source
                        && t.request_id != target.request_id
                        && t.prompt == target.prompt
                        && t.base_image_id == target.base_image_id
                        && (matches!(t.status, ImageStatus::Interrupted | ImageStatus::Pending)
                            || t.status == ImageStatus::Failed && !t.user_stopped())
                }) {
                    return Err(DesktopError("corruptImages"));
                }
            }
            prev = (a.original, a.derived);
        }
        Ok(order)
    }
    fn latest<'a>(&self, imgs: &'a SessionImages) -> Option<&'a ImageTurn> {
        if let Some(last) = imgs.routed.entries.last() {
            if last.original == imgs.original.len() && last.derived == imgs.derived.len() {
                return Some(&last.turn);
            }
        }
        let previous = self.admissions.last();
        let (mut o, mut d) = previous.map_or((0, 0), |a| (a.original, a.derived));
        if let Some(last) = imgs.routed.entries.last() {
            o = o.max(last.original);
            d = d.max(last.derived);
        }
        imgs.original[o..]
            .last()
            .into_iter()
            .chain(imgs.derived[d..].last())
            .max_by_key(|t| t.created_at)
            .or_else(|| previous.and_then(|a| imgs.turns().find(|t| t.request_id == a.request)))
    }
    fn meta(&self, request: &str) -> Option<&Admission> {
        self.admissions.iter().find(|a| a.request == request)
    }
    fn retry_of<'a>(&'a self, imgs: &'a SessionImages, request: &str) -> Option<&'a str> {
        imgs.routed
            .get(request)
            .and_then(|e| e.retry_of.as_deref())
            .or_else(|| self.meta(request).and_then(|a| a.retry_of.as_deref()))
    }
    fn retry_source<'a>(
        &self,
        imgs: &'a SessionImages,
        active: &Active,
        session: &str,
        source: &str,
        new_id: &str,
    ) -> Result<&'a ImageTurn> {
        let origin = imgs
            .turns()
            .find(|t| t.request_id == source)
            .ok_or(DesktopError("requestConflict"))?;
        let retryable = matches!(
            origin.task_status(),
            RunStatus::Failed | RunStatus::Interrupted
        ) || origin.status == ImageStatus::Pending
            && !active.requests.contains(&(session.into(), source.into()));
        if !retryable
            || source == new_id
            || if imgs.turns().any(|t| t.request_id == new_id) {
                self.retry_of(imgs, new_id) != Some(source)
            } else {
                self.latest(imgs).is_none_or(|t| t.request_id != source)
            }
        {
            return Err(DesktopError("requestConflict"));
        }
        Ok(origin)
    }
}

impl ImageStore {
    pub(crate) fn latest_task(&self, session: &str) -> Result<Option<ImageTaskSummary>> {
        let dir = self.session(session)?;
        let mut active = self.guard()?;
        if let Some(value) = active.summaries.get(session) {
            return Ok(value.clone());
        }
        let images = SessionImages::open(&dir, session)?;
        let order = Order::read(&dir, &images)?;
        let summary = order.latest(&images).map(|t| {
            let t = self.recovered(&active, session, t.clone());
            ImageTaskSummary {
                text_head_at_admission: images
                    .routed
                    .get(&t.request_id)
                    .map(|e| e.text_head.clone())
                    .or_else(|| order.meta(&t.request_id).map(|a| a.text_head.clone())),
                request_id: t.request_id.clone(),
                created_at: t.created_at,
                is_edit: t.base_image_id.is_some(),
                status: t.task_status(),
            }
        });
        if active.summaries.len() >= LIMIT {
            active.summaries.clear();
        }
        active.summaries.insert(session.into(), summary.clone());
        Ok(summary)
    }
    pub(crate) fn retry_source(
        &self,
        session: &str,
        source: &str,
        new_id: &str,
    ) -> Result<ImageTurn> {
        id(source)?;
        id(new_id)?;
        let dir = self.session(session)?;
        let active = self.guard()?;
        let images = SessionImages::open(&dir, session)?;
        let order = Order::read(&dir, &images)?;
        Ok(self.recovered(
            &active,
            session,
            order
                .retry_source(&images, &active, session, source, new_id)?
                .clone(),
        ))
    }
    pub(crate) fn route_for(&self, session: &str, request: &str) -> Result<Option<ImageRoute>> {
        let dir = self.session(session)?;
        id(request)?;
        let _state = self.guard()?;
        Ok(SessionImages::open(&dir, session)?
            .routed
            .get(request)
            .map(|e| e.route.clone()))
    }
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn admit(
        &self,
        session: &str,
        request: &str,
        prompt: &str,
        base: Option<&str>,
        created_at: u64,
        retry_of: Option<&str>,
        text_head: Option<&str>,
    ) -> Result<ImageAdmission> {
        self.admit_bound(
            session, request, prompt, base, created_at, retry_of, text_head, None,
        )
    }
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn admit_routed(
        &self,
        session: &str,
        request: &str,
        prompt: &str,
        base: Option<&str>,
        created_at: u64,
        retry_of: Option<&str>,
        text_head: Option<&str>,
        route: &ImageRoute,
    ) -> Result<ImageAdmission> {
        route.validate(base)?;
        self.admit_bound(
            session,
            request,
            prompt,
            base,
            created_at,
            retry_of,
            text_head,
            Some(route),
        )
    }
    #[allow(clippy::too_many_arguments)]
    fn admit_bound(
        &self,
        session: &str,
        request: &str,
        prompt: &str,
        base: Option<&str>,
        created_at: u64,
        retry_of: Option<&str>,
        text_head: Option<&str>,
        route: Option<&ImageRoute>,
    ) -> Result<ImageAdmission> {
        let dir = self.session(session)?;
        id(request)?;
        if let Some(head) = text_head {
            id(head)?;
        }
        if !valid_prompt(prompt) || created_at > MAX_SAFE_INTEGER {
            return Err(DesktopError("invalidImageInput"));
        }
        let mut guard = self.guard()?;
        let mut imgs = SessionImages::open(&dir, session)?;
        let mut order = Order::read(&dir, &imgs)?;
        if let Some(source) = retry_of {
            let original = order.retry_source(&imgs, &guard, session, source, request)?;
            if original.prompt != prompt
                || original.base_image_id.as_deref() != base
                || original.route() != route
            {
                return Err(DesktopError("imageRequestConflict"));
            }
        }
        if let Some(existing) = imgs.turns().find(|t| t.request_id == request) {
            if existing.prompt != prompt
                || existing.base_image_id.as_deref() != base
                || existing.created_at != created_at
                || order.retry_of(&imgs, request) != retry_of
                || existing.route() != route
            {
                return Err(DesktopError("imageRequestConflict"));
            }
            return Ok(ImageAdmission::Replay(self.recovered(
                &guard,
                session,
                existing.clone(),
            )));
        }
        if guard.requests.iter().any(|(sid, _)| sid == session) {
            return Err(DesktopError("runBusy"));
        }
        if imgs.turns().count() >= LIMIT {
            return Err(DesktopError("imageLimit"));
        }
        let (reference, derived) = if let Some(base) = base {
            if route.is_none()
                && imgs
                    .routed
                    .entries
                    .iter()
                    .any(|e| e.turn.asset.as_ref().is_some_and(|a| a.id == base))
            {
                return Err(DesktopError("imageRequestConflict"));
            }
            let (_, name, hash, derived) = imgs
                .sources()
                .find(|(id, _, _, _)| *id == base)
                .ok_or(DesktopError("imageNotFound"))?;
            (Some(disk::png(&dir, name, hash)?), derived)
        } else {
            (None, false)
        };
        let pending = ImageTurn {
            admitted_locally: false,
            route: route.cloned(),
            request_id: request.into(),
            prompt: prompt.into(),
            base_image_id: base.map(str::to_owned),
            created_at,
            status: ImageStatus::Pending,
            asset: None,
            error: None,
        };
        disk::private_dir(&dir)?;
        // Reserve one maximum-size answer before the provider may be contacted.
        disk::asset_budget(&dir, MAX_PNG)?;
        guard.summaries.remove(session);
        if let Some(route) = route {
            local_admissions::record_boundary(&dir, session, &imgs.routed.entries);
            imgs.routed.entries.push(routes::RoutedEntry {
                turn: pending.clone(),
                route: route.clone(),
                retry_of: retry_of.map(str::to_owned),
                text_head: text_head.map(str::to_owned),
                original: imgs.original.len(),
                derived: imgs.derived.len(),
            });
            imgs.routed.save(&dir)?;
        } else {
            imgs.partition(derived).push(pending.clone());
            order.admissions.push(Admission {
                request: request.into(),
                text_head: text_head.map(str::to_owned),
                retry_of: retry_of.map(str::to_owned),
                original: imgs.original.len(),
                derived: imgs.derived.len(),
                in_derived: derived,
            });
            // 顺序先落盘，v1 收据作为提交点；任一步返回不确定都不派发网络。
            let data = serde_json::to_vec(&order).map_err(|_| DesktopError("storeIo"))?;
            disk::write_index(&dir, ORDER, &data)?;
            disk::save_turns(&dir, imgs.partition(derived), derived)?;
        }
        guard.requests.insert((session.into(), request.into()));
        Ok(ImageAdmission::New(PendingImage {
            store: self.clone(),
            sid: session.into(),
            pending,
            reference,
        }))
    }
    pub(crate) fn stop(&self, session: &str, request: &str, cancelled: &AtomicBool) -> Result<()> {
        id(request)?;
        let dir = self.session(session)?;
        let mut active = self.guard()?;
        if !active.requests.contains(&(session.into(), request.into())) {
            return Ok(());
        }
        let mut images = SessionImages::open(&dir, session)?;
        let t = images.find_mut(request)?;
        if t.status == ImageStatus::Pending {
            active.summaries.remove(session);
            cancelled.store(true, Ordering::Release);
            t.status = ImageStatus::Failed;
            t.error = Some("imageCancelled".into());
            images.save_for(&dir, request)?;
        }
        Ok(())
    }
}
impl PendingImage {
    pub(crate) fn turn(&self) -> &ImageTurn {
        &self.pending
    }
    pub(crate) fn execute(
        self,
        provider: &LoopbackImageProvider,
        cancelled: &AtomicBool,
    ) -> Result<ImageTurn> {
        if self.pending.route().is_some() {
            return Err(DesktopError("imageRequestConflict"));
        }
        self.run(cancelled, |prompt, reference, flag| {
            provider.request(prompt, reference, flag)
        })
    }
    pub(crate) fn execute_with(
        self,
        cancelled: &AtomicBool,
        send: impl FnOnce(&str, Option<(&str, Vec<u8>)>, &AtomicBool) -> Result<(Vec<u8>, u32, u32)>,
    ) -> Result<ImageTurn> {
        if self.pending.route().is_none() {
            return Err(DesktopError("imageRequestConflict"));
        }
        self.run(cancelled, send)
    }
    fn run(
        self,
        cancelled: &AtomicBool,
        send: impl FnOnce(&str, Option<(&str, Vec<u8>)>, &AtomicBool) -> Result<(Vec<u8>, u32, u32)>,
    ) -> Result<ImageTurn> {
        let mut job = self;
        let reference = job
            .pending
            .base_image_id
            .as_deref()
            .zip(job.reference.take());
        let result = if cancelled.load(Ordering::Acquire) {
            Err(DesktopError("imageInterrupted"))
        } else {
            send(&job.pending.prompt, reference, cancelled)
        };
        job.finish(result, cancelled)
    }
    pub(super) fn finish(
        self,
        result: Result<(Vec<u8>, u32, u32)>,
        cancelled: &AtomicBool,
    ) -> Result<ImageTurn> {
        let dir = self.store.session(&self.sid)?;
        let mut state = self.store.guard()?;
        state.summaries.remove(&self.sid);
        let mut images = SessionImages::open(&dir, &self.sid)?;
        let turn = images.find_mut(&self.pending.request_id)?;
        if turn.status != ImageStatus::Pending {
            return Ok(turn.clone());
        }
        if cancelled.load(Ordering::Acquire)
            || matches!(result, Err(DesktopError("imageInterrupted")))
        {
            turn.status = ImageStatus::Interrupted;
        } else {
            let stored = result.and_then(|(bytes, width, height)| {
                let id = image_id(&self.sid, &turn.request_id);
                let filename = format!("{id}.png");
                if bytes.len() > MAX_PNG {
                    return Err(DesktopError("imageTooLarge"));
                }
                disk::asset_budget(&dir, bytes.len())?;
                disk::put(&dir, &filename, &bytes)?;
                Ok(ImageAsset {
                    id,
                    filename,
                    prompt: turn.prompt.clone(),
                    model: turn
                        .route()
                        .map_or(provider::MODEL, |r| r.model_id.as_str())
                        .into(),
                    channel_id: turn
                        .route()
                        .map_or(provider::CHANNEL, |r| r.channel_id.as_str())
                        .into(),
                    reference_ids: turn.base_image_id.iter().cloned().collect(),
                    base_image_id: turn.base_image_id.clone(),
                    width,
                    height,
                    content_sha256: digest(&bytes),
                })
            });
            match stored {
                Ok(asset) => {
                    turn.status = ImageStatus::Succeeded;
                    turn.asset = Some(asset);
                }
                Err(error) => {
                    turn.status = ImageStatus::Failed;
                    turn.error = Some(error.0.into());
                }
            }
        }
        let receipt = turn.clone();
        if let Err(error) = images.save_for(&dir, &self.pending.request_id) {
            if let Some(asset) = &receipt.asset {
                // rename 后目录同步失败时，收据可能已经可见；仅在重新读取明确仍为 Pending 时移除本次刚写入的像素。
                if SessionImages::open(&dir, &self.sid).is_ok_and(|r| {
                    r.turns().any(|t| {
                        t.request_id == receipt.request_id && t.status == ImageStatus::Pending
                    })
                }) {
                    disk::discard_uncommitted(&dir, asset)?;
                }
            }
            return Err(error);
        }
        Ok(receipt)
    }
}
impl Drop for PendingImage {
    fn drop(&mut self) {
        if let Ok(mut state) = self.store.guard() {
            state
                .requests
                .remove(&(self.sid.clone(), self.pending.request_id.clone()));
            state.summaries.remove(&self.sid);
        }
    }
}
