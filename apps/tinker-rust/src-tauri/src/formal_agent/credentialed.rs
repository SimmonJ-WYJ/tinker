//! 一个锁外准备槽；完成后重查代际、revision和关闭状态，随后才允许Bind或提交。
use super::{actor::Actor, Reply};
use crate::{
    credentialed_channels::{
        catalog::EndpointPolicy,
        vault::{CredentialVault, Secret},
        worker::{self, Known},
    },
    desktop_runtime::{
        protocol::{DesktopError, Result},
        revisions::PreparedProfiles,
    },
    formal_platform::{
        credentialed::{CredentialedPlatform, PreparedMutation},
        protocol::Mutation,
        PlatformRequest,
    },
};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread::JoinHandle,
};
pub(super) struct Credentialed {
    pub platform: Arc<CredentialedPlatform>,
    pub vault: Arc<dyn CredentialVault>,
    pub policy: EndpointPolicy,
    pub known: Known,
    job: Option<Job>,
    pub bypass: bool,
}
struct Job {
    send_owner: Option<(String, Option<String>)>,
    probe: bool,
    generation: String,
    revision: u64,
    cancel: Arc<AtomicBool>,
    reply: Reply,
    rx: mpsc::Receiver<Result<Completion>>,
    thread: JoinHandle<()>,
}
enum Completion {
    Stage(PlatformRequest),
    Mutation(Box<PreparedMutation>, Option<PreparedProfiles>),
    Invoke(String, Vec<Value>, Option<Mutation>, PreparedProfiles),
    Probe(Value),
}
impl Credentialed {
    pub fn new(
        platform: Arc<CredentialedPlatform>,
        vault: Arc<dyn CredentialVault>,
        policy: EndpointPolicy,
    ) -> Self {
        Self {
            platform,
            vault,
            policy,
            known: Arc::new(Mutex::new(BTreeMap::new())),
            job: None,
            bypass: false,
        }
    }
}
impl Actor {
    pub(super) fn needs_credential_work(&self, c: &str, mutation: bool) -> bool {
        self.credentialed.as_ref().is_some_and(|v| !v.bypass)
            && (mutation
                || matches!(
                    c,
                    "channel:stage"
                        | "channel:test"
                        | "channel:test-direct"
                        | "channel:fetch-models"
                        | "agent:send-message"
                        | "agent:create-session"
                        | "agent:get-or-create-draft-session"
                        | "agent:update-title"
                ))
    }
    pub(super) fn start_credential_work(
        &mut self,
        c: &str,
        args: Vec<Value>,
        mutation: Option<Mutation>,
        reply: &Reply,
    ) -> Result<Option<Value>> {
        if c == "agent:send-message" {
            if let (Some(sid), Some(rid)) = (
                args.first().and_then(|a| a["sessionId"].as_str()),
                args.first().and_then(|a| a["requestId"].as_str()),
            ) {
                if self.turns(sid)?.iter().any(|t| t["requestId"] == rid) {
                    self.credentialed.as_mut().expect("受控宿主").bypass = true;
                    let result = self.invoke(c, args, mutation, reply);
                    self.credentialed.as_mut().expect("受控宿主").bypass = false;
                    return result;
                }
            }
        }
        if !self.gate.allows_send() {
            return Err(DesktopError("closing"));
        }
        let managed = self
            .credentialed
            .as_mut()
            .ok_or(DesktopError("unsupported"))?;
        if managed.job.is_some() {
            return Err(DesktopError("hostBusy"));
        }
        let platform = managed.platform.clone();
        let vault = managed.vault.clone();
        let known = managed.known.clone();
        let policy = managed.policy.clone();
        let revision = platform.bootstrap()?.revision;
        let generation = self.generation.clone();
        let worker_generation = generation.clone();
        let cancel = Arc::new(AtomicBool::new(false));
        let token = cancel.clone();
        let (tx, rx) = mpsc::sync_channel(1);
        let c = c.to_string();
        let send_owner = if c == "agent:send-message" {
            args.first().and_then(|a| {
                Some((
                    a["sessionId"].as_str()?.to_owned(),
                    a["requestId"].as_str().map(str::to_owned),
                ))
            })
        } else {
            None
        };
        let probe = matches!(
            c.as_str(),
            "channel:test" | "channel:test-direct" | "channel:fetch-models"
        );
        let thread = std::thread::Builder::new()
            .name("channels-prepare".into())
            .spawn(move || {
                let result = (|| {
                    let cancelled = || token.load(Ordering::Acquire);
                    let request = PlatformRequest {
                        version: 1,
                        channel: c.clone(),
                        args: args.clone(),
                        mutation: mutation.clone(),
                    };
                    let prepared = if mutation.is_some() {
                        Some(platform.prepare(request.clone(), &worker_generation)?)
                    } else {
                        None
                    };
                    if prepared.as_ref().is_some_and(|p| p.is_replay()) {
                        return Ok(Completion::Mutation(
                            Box::new(prepared.expect("已有回执")),
                            None,
                        ));
                    }
                    let catalog = platform.catalog()?;
                    // 新执行仅要求选中渠道；其余可读取凭据仍用于防回显，缺失不阻断显式修复。
                    let required = if c == "agent:send-message" {
                        args.first().and_then(|a| a["channelId"].as_str())
                    } else if matches!(
                        c.as_str(),
                        "channel:test" | "channel:test-direct" | "channel:fetch-models"
                    ) {
                        args.first().and_then(Value::as_str)
                    } else {
                        None
                    };
                    let keys = worker::hydrate(
                        &catalog,
                        &platform.vault_scope(),
                        vault.as_ref(),
                        &known,
                        &token,
                        required,
                    )?;
                    if cancelled() {
                        return Err(DesktopError("staleGeneration"));
                    }
                    if c == "channel:stage" {
                        if args.len() != 1 || mutation.is_some() {
                            return Err(DesktopError("invalidParams"));
                        }
                        #[derive(serde::Deserialize)]
                        #[serde(deny_unknown_fields)]
                        struct StageInput {
                            request: PlatformRequest,
                            secret: String,
                        }
                        let input: StageInput = serde_json::from_value(args[0].clone())
                            .map_err(|_| DesktopError("invalidParams"))?;
                        let secret = Secret::new(input.secret.into_bytes())?;
                        worker::guard(
                            &serde_json::to_value(&input.request)
                                .map_err(|_| DesktopError("invalidParams"))?,
                            &known,
                        )?;
                        if known
                            .lock()
                            .map_err(|_| DesktopError("recoveryRequired"))?
                            .len()
                            >= 144
                        {
                            return Err(DesktopError("storageLimit"));
                        }
                        let staged = platform.stage_cancellable(
                            input.request,
                            &worker_generation,
                            &secret,
                            vault.as_ref(),
                            &token,
                        )?;
                        let reference = staged.args[0]["credential"]["replace"]
                            .as_str()
                            .ok_or(DesktopError("invalidReply"))?
                            .to_string();
                        worker::remember(&known, reference, Arc::new(secret))?;
                        return Ok(Completion::Stage(staged));
                    }
                    if matches!(
                        c.as_str(),
                        "channel:test" | "channel:test-direct" | "channel:fetch-models"
                    ) {
                        return super::credentialed_discovery::probe(
                            &c, &args, &catalog, &keys, &policy, &known, &cancelled,
                        )
                        .map(Completion::Probe);
                    }
                    worker::guard(
                        &serde_json::to_value(&request)
                            .map_err(|_| DesktopError("invalidParams"))?,
                        &known,
                    )?;
                    if let Some(prepared) = prepared {
                        let replacement = args
                            .first()
                            .filter(|a| a["credential"]["replace"].is_string())
                            .and_then(|a| a["channel"]["id"].as_str());
                        let keys = worker::hydrate(
                            prepared.catalog(),
                            &platform.vault_scope(),
                            vault.as_ref(),
                            &known,
                            &token,
                            replacement,
                        )?;
                        worker::guard(
                            &serde_json::to_value(&request)
                                .map_err(|_| DesktopError("invalidParams"))?,
                            &known,
                        )?;
                        let profiles =
                            worker::profiles(prepared.catalog(), &keys, &known, &policy)?;
                        return Ok(Completion::Mutation(Box::new(prepared), Some(profiles)));
                    }
                    let profiles = worker::profiles(&catalog, &keys, &known, &policy)?;
                    Ok(Completion::Invoke(c, args, mutation, profiles))
                })();
                let _ = tx.send(result);
            })
            .map_err(|_| DesktopError("hostUnavailable"))?;
        managed.job = Some(Job {
            send_owner,
            probe,
            generation,
            revision,
            cancel,
            reply: reply.clone(),
            rx,
            thread,
        });
        Ok(None)
    }
    pub(super) fn poll_credential_work(&mut self) {
        let Some(managed) = self.credentialed.as_mut() else {
            return;
        };
        if managed.job.as_ref().is_none_or(|j| !j.thread.is_finished()) {
            return;
        }
        let job = managed.job.take().expect("已完成任务");
        let _ = job.thread.join();
        if job.cancel.load(Ordering::Acquire) {
            return;
        }
        let result = (|| {
            if self.generation != job.generation {
                return Err(DesktopError("staleGeneration"));
            }
            if self.platform.bootstrap()?.revision != job.revision {
                return Err(DesktopError("revisionConflict"));
            }
            if !self.gate.allows_send() {
                return Err(DesktopError("closing"));
            }
            let completion = job
                .rx
                .try_recv()
                .map_err(|_| DesktopError("hostUnavailable"))??;
            match completion {
                Completion::Stage(request) => Ok(Some(json!({"value":request}))),
                Completion::Probe(value) => Ok(Some(json!({"value":value}))),
                Completion::Mutation(prepared, profiles) => {
                    let platform = self
                        .credentialed
                        .as_ref()
                        .expect("受控宿主")
                        .platform
                        .clone();
                    let result = platform.commit(*prepared, |_| {
                        if let Some(p) = profiles {
                            self.runtime.install_managed(p)
                        } else {
                            Ok(())
                        }
                    });
                    if result.as_ref().is_err_and(|e| {
                        matches!(
                            e.0,
                            "storeIo"
                                | "recoveryRequired"
                                | "storeChanged"
                                | "unsafePath"
                                | "invalidRoot"
                        )
                    }) {
                        self.runtime.freeze_availability();
                        platform.freeze();
                    }
                    serde_json::to_value(result?)
                        .map(Some)
                        .map_err(|_| DesktopError("invalidReply"))
                }
                Completion::Invoke(c, args, mutation, profiles) => {
                    self.runtime.install_managed(profiles)?;
                    self.credentialed.as_mut().expect("受控宿主").bypass = true;
                    let result = self.invoke(&c, args, mutation, &job.reply);
                    self.credentialed.as_mut().expect("受控宿主").bypass = false;
                    result
                }
            }
        })();
        if let Some(value) = result.transpose() {
            let _ = job.reply.send(value);
        }
    }
    pub(super) fn cancel_credential_send(&mut self, sid: &str, expected: Option<&str>) {
        let matches = self
            .credentialed
            .as_ref()
            .and_then(|m| m.job.as_ref())
            .is_some_and(|job| {
                if let Some((owner, request)) = &job.send_owner {
                    owner == sid && expected.is_none_or(|id| request.as_deref() == Some(id))
                } else {
                    // 兼容旧通道测试面板的单参数探测取消。
                    expected.is_none() && job.probe
                }
            });
        if matches {
            self.cancel_credential_work();
        }
    }
    pub(super) fn cancel_credential_work(&mut self) {
        if let Some(j) = self.credentialed.as_mut().and_then(|m| m.job.as_mut()) {
            if !j.cancel.swap(true, Ordering::AcqRel) {
                let _ = j.reply.send(Err(DesktopError("staleGeneration")));
            }
        }
    }
}
impl Drop for Credentialed {
    fn drop(&mut self) {
        if let Some(j) = self.job.take() {
            j.cancel.store(true, Ordering::Release);
            let _ = j.thread.join();
        }
    }
}
