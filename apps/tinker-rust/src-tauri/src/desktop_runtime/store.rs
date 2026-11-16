//! 单写journal：每次append同步后才发布；写入不确定时本实例停止所有新变更。
use super::{
    protocol::*,
    session::{Entry, Record},
};
use std::{
    fs::{self, File, OpenOptions, TryLockError},
    io::{Read, Write},
    path::{Path, PathBuf},
};
const MAX_JOURNAL_BYTES: u64 = 128 * 1024 * 1024;
pub struct Journal {
    pub root: PathBuf,
    _lock: File,
    file: File,
    bytes: u64,
    sequence: u64,
    blocked: bool,
}
fn existing_directory(path: &Path) -> Result<()> {
    for ancestor in path.ancestors() {
        if ancestor.as_os_str().is_empty() {
            continue;
        }
        let meta = fs::symlink_metadata(ancestor).map_err(|_| DesktopError("corruptLayout"))?;
        if meta.file_type().is_symlink() || !meta.is_dir() {
            return Err(DesktopError("unsafePath"));
        }
    }
    Ok(())
}
pub fn directory(path: &Path) -> Result<()> {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or(DesktopError("unsafePath"))?;
    existing_directory(parent)?;
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() || !meta.is_dir() => {
            Err(DesktopError("unsafePath"))
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            // 只创建服务拥有的当前一级；绝不递归补调用方root或其祖先。
            let mut builder = fs::DirBuilder::new();
            #[cfg(unix)]
            {
                use std::os::unix::fs::DirBuilderExt;
                builder.mode(0o700);
            }
            builder.create(path)?;
            sync_directory(path)?;
            sync_directory(parent)
        }
        Err(_) => Err(DesktopError("storeIo")),
    }
}
pub fn safe_file(path: &Path) -> Result<()> {
    match fs::symlink_metadata(path) {
        Ok(m) => {
            if !m.is_file() || m.file_type().is_symlink() {
                return Err(DesktopError("unsafePath"));
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;
                if m.nlink() != 1 {
                    return Err(DesktopError("unsafePath"));
                }
            }
            Ok(())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(DesktopError("storeIo")),
    }
}
pub fn options() -> OpenOptions {
    let mut o = OpenOptions::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.mode(0o600);
    }
    o
}
impl Journal {
    pub fn open(parent: &Path) -> Result<(Self, Vec<Record>)> {
        Self::open_with_sync(parent, sync_directory)
    }
    pub(super) fn open_with_sync(
        parent: &Path,
        sync: impl Fn(&Path) -> Result<()>,
    ) -> Result<(Self, Vec<Record>)> {
        Self::open_impl(parent, sync, false)
    }
    pub fn open_queue(parent: &Path, enabled: bool) -> Result<(Self, Vec<Record>)> {
        Self::open_impl(parent, sync_directory, enabled)
    }
    fn open_impl(
        parent: &Path,
        sync: impl Fn(&Path) -> Result<()>,
        queue_enabled: bool,
    ) -> Result<(Self, Vec<Record>)> {
        if !parent.is_absolute() || !parent.is_dir() {
            return Err(DesktopError("invalidRoot"));
        }
        existing_directory(parent)?;
        let host_parent = parent.parent().ok_or(DesktopError("invalidRoot"))?;
        // trusted host负责durable创建root；每次启动仍无条件确认这两级，覆盖失败重试。
        sync(parent)?;
        sync(host_parent)?;
        let root = parent.join("desktop-runtime-v1");
        directory(&root)?;
        let lock_path = root.join("writer.lock");
        safe_file(&lock_path)?;
        let lock = options()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(lock_path)?;
        lock.try_lock().map_err(|e| match e {
            TryLockError::WouldBlock => DesktopError("storeLocked"),
            _ => DesktopError("storeIo"),
        })?;
        let path = root.join("journal.jsonl");
        safe_file(&path)?;
        let mut file = options().read(true).append(true).create(true).open(path)?;
        if file.metadata()?.len() > MAX_JOURNAL_BYTES {
            return Err(DesktopError("storageLimit"));
        }
        let mut bytes = Vec::new();
        (&mut file)
            .take(MAX_JOURNAL_BYTES + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_JOURNAL_BYTES
            || (!bytes.is_empty() && bytes.last() != Some(&b'\n'))
        {
            return Err(DesktopError("corruptJournal"));
        }
        let mut records = Vec::new();
        for line in bytes
            .strip_suffix(b"\n")
            .unwrap_or(&bytes)
            .split(|b| *b == b'\n')
            .filter(|_| !bytes.is_empty())
        {
            if line.len() > MAX_FRAME_BYTES {
                return Err(DesktopError("corruptJournal"));
            }
            let value: serde_json::Value =
                serde_json::from_slice(line).map_err(|_| DesktopError("corruptJournal"))?;
            let version = value.get("version").and_then(|v| v.as_u64());
            if version != Some(1) && !(queue_enabled && version == Some(2)) {
                return Err(DesktopError("unsupportedVersion"));
            }
            let record: Record =
                serde_json::from_value(value).map_err(|_| DesktopError("corruptJournal"))?;
            if (record.version == 2) != matches!(&record.entry, Entry::Queue { .. }) {
                return Err(DesktopError("corruptJournal"));
            }
            if record.sequence != records.len() as u64 + 1 {
                return Err(DesktopError("corruptJournal"));
            }
            records.push(record);
        }
        file.sync_all()?;
        File::open(&root)?.sync_all()?;
        File::open(parent)?.sync_all()?;
        Ok((
            Self {
                root,
                _lock: lock,
                file,
                bytes: bytes.len() as u64,
                sequence: records.len() as u64,
                blocked: false,
            },
            records,
        ))
    }
    pub fn ensure_writable(&self) -> Result<()> {
        if self.blocked {
            Err(DesktopError("recoveryRequired"))
        } else {
            Ok(())
        }
    }
    pub fn append(&mut self, entry: Entry) -> Result<()> {
        if self.blocked {
            return Err(DesktopError("recoveryRequired"));
        }
        let record = Record {
            version: if matches!(&entry, Entry::Queue { .. }) {
                2
            } else {
                VERSION
            },
            sequence: self.sequence + 1,
            entry,
        };
        let mut bytes = serde_json::to_vec(&record).map_err(|_| DesktopError("storeIo"))?;
        bytes.push(b'\n');
        if self.bytes + bytes.len() as u64 > MAX_JOURNAL_BYTES {
            return Err(DesktopError("storageLimit"));
        }
        self.blocked = true;
        existing_directory(&self.root)?;
        let path = self.root.join("journal.jsonl");
        safe_file(&path)?;
        let disk = fs::metadata(&path)?;
        let held = self.file.metadata()?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if disk.dev() != held.dev() || disk.ino() != held.ino() {
                return Err(DesktopError("corruptJournal"));
            }
        }
        if disk.len() != self.bytes || held.len() != self.bytes {
            self.blocked = true;
            return Err(DesktopError("corruptJournal"));
        }
        self.blocked = true;
        self.file.write_all(&bytes)?;
        self.file.sync_all()?;
        self.bytes += bytes.len() as u64;
        self.sequence += 1;
        self.blocked = false;
        Ok(())
    }
}

pub fn sync_directory(path: &Path) -> Result<()> {
    File::open(path)?.sync_all()?;
    Ok(())
}
pub fn existing_run_layout(path: &Path) -> Result<()> {
    for dir in [
        path.to_path_buf(),
        path.join("runs-v1"),
        path.join("runs-v1/context-v2"),
    ] {
        existing_directory(&dir)?;
    }
    let lock = path.join("runs-v1/writer.lock");
    safe_file(&lock)?;
    if !lock.exists() {
        return Err(DesktopError("corruptLayout"));
    }
    Ok(())
}
