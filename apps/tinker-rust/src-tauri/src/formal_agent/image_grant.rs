//! 文件授权只能由可信原生面板构造。前端 JSON 不具备传入磁盘路径或暂存凭据的能力。
use super::{actor::Actor, FormalAgentHost, Message};
use crate::{
    desktop_runtime::protocol::{id, DesktopError, Result},
    formal_commands::image_disk::StagedExport,
};
use serde_json::{json, Value};
use std::{
    sync::mpsc::{self, Receiver, SyncSender},
    time::{SystemTime, UNIX_EPOCH},
};

pub(crate) enum Step {
    CheckImport,
    ReadExport(String),
    Import {
        name: String,
        png: Vec<u8>,
    },
    Export {
        filename: String,
        staged: StagedExport,
    },
}
pub(crate) enum Outcome {
    Ready,
    Bytes(Vec<u8>),
    Finished(Value),
}
pub(super) struct Grant {
    generation: String,
    session: String,
    step: Step,
    reply: SyncSender<Result<Outcome>>,
}
impl FormalAgentHost {
    pub(crate) fn image_grant(
        &self,
        generation: String,
        session: String,
        step: Step,
    ) -> Result<Receiver<Result<Outcome>>> {
        let (reply, rx) = mpsc::sync_channel(1);
        self.tx
            .try_send(Message::ImageGrant(Grant {
                generation,
                session,
                step,
                reply,
            }))
            .map_err(|e| match e {
                mpsc::TrySendError::Full(_) => DesktopError("hostBusy"),
                mpsc::TrySendError::Disconnected(_) => DesktopError("hostClosed"),
            })?;
        Ok(rx)
    }
}
impl Actor {
    pub(super) fn process_image_grant(&mut self, grant: Grant) {
        let result = self.apply_image_grant(&grant.generation, &grant.session, grant.step);
        let _ = grant.reply.send(result);
    }
    fn apply_image_grant(&mut self, generation: &str, sid: &str, step: Step) -> Result<Outcome> {
        if generation.is_empty() || generation != self.generation {
            return Err(DesktopError("staleGeneration"));
        }
        if self.draining || !self.gate.allows_send() {
            return Err(DesktopError("closing"));
        }
        id(sid)?;
        self.root.validate()?;
        let store = &self
            .images
            .as_ref()
            .ok_or(DesktopError("unsupported"))?
            .store;
        self.session(sid)?;
        match step {
            Step::CheckImport => Ok(Outcome::Ready),
            Step::ReadExport(filename) => Ok(Outcome::Bytes(
                store.attachment(sid, &filename)?.read_bytes()?,
            )),
            Step::Import { name, png } => {
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map_err(|_| DesktopError("clockUnavailable"))?
                    .as_millis() as u64;
                let imported = store.import_png(sid, &name, &png, now)?;
                Ok(Outcome::Finished(
                    json!({"value":{"imageId":imported.id,"localPath":format!("{sid}/{}",imported.filename),"filename":imported.filename,"displayName":imported.display_name,"mediaType":"image/png"}}),
                ))
            }
            Step::Export { filename, staged } => {
                store.attachment(sid, &filename)?;
                staged.commit()?;
                Ok(Outcome::Finished(json!({"value":true})))
            }
        }
    }
}
