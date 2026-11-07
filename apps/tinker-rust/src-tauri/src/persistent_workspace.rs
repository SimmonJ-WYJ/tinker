//! 兼容原有草稿命令；存储错误不携带用户内容或绝对路径。
use crate::session_store::{LoadedSession, SessionStore, StoreError, MAX_DRAFT_BYTES};
use serde::Serialize;
use std::path::Path;
const SESSION_ID: &str = "draft";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppError {
    EmptyInput,
    InputTooLarge,
    ModelNotMigrated,
    Storage(StoreError),
}
impl From<StoreError> for AppError {
    fn from(error: StoreError) -> Self {
        Self::Storage(error)
    }
}
impl AppError {
    pub fn code(self) -> &'static str {
        match self {
            Self::EmptyInput => "emptyInput",
            Self::InputTooLarge => "inputTooLarge",
            Self::ModelNotMigrated => "modelNotMigrated",
            Self::Storage(error) => match error {
                StoreError::Io => "storageUnavailable",
                StoreError::Locked => "storageLocked",
                StoreError::UnsafePath => "storageUnsafePath",
                StoreError::Corrupt => "storageCorrupt",
                StoreError::UnsupportedVersion => "storageVersionUnsupported",
                StoreError::TooLarge => "storageFileTooLarge",
                StoreError::RevisionConflict => "storageConflict",
                StoreError::RecoveryRequired => "storageRecoveryRequired",
                StoreError::DurabilityUnknown => "storageUncertain",
            },
        }
    }
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub protocol_version: u32,
    pub architecture: &'static str,
    pub draft: String,
    pub session_id: String,
    pub revision: u32,
    pub recovery_required: bool,
    pub storage_kind: &'static str,
}
pub struct PersistentWorkspace {
    store: SessionStore,
    loaded: LoadedSession,
}
impl PersistentWorkspace {
    pub fn open(root: impl AsRef<Path>) -> Result<Self, AppError> {
        let store = SessionStore::open(root)?;
        let loaded = store.load(SESSION_ID)?;
        Ok(Self { store, loaded })
    }
    pub fn snapshot(&mut self) -> Result<Snapshot, AppError> {
        self.loaded = self.store.load(SESSION_ID)?;
        Ok(Snapshot {
            protocol_version: 1,
            architecture: std::env::consts::ARCH,
            draft: self.loaded.record.draft.clone(),
            session_id: SESSION_ID.into(),
            revision: self.loaded.record.revision,
            recovery_required: self.loaded.recovery_required,
            storage_kind: "file",
        })
    }
    pub fn save(&mut self, input: String) -> Result<(), AppError> {
        if input.len() > MAX_DRAFT_BYTES {
            return Err(AppError::InputTooLarge);
        }
        let record = self
            .store
            .save(SESSION_ID, &input, self.loaded.record.revision)?;
        self.loaded = LoadedSession {
            record,
            recovery_required: false,
        };
        Ok(())
    }
    pub fn submit(&mut self, input: String) -> Result<(), AppError> {
        let empty = input.trim().is_empty();
        self.save(input)?;
        Err(if empty {
            AppError::EmptyInput
        } else {
            AppError::ModelNotMigrated
        })
    }
    pub fn recover(&mut self, expected_revision: u32) -> Result<(), AppError> {
        self.loaded = self.store.recover(SESSION_ID, expected_revision)?;
        Ok(())
    }
}
#[cfg(test)]
#[path = "persistent_workspace_tests.rs"]
mod tests;
