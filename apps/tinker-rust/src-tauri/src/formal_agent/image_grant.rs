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
    fn checked_image_store(
        &self,
        generation: &str,
        sid: &str,
    ) -> Result<&crate::formal_images::ImageStore> {
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
        Ok(store)
    }

    pub(super) fn prepare_history_image(
        &self,
        generation: &str,
        sid: &str,
        projected_id: &str,
        filename: &str,
    ) -> Result<Value> {
        let store = self.checked_image_store(generation, sid)?;
        let raw_id = projected_id
            .strip_prefix(&format!("electron-import:{sid}:"))
            .filter(|id| !id.is_empty() && id.len() <= 512)
            .ok_or(DesktopError("imageNotFound"))?;
        if filename.len() != "legacy-".len() + 64 + ".png".len() {
            return Err(DesktopError("imageNotFound"));
        }
        let (file, png) = self.runtime.history_image(sid, raw_id, filename)?;
        let source = crate::formal_images::HistoryImageSource {
            message_id: raw_id.into(),
            attachment_id: file.id,
        };
        let imported = store.import_reference(sid, &file.filename, &png, now()?, Some(source))?;
        Ok(json!({"value":super::image_projection::imported_reference(sid, &imported)}))
    }

    fn apply_image_grant(&mut self, generation: &str, sid: &str, step: Step) -> Result<Outcome> {
        let store = self.checked_image_store(generation, sid)?;
        match step {
            Step::CheckImport => Ok(Outcome::Ready),
            Step::ReadExport(filename) if filename.starts_with("legacy-") => {
                if !filename.ends_with(".png") {
                    return Err(DesktopError("unsupportedImageFormat"));
                }
                let bytes = self
                    .runtime
                    .imported_file_bytes(sid, &filename)?
                    .ok_or(DesktopError("imageNotFound"))?;
                Ok(Outcome::Bytes(bytes))
            }
            Step::ReadExport(filename) => Ok(Outcome::Bytes(
                store.attachment(sid, &filename)?.read_bytes()?,
            )),
            Step::Import { name, png } => {
                let imported = store.import_png(sid, &name, &png, now()?)?;
                Ok(Outcome::Finished(
                    json!({"value":super::image_projection::imported_reference(sid, &imported)}),
                ))
            }
            Step::Export { filename, staged } => {
                if filename.starts_with("legacy-") {
                    let owned = self.runtime.imported_files(sid)?.iter().any(|file| {
                        file.media_type == "image/png"
                            && crate::legacy_attachments::wire_name(file) == filename
                    });
                    if !owned {
                        return Err(DesktopError("imageNotFound"));
                    }
                } else {
                    store.attachment(sid, &filename)?;
                }
                staged.commit()?;
                Ok(Outcome::Finished(json!({"value":true})))
            }
        }
    }
}

fn now() -> Result<u64> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| DesktopError("clockUnavailable"))?
        .as_millis() as u64)
}
