//! 导入只接受宿主读取并规范化的会话，不提供前端可反序列化的会话写入入口。
use super::{actor::Actor, FormalAgentHost, Message};
use crate::formal_platform::project_catalog::ProjectCatalog;
use crate::{
    desktop_runtime::protocol::{DesktopError, Result},
    electron_import::SourceSession,
    formal_platform::MOCK_PROFILE_ID,
};
use std::{
    path::PathBuf,
    sync::mpsc::{self, Receiver, SyncSender},
};

pub(crate) enum DocumentStep {
    Begin,
    Commit {
        epoch: u64,
        prepared: crate::formal_documents::PreparedDocument,
    },
    List,
    Read(crate::formal_documents::DocumentSelection),
}
pub(crate) enum ImportStep {
    Backup(super::project_backup::Step),
    Document {
        workspace: String,
        step: DocumentStep,
    },
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
    BackupBytes(Vec<u8>),
    Document(serde_json::Value),
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
    pub(super) fn session_import(&mut self, call: ImportCall) {
        let result = self.import_step(&call.generation, call.step);
        let _ = call.reply.send(result);
    }
    fn import_step(&mut self, generation: &str, step: ImportStep) -> Result<ImportReply> {
        if generation.is_empty() || generation != self.generation {
            return Err(DesktopError("staleGeneration"));
        }
        if self.draining || !self.gate.allows_send() {
            return Err(DesktopError("closing"));
        }
        if !self.projects_supported() {
            return Err(DesktopError("unsupported"));
        }
        self.root.validate()?;
        let profile = if self.credentialed.is_some() {
            crate::desktop_runtime::UNCONFIGURED_PROFILE_ID
        } else {
            MOCK_PROFILE_ID
        };
        let now = self.gate.sequence();
        if let Some(managed) = &self.credentialed {
            if let ImportStep::ProjectSession { epoch, source, .. }
            | ImportStep::Commit(epoch, source) = &step
            {
                if *epoch != now {
                    return Err(DesktopError("closing"));
                }
                guard_import(source, &managed.known)?;
            }
        }
        match step {
            ImportStep::Backup(step) => self.project_backup(now, step),
            ImportStep::Document { workspace, step } => {
                self.platform.require_workspace(
                    crate::formal_platform::workspace::WorkspaceKey::Id(&workspace),
                )?;
                use crate::formal_documents;
                let value = match step {
                    DocumentStep::Begin => {
                        return Ok(ImportReply::Permit {
                            destination: self.root.path().to_owned(),
                            epoch: now,
                        })
                    }
                    DocumentStep::Commit { epoch, prepared } => {
                        if epoch != now {
                            return Err(DesktopError("closing"));
                        }
                        serde_json::json!(formal_documents::publish_selected(
                            &self.root,
                            &workspace,
                            prepared,
                            |text| self.platform.check_project_text(text),
                        )?)
                    }
                    DocumentStep::List => {
                        serde_json::json!(formal_documents::list(&self.root, &workspace)?)
                    }
                    DocumentStep::Read(selection) => serde_json::json!(formal_documents::read(
                        &self.root, &workspace, &selection
                    )?),
                };
                Ok(ImportReply::Document(value))
            }
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
                    self.platform.import_projects(&projects, &refs)?,
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
                    profile,
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
                let receipt = self
                    .runtime
                    .import_electron_session(&source, profile, |dir| {
                        crate::legacy_attachments::stage_files(dir, &source.attachments)
                    })?;
                Ok(ImportReply::Committed(receipt.imported))
            }
        }
    }
}

// Import never opens the vault. Reuse only credentials already available in this
// process to guard the same bytes that would be retained in the imported history.
fn guard_import(
    source: &SourceSession,
    known: &crate::credentialed_channels::worker::Known,
) -> Result<()> {
    let keys: Vec<_> = known
        .lock()
        .map_err(|_| DesktopError("recoveryRequired"))?
        .values()
        .cloned()
        .collect();
    for key in keys {
        let leaked = key.with_bytes(|key| {
            // Secret::new accepts only valid, nonempty UTF-8.
            let text = std::str::from_utf8(key).expect("valid credential");
            let has = |s: &str| s.contains(text);
            has(&source.source_session_id)
                || has(&source.title)
                || source.messages.iter().any(|m| {
                    has(&m.id)
                        || has(&m.role)
                        || has(&m.text)
                        || m.attachment_ids.iter().any(|id| has(id))
                })
                || source.attachments.iter().any(|a| {
                    has(&a.id)
                        || has(&a.filename)
                        || has(&a.media_type)
                        || match std::str::from_utf8(&a.bytes) {
                            Ok(value) => has(value),
                            Err(_) => a.bytes.windows(key.len()).any(|window| window == key),
                        }
                })
        });
        if leaked {
            return Err(DesktopError("invalidImport"));
        }
    }
    Ok(())
}

#[cfg(test)]
mod credential_guard_tests {
    use super::*;
    use crate::{
        credentialed_channels::{
            vault::Secret,
            worker::{remember, Known},
        },
        electron_import::{SourceAttachment, SourceMessage},
    };
    #[test]
    fn imported_messages_and_attachment_bytes_cannot_persist_a_known_credential() {
        let key = "synthetic-private-sentinel";
        let known: Known = Default::default();
        remember(
            &known,
            "ref".into(),
            std::sync::Arc::new(Secret::new(key.as_bytes().into()).unwrap()),
        )
        .unwrap();
        let clean = SourceSession {
            source_session_id: "old".into(),
            title: "Project".into(),
            created_at: 1,
            updated_at: 2,
            archived: false,
            pinned: false,
            messages: vec![SourceMessage {
                id: "m".into(),
                role: "user".into(),
                text: "A note".into(),
                created_at: 1,
                attachment_ids: vec!["a".into()],
            }],
            attachments: vec![SourceAttachment {
                id: "a".into(),
                filename: "note.txt".into(),
                media_type: "text/plain".into(),
                bytes: b"Synthetic note".to_vec(),
            }],
        };
        guard_import(&clean, &known).unwrap();
        for where_ in 0..6 {
            let mut source = clean.clone();
            match where_ {
                0 => source.title += key,
                1 => source.messages[0].text += key,
                2 => source.messages[0].attachment_ids[0] += key,
                3 => source.attachments[0].filename += key,
                4 => source.attachments[0].bytes = [&[0xff][..], key.as_bytes()].concat(),
                _ => source.source_session_id += key,
            }
            assert_eq!(
                guard_import(&source, &known).unwrap_err().0,
                "invalidImport"
            );
        }
    }
}
