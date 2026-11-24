//! 单个窗口一次只保留一份待确认的备份；文件句柄和内容永不返回 WebView。
use super::{actor::Actor, session_import::ImportReply};
use crate::desktop_runtime::protocol::{DesktopError, Result};
use serde_json::json;

pub(super) struct Pending {
    epoch: u64,
    token: String,
    bytes: Vec<u8>,
}

impl Pending {
    fn consume(slot: &mut Option<Self>, epoch: u64, token: &str) -> Result<Self> {
        if slot
            .as_ref()
            .is_some_and(|p| p.epoch == epoch && p.token == token)
        {
            return slot.take().ok_or(DesktopError("backupSelectionExpired"));
        }
        Err(DesktopError("backupSelectionExpired"))
    }
}

pub(crate) enum Step {
    BeginPick,
    Export {
        epoch: u64,
        workspace: String,
    },
    #[cfg(all(target_os = "macos", feature = "formal-preview"))]
    Save {
        epoch: u64,
        staged: crate::formal_commands::image_disk::StagedExport,
    },
    Inspect {
        epoch: u64,
        bytes: Vec<u8>,
    },
    Confirm(String),
    Discard(String),
}

impl Actor {
    pub(super) fn project_backup(&mut self, now: u64, step: Step) -> Result<ImportReply> {
        let store = &self
            .images
            .as_ref()
            .ok_or(DesktopError("unsupported"))?
            .store;
        let check = |epoch| {
            if epoch == now {
                Ok(())
            } else {
                Err(DesktopError("closing"))
            }
        };
        let value = match step {
            Step::BeginPick => {
                self.pending_backup = None;
                return Ok(ImportReply::Permit {
                    epoch: now,
                    destination: self.root.path().to_owned(),
                });
            }
            Step::Export { epoch, workspace } => {
                check(epoch)?;
                return Ok(ImportReply::BackupBytes(crate::portable_project::export(
                    &self.root,
                    &self.runtime,
                    &self.platform,
                    store,
                    &workspace,
                )?));
            }
            #[cfg(all(target_os = "macos", feature = "formal-preview"))]
            Step::Save { epoch, staged } => {
                check(epoch)?;
                staged.commit().map_err(|err| {
                    if err.0 == "imageFileExists" {
                        DesktopError("backupFileExists")
                    } else {
                        DesktopError("backupFileUnavailable")
                    }
                })?;
                json!(true)
            }
            Step::Inspect { epoch, bytes } => {
                check(epoch)?;
                let mut summary = json!(crate::portable_project::preflight(
                    &self.root,
                    &self.runtime,
                    &self.platform,
                    store,
                    &bytes
                )?);
                let token = crate::credentialed_channels::catalog::random_reference()?;
                summary["token"] = json!(token);
                self.pending_backup = Some(Pending {
                    epoch,
                    token,
                    bytes,
                });
                summary
            }
            Step::Confirm(ref token) | Step::Discard(ref token) => {
                let pending = Pending::consume(&mut self.pending_backup, now, token)?;
                if matches!(step, Step::Discard(_)) {
                    json!(true)
                } else {
                    json!(crate::portable_project::restore(
                        &self.root,
                        &self.runtime,
                        &self.platform,
                        store,
                        &pending.bytes
                    )?)
                }
            }
        };
        Ok(ImportReply::Document(value))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn confirmation_receipts_are_epoch_bound_and_one_use() {
        let mut pending = Some(Pending {
            epoch: 4,
            token: "owned".into(),
            bytes: b"picked".to_vec(),
        });
        assert!(Pending::consume(&mut pending, 4, "forged").is_err());
        assert!(Pending::consume(&mut pending, 5, "owned").is_err());
        assert_eq!(
            Pending::consume(&mut pending, 4, "owned").unwrap().bytes,
            b"picked"
        );
        assert!(Pending::consume(&mut pending, 4, "owned").is_err());
    }
}
