//! 导入只接受宿主读取并规范化的会话，不提供前端可反序列化的会话写入入口。
use super::{actor::Actor, FormalAgentHost, Message};
use crate::{
    desktop_runtime::protocol::{DesktopError, Result},
    electron_import::SourceSession,
    formal_platform::MOCK_PROFILE_ID,
};
use std::{
    path::PathBuf,
    sync::mpsc::{self, Receiver, SyncSender},
};

pub(crate) enum ImportStep {
    Begin,
    Check(u64),
    Commit(u64, Box<SourceSession>),
}
pub(crate) enum ImportReply {
    Permit { destination: PathBuf, epoch: u64 },
    Valid,
    Committed(bool),
}
pub(super) struct ImportCall {
    generation: String,
    step: ImportStep,
    reply: SyncSender<Result<ImportReply>>,
}
impl FormalAgentHost {
    pub(crate) fn import_step(
        &self,
        generation: String,
        step: ImportStep,
    ) -> Result<Receiver<Result<ImportReply>>> {
        let (reply, rx) = mpsc::sync_channel(1);
        self.tx
            .try_send(Message::SessionImport(ImportCall {
                generation,
                step,
                reply,
            }))
            .map_err(|err| match err {
                mpsc::TrySendError::Full(_) => DesktopError("hostBusy"),
                mpsc::TrySendError::Disconnected(_) => DesktopError("hostClosed"),
            })?;
        Ok(rx)
    }
}
impl Actor {
    pub(super) fn session_import(&self, call: ImportCall) {
        let result = self.import_step(&call.generation, call.step);
        let _ = call.reply.send(result);
    }
    fn import_step(&self, generation: &str, step: ImportStep) -> Result<ImportReply> {
        if generation.is_empty() || generation != self.generation {
            return Err(DesktopError("staleGeneration"));
        }
        if self.draining || !self.gate.allows_send() {
            return Err(DesktopError("closing"));
        }
        if self.images.is_none() {
            return Err(DesktopError("unsupported"));
        }
        self.root.validate()?;
        let now = self.gate.sequence();
        match step {
            ImportStep::Begin => Ok(ImportReply::Permit {
                destination: self.root.path().to_owned(),
                epoch: now,
            }),
            ImportStep::Check(epoch) | ImportStep::Commit(epoch, _) if epoch != now => {
                Err(DesktopError("closing"))
            }
            ImportStep::Check(_) => Ok(ImportReply::Valid),
            ImportStep::Commit(_, source) => {
                let receipt =
                    self.runtime
                        .import_electron_session(&source, MOCK_PROFILE_ID, |dir| {
                            crate::legacy_attachments::stage_files(dir, &source.attachments)
                        })?;
                Ok(ImportReply::Committed(receipt.imported))
            }
        }
    }
}
