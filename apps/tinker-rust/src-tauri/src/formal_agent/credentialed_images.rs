//! 仅显式图片发送可创建准备槽。读凭据在锁外执行，接纳前由 actor 再核对绑定。
use super::{actor::Actor, credentialed::Credentialed, Reply};
use crate::{
    credentialed_channels::{catalog::ConnectionRevision, vault::CredentialBinding, worker},
    desktop_runtime::protocol::{DesktopError, Result},
    formal_images::{CredentialedImageProvider, ImageAction, ImageProtocol, ImageRoute},
};
use serde_json::{json, Value};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread::JoinHandle,
};

#[derive(PartialEq)]
pub(super) struct ImageCommand {
    pub session: String,
    pub request: String,
    pub started: u64,
    pub retry_of: Option<String>,
    pub input: Value,
}
pub(super) struct AuthorizedImage {
    pub route: ImageRoute,
    pub provider: CredentialedImageProvider,
}
pub(super) struct Preparation {
    command: ImageCommand,
    route: ImageRoute,
    generation: String,
    cancelled: Arc<AtomicBool>,
    worker: Option<JoinHandle<Result<CredentialedImageProvider>>>,
    replies: Vec<Reply>,
}
impl Drop for Preparation {
    fn drop(&mut self) {
        self.cancelled.store(true, Ordering::Release);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
        for reply in self.replies.drain(..) {
            let _ = reply.send(Err(DesktopError("hostClosed")));
        }
    }
}
impl Credentialed {
    pub(super) fn image_route(
        &self,
        channel: &str,
        model: &str,
        action: ImageAction,
    ) -> Result<(ImageRoute, ConnectionRevision)> {
        let catalog = self.platform.image_catalog()?;
        let version = catalog
            .image_revision(channel, model, action == ImageAction::Edit)?
            .clone();
        let route = ImageRoute {
            channel_id: channel.into(),
            model_id: model.into(),
            revision: version.id.clone(),
            protocol: ImageProtocol::OpenaiImages,
            action,
        };
        Ok((route, version))
    }
    pub(super) fn prepare_image(
        &mut self,
        command: ImageCommand,
        route: ImageRoute,
        connection: ConnectionRevision,
        generation: &str,
        reply: &Reply,
    ) -> Result<Option<Value>> {
        if let Some(p) = &mut self.image_preparation {
            if p.command.session == command.session && p.command.request == command.request {
                if p.command != command || p.route != route {
                    return Err(DesktopError("requestConflict"));
                }
                if !p.cancelled.load(Ordering::Acquire) && p.replies.len() < 32 {
                    p.replies.push(reply.clone());
                    return Ok(None);
                }
            }
            return Err(DesktopError("hostBusy"));
        }
        let scope = self.platform.vault_scope();
        let vault = self.vault.clone();
        let known = self.known.clone();
        let policy = self.policy.clone();
        let model = route.model_id.clone();
        let protected = json!({"input":command.input,"session":command.session,"request":command.request,"source":command.retry_of,"route":route,"revision":connection});
        let cancel = Arc::new(AtomicBool::new(false));
        let token = cancel.clone();
        let thread = std::thread::Builder::new()
            .name("image-route-prepare".into())
            .spawn(move || {
                worker::guard(&protected, &known)?;
                let key = vault.acquire_bound_cancellable(
                    &scope,
                    &connection.credential_ref,
                    &CredentialBinding::new(&scope, &connection.channel),
                    &token,
                )?;
                if token.load(Ordering::Acquire) {
                    return Err(DesktopError("staleGeneration"));
                }
                let key = Arc::new(key);
                worker::remember(&known, connection.credential_ref.clone(), key.clone())?;
                worker::guard(&protected, &known)?;
                Ok(CredentialedImageProvider::new(
                    policy,
                    connection.channel.base_url,
                    model,
                    key,
                ))
            })
            .map_err(|_| DesktopError("hostUnavailable"))?;
        self.image_preparation = Some(Preparation {
            command,
            route,
            generation: generation.into(),
            cancelled: cancel,
            worker: Some(thread),
            replies: vec![reply.clone()],
        });
        Ok(None)
    }
}
impl Actor {
    pub(super) fn cancel_image_preparation(&mut self, sid: Option<&str>, expected: Option<&str>) {
        if let Some(p) = self
            .credentialed
            .as_mut()
            .and_then(|c| c.image_preparation.as_mut())
            .filter(|p| {
                sid.is_none_or(|s| s == p.command.session)
                    && expected.is_none_or(|r| r == p.command.request)
            })
        {
            p.cancelled.store(true, Ordering::Release);
            for reply in p.replies.drain(..) {
                let _ = reply.send(Err(DesktopError("staleGeneration")));
            }
        }
    }
    pub(super) fn preparing_image(&self, sid: &str) -> bool {
        self.credentialed
            .as_ref()
            .and_then(|c| c.image_preparation.as_ref())
            .is_some_and(|p| p.command.session == sid)
    }
    pub(super) fn poll_image_preparation(&mut self) {
        let Some(managed) = &mut self.credentialed else {
            return;
        };
        if !managed
            .image_preparation
            .as_ref()
            .and_then(|p| p.worker.as_ref())
            .is_some_and(|w| w.is_finished())
        {
            return;
        }
        let mut p = managed.image_preparation.take().expect("准备完成");
        let outcome = p
            .worker
            .take()
            .expect("准备线程")
            .join()
            .unwrap_or(Err(DesktopError("hostUnavailable")));
        let mut replies = std::mem::take(&mut p.replies).into_iter();
        let Some(first) = replies.next() else { return };
        let cmd = &p.command;
        let outcome = outcome.and_then(|provider| {
            if p.cancelled.load(Ordering::Acquire) || p.generation != self.generation {
                return Err(DesktopError("staleGeneration"));
            }
            if self.draining || !self.gate.allows_send() {
                return Err(DesktopError("closing"));
            }
            self.session(&cmd.session)?;
            self.send_image_ready(
                &cmd.input,
                &cmd.session,
                &cmd.request,
                cmd.started,
                cmd.retry_of.as_deref(),
                Some(AuthorizedImage {
                    route: p.route.clone(),
                    provider,
                }),
                &first,
            )
        });
        match outcome {
            Ok(None) => self.images.as_mut().expect("图片宿主").join_replies(
                &cmd.session,
                &cmd.request,
                replies,
            ),
            value => {
                let result = value.and_then(|v| v.ok_or(DesktopError("invalidReply")));
                for reply in std::iter::once(first).chain(replies) {
                    let _ = reply.send(result.clone());
                }
            }
        }
    }
}
