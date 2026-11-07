//! 隔离实验版的版本化会话文件存储，不读取旧应用数据。
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions, TryLockError},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};

pub const MAX_DRAFT_BYTES: usize = 65_536;
pub const MAX_FILE_BYTES: usize = 524_288;
static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StoreError {
    Io,
    Locked,
    UnsafePath,
    Corrupt,
    UnsupportedVersion,
    TooLarge,
    RevisionConflict,
    RecoveryRequired,
    DurabilityUnknown,
}
impl From<std::io::Error> for StoreError {
    fn from(_: std::io::Error) -> Self {
        Self::Io
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionRecord {
    pub schema_version: u32,
    pub session_id: String,
    pub revision: u32,
    pub draft: String,
}
#[derive(Debug)]
pub struct LoadedSession {
    pub record: SessionRecord,
    pub recovery_required: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SchemaHeader {
    schema_version: u32,
}

#[derive(Debug)]
pub struct SessionStore {
    root: PathBuf,
    _writer_lock: File,
    transaction: Mutex<()>,
}

impl SessionStore {
    pub fn open(root: impl AsRef<Path>) -> Result<Self, StoreError> {
        let root = root.as_ref();
        match fs::symlink_metadata(root) {
            Ok(meta) if !meta.is_dir() || meta.file_type().is_symlink() => {
                return Err(StoreError::UnsafePath)
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let mut builder = fs::DirBuilder::new();
                builder.recursive(true);
                #[cfg(unix)]
                {
                    use std::os::unix::fs::DirBuilderExt;
                    builder.mode(0o700);
                }
                builder.create(root)?;
            }
            Err(error) => return Err(error.into()),
        }
        let root = root.canonicalize()?;
        let lock_path = root.join("store.lock");
        safe_file(&lock_path)?;
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let lock = options.open(lock_path)?;
        lock.try_lock().map_err(|error| match error {
            TryLockError::WouldBlock => StoreError::Locked,
            TryLockError::Error(_) => StoreError::Io,
        })?;
        Ok(Self {
            root,
            _writer_lock: lock,
            transaction: Mutex::new(()),
        })
    }

    pub fn load(&self, id: &str) -> Result<LoadedSession, StoreError> {
        validate_id(id)?;
        let primary = self.root.join(format!("{id}.json"));
        let backup = self.root.join(format!("{id}.bak"));
        let primary_exists = safe_file(&primary)?;
        if primary_exists {
            match read_record(&primary, id) {
                Ok(record) => {
                    return Ok(LoadedSession {
                        record,
                        recovery_required: false,
                    })
                }
                Err(StoreError::Corrupt) => {}
                Err(error) => return Err(error),
            }
        }
        if safe_file(&backup)? {
            return Ok(LoadedSession {
                record: read_record(&backup, id)?,
                recovery_required: true,
            });
        }
        if primary_exists {
            return Err(StoreError::Corrupt);
        }
        Ok(LoadedSession {
            record: SessionRecord {
                schema_version: 1,
                session_id: id.into(),
                revision: 0,
                draft: String::new(),
            },
            recovery_required: false,
        })
    }

    pub fn save(&self, id: &str, draft: &str, revision: u32) -> Result<SessionRecord, StoreError> {
        validate_id(id)?;
        if draft.len() > MAX_DRAFT_BYTES {
            return Err(StoreError::TooLarge);
        }
        let _transaction = self.transaction.lock().map_err(|_| StoreError::Io)?;
        let previous = self.load(id)?;
        if previous.recovery_required {
            return Err(StoreError::RecoveryRequired);
        }
        if previous.record.revision != revision {
            return Err(StoreError::RevisionConflict);
        }
        let next = SessionRecord {
            schema_version: 1,
            session_id: id.into(),
            revision: revision
                .checked_add(1)
                .ok_or(StoreError::RevisionConflict)?,
            draft: draft.into(),
        };
        let encoded = encode(&next)?;
        let primary = self.root.join(format!("{id}.json"));
        if safe_file(&primary)? {
            self.atomic_write(
                &self.root.join(format!("{id}.bak")),
                &encode(&previous.record)?,
            )?;
        }
        self.atomic_write(&primary, &encoded)?;
        Ok(next)
    }

    /// 仅显式恢复时替换主文件；损坏原件先改名保留，备份始终保留。
    pub fn recover(&self, id: &str, revision: u32) -> Result<LoadedSession, StoreError> {
        let _transaction = self.transaction.lock().map_err(|_| StoreError::Io)?;
        let loaded = self.load(id)?;
        if !loaded.recovery_required {
            return Ok(loaded);
        }
        if loaded.record.revision != revision {
            return Err(StoreError::RevisionConflict);
        }
        let encoded = encode(&loaded.record)?;
        let primary = self.root.join(format!("{id}.json"));
        if safe_file(&primary)? {
            let archive = self.root.join(format!(
                "{id}.corrupt-{}-{}",
                std::process::id(),
                NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
            ));
            match fs::symlink_metadata(&archive) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                _ => return Err(StoreError::Io),
            }
            fs::rename(&primary, archive)?;
            self.sync_directory()?;
        }
        self.atomic_write(&primary, &encoded)?;
        Ok(LoadedSession {
            record: loaded.record,
            recovery_required: false,
        })
    }

    fn atomic_write(&self, target: &Path, bytes: &[u8]) -> Result<(), StoreError> {
        safe_file(target)?;
        let path = self.root.join(format!(
            ".write-{}-{}.tmp",
            std::process::id(),
            NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
        ));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&path)?;
        let mut temporary = Temporary {
            path,
            cleanup: true,
        };
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temporary.path, target)?;
        temporary.cleanup = false;
        self.sync_directory()
    }

