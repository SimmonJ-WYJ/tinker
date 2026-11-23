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
    BeginBinding(String),
    BindDirectory {
        epoch: u64,
        workspace_id: String,
        path: PathBuf,
        identity: (u64, u64),
    },
    Begin,
    Check(u64),
    Projects {
        epoch: u64,
        projects: Vec<crate::electron_import::SourceProject>,
        refs: std::collections::BTreeSet<String>,
    },
    ProjectSession {
        epoch: u64,
        source: Box<SourceSession>,
        workspace: String,
    },
    Commit(u64, Box<SourceSession>),
}
pub(crate) enum ImportReply {
    Permit { destination: PathBuf, epoch: u64 },
    Valid,
    Committed(bool),
    Projects(crate::formal_platform::project_catalog::ImportedProjects),
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
        if !self.synthetic_projects() {
            return Err(DesktopError("unsupported"));
        }
        self.root.validate()?;
        let now = self.gate.sequence();
        match step {
            ImportStep::BeginBinding(workspace_id) => {
                self.platform.require_workspace(
                    crate::formal_platform::workspace::WorkspaceKey::Project(&workspace_id),
                )?;
                Ok(ImportReply::Permit {
                    destination: self.root.path().to_owned(),
                    epoch: now,
                })
            }
            ImportStep::BindDirectory {
                epoch,
                workspace_id,
                path,
                identity,
            } => {
                if epoch != now {
                    return Err(DesktopError("closing"));
                }
                self.platform
                    .bind_project_folder(&workspace_id, &path, identity)?;
                Ok(ImportReply::Valid)
            }
            ImportStep::Projects {
                epoch,
                projects,
                refs,
            } => {
                if epoch != now {
                    return Err(DesktopError("closing"));
                }
                Ok(ImportReply::Projects(
                    self.platform
                        .project_platform()?
                        .import_projects(&projects, &refs)?,
                ))
            }
            ImportStep::ProjectSession {
                epoch,
                source,
                workspace,
            } => {
                if epoch != now {
                    return Err(DesktopError("closing"));
                }
                self.platform.require_workspace(
                    crate::formal_platform::workspace::WorkspaceKey::Project(&workspace),
                )?;
                let receipt = self.runtime.import_electron_session_in_workspace(
                    &source,
                    MOCK_PROFILE_ID,
                    Some(&workspace),
                    |dir| crate::legacy_attachments::stage_files(dir, &source.attachments),
                )?;
                Ok(ImportReply::Committed(receipt.imported))
            }
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