    fn sync_directory(&self) -> Result<(), StoreError> {
        #[cfg(unix)]
        {
            File::open(&self.root)
                .and_then(|file| file.sync_all())
                .map_err(|_| StoreError::DurabilityUnknown)?;
        }
        Ok(())
    }
}

fn validate_id(id: &str) -> Result<(), StoreError> {
    if id.is_empty()
        || id.len() > 64
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err(StoreError::UnsafePath);
    }
    Ok(())
}

fn safe_file(path: &Path) -> Result<bool, StoreError> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_file() && !meta.file_type().is_symlink() => Ok(true),
        Ok(_) => Err(StoreError::UnsafePath),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
    }
}

fn read_record(path: &Path, id: &str) -> Result<SessionRecord, StoreError> {
    safe_file(path)?;
    let file = File::open(path)?;
    if file.metadata()?.len() > MAX_FILE_BYTES as u64 {
        return Err(StoreError::TooLarge);
    }
    let mut bytes = Vec::new();
    file.take((MAX_FILE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)?;
    if bytes.len() > MAX_FILE_BYTES {
        return Err(StoreError::TooLarge);
    }
    let header: SchemaHeader = serde_json::from_slice(&bytes).map_err(|_| StoreError::Corrupt)?;
    if header.schema_version != 1 {
        return Err(StoreError::UnsupportedVersion);
    }
    let record: SessionRecord = serde_json::from_slice(&bytes).map_err(|_| StoreError::Corrupt)?;
    if record.session_id != id {
        return Err(StoreError::Corrupt);
    }
    if record.draft.len() > MAX_DRAFT_BYTES {
        return Err(StoreError::TooLarge);
    }
    Ok(record)
}

fn encode(record: &SessionRecord) -> Result<Vec<u8>, StoreError> {
    let bytes = serde_json::to_vec(record).map_err(|_| StoreError::Corrupt)?;
    if bytes.len() > MAX_FILE_BYTES {
        return Err(StoreError::TooLarge);
    }
    Ok(bytes)
}

struct Temporary {
    path: PathBuf,
    cleanup: bool,
}
impl Drop for Temporary {
    fn drop(&mut self) {
        if self.cleanup {
            let _ = fs::remove_file(&self.path);
        }
    }
}

#[cfg(test)]
#[path = "session_store_tests.rs"]
mod tests;
