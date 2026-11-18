//! 单写快照：同步临时文件、原子rename、同步目录后才确认；不确定写入要求重开。
use super::{launch::TrustedRoot, protocol::*};
use crate::desktop_runtime::protocol::{DesktopError, Result};
use std::{
    fs::{self, File, Metadata, OpenOptions, TryLockError},
    io::{Read, Write},
    path::{Path, PathBuf},
};
pub(crate) const MAX_MARKER_BYTES: usize = 4096;
#[cfg(unix)]
fn private_owned(m: &Metadata) -> Result<()> {
    use std::os::unix::fs::MetadataExt;
    unsafe extern "C" {
        fn geteuid() -> u32;
    }
    // effective uid来自内核；不信任环境USER/HOME。
    let uid = unsafe { geteuid() };
    if m.uid() != uid || m.mode() & 0o077 != 0 {
        return Err(DesktopError("unsafePath"));
    }
    Ok(())
}
#[cfg(not(unix))]
fn private_owned(_: &Metadata) -> Result<()> {
    Err(DesktopError("unsupportedPlatform"))
}
pub(crate) fn directory(path: &Path, private: bool) -> Result<()> {
    if !path.is_absolute()
        || fs::canonicalize(path).map_err(|_| DesktopError("unsafePath"))? != path
    {
        return Err(DesktopError("unsafePath"));
    }
    for ancestor in path.ancestors() {
        let m = fs::symlink_metadata(ancestor)?;
        if m.file_type().is_symlink() || !m.is_dir() {
            return Err(DesktopError("unsafePath"));
        }
    }
    if private {
        private_owned(&fs::symlink_metadata(path)?)?;
    }
    Ok(())
}
fn regular(path: &Path, max: usize) -> Result<Metadata> {
    let m = fs::symlink_metadata(path)?;
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
    private_owned(&m)?;
    if m.len() > max as u64 {
        return Err(DesktopError("storageLimit"));
    }
    Ok(m)
}
fn same_file(a: &Metadata, b: &Metadata) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if a.dev() != b.dev() || a.ino() != b.ino() {
            return Err(DesktopError("unsafePath"));
        }
    }
    Ok(())
}
pub(crate) fn options() -> OpenOptions {
    let mut o = OpenOptions::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.mode(0o600);
        #[cfg(target_os = "macos")]
        o.custom_flags(0x100); // O_NOFOLLOW
        #[cfg(target_os = "linux")]
        o.custom_flags(0x20000); // O_NOFOLLOW
    }
    o
}
pub(crate) fn read_regular(path: &Path, max: usize) -> Result<Vec<u8>> {
    let before = regular(path, max)?;
    let mut file = options().read(true).open(path)?;
    same_file(&before, &file.metadata()?)?;
    let mut bytes = Vec::new();
    (&mut file).take(max as u64 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > max {
        return Err(DesktopError("storageLimit"));
    }
    same_file(&before, &regular(path, max)?)?;
    Ok(bytes)
}
pub(crate) fn write_new(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut f = options().write(true).create_new(true).open(path)?;
    f.write_all(bytes)?;
    f.sync_all()?;
    Ok(())
}
pub(crate) fn sync_dir(path: &Path) -> Result<()> {
    File::open(path)?.sync_all()?;
    Ok(())
}
pub(crate) fn snapshot_budget(bytes: &[u8]) -> Result<()> {
    if bytes.len() > MAX_SNAPSHOT_BYTES {
        Err(DesktopError("storageLimit"))
    } else {
        Ok(())
    }
}
pub(crate) struct Store {
    trusted: TrustedRoot,
    root: PathBuf,
    directory: File,
    lock: File,
    committed: Option<Vec<u8>>,
    blocked: bool,
    #[cfg(test)]
    pub fail_after_rename: bool,
}
impl Store {
    pub fn open(trusted: &TrustedRoot) -> Result<Self> {
        trusted.validate()?;
        let root = trusted.path().join("formal-platform-v1");
        match fs::symlink_metadata(&root) {
            Ok(_) => directory(&root, true)?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let mut builder = fs::DirBuilder::new();
                #[cfg(unix)]
                {
                    use std::os::unix::fs::DirBuilderExt;
                    builder.mode(0o700);
                }
                builder.create(&root)?;
                sync_dir(&root)?;
                sync_dir(trusted.path())?;
            }
            Err(_) => return Err(DesktopError("storeIo")),
        }
        let lock_path = root.join("writer.lock");
        if lock_path.try_exists()? {
            regular(&lock_path, 0)?;
        }
        let lock = options()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&lock_path)?;
        same_file(&lock.metadata()?, &regular(&lock_path, 0)?)?;
        lock.try_lock().map_err(|e| match e {
            TryLockError::WouldBlock => DesktopError("storeLocked"),
            _ => DesktopError("storeIo"),
        })?;
        let snapshot = root.join("snapshot.json");
        let committed = match fs::symlink_metadata(&snapshot) {
            Ok(_) => Some(read_regular(&snapshot, MAX_SNAPSHOT_BYTES)?),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(_) => return Err(DesktopError("storeIo")),
        };
        let directory = File::open(&root)?;
        directory.sync_all()?;
        sync_dir(trusted.path())?;
        Ok(Self {
            trusted: trusted.clone(),
            root,
            directory,
            lock,
            committed,
            blocked: false,
            #[cfg(test)]
            fail_after_rename: false,
        })
    }
    pub fn bytes(&self) -> Option<&[u8]> {
        self.committed.as_deref()
    }
    /// 已验证主快照后，清理上次进程在rename之前留下的私有临时文件。
    pub fn validate_pending(&self, validate: impl FnOnce(&[u8]) -> Result<()>) -> Result<()> {
        let pending = self.root.join("snapshot.pending");
        match fs::symlink_metadata(&pending) {
            Ok(_) => validate(&read_regular(&pending, MAX_SNAPSHOT_BYTES)?),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(DesktopError("storeIo")),
        }
    }
    pub fn recover_pending(&self) -> Result<()> {
        let pending = self.root.join("snapshot.pending");
        match fs::symlink_metadata(&pending) {
            Ok(_) => {
                regular(&pending, MAX_SNAPSHOT_BYTES)?;
                fs::remove_file(&pending)?;
                sync_dir(&self.root)
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(DesktopError("storeIo")),
        }
    }
    pub fn write(&mut self, bytes: Vec<u8>) -> Result<()> {
        self.write_with_sync(bytes, sync_dir)
    }
    fn write_with_sync(
        &mut self,
        bytes: Vec<u8>,
        sync: impl Fn(&Path) -> Result<()>,
    ) -> Result<()> {
        if self.blocked {
            return Err(DesktopError("recoveryRequired"));
        }
        snapshot_budget(&bytes)?;
        self.trusted.validate()?;
        directory(&self.root, true)?;
        same_file(
            &self.directory.metadata()?,
            &fs::symlink_metadata(&self.root)?,
        )?;
        same_file(
            &self.lock.metadata()?,
            &regular(&self.root.join("writer.lock"), 0)?,
        )?;
        let snapshot = self.root.join("snapshot.json");
        if let Some(expected) = &self.committed {
            if read_regular(&snapshot, MAX_SNAPSHOT_BYTES)? != *expected {
                return Err(DesktopError("storeChanged"));
            }
        } else if fs::symlink_metadata(&snapshot).is_ok() {
            return Err(DesktopError("storeChanged"));
        }
        let pending = self.root.join("snapshot.pending");
        // create_new失败时绝不清理外部已有文件。
        let mut file = options().write(true).create_new(true).open(&pending)?;
        let prepare = (|| -> Result<()> {
            file.write_all(&bytes)?;
            file.sync_all()?;
            same_file(&file.metadata()?, &regular(&pending, MAX_SNAPSHOT_BYTES)?)?;
            Ok(())
        })();
        if let Err(e) = prepare {
            let _ = fs::remove_file(&pending);
            return Err(e);
        }
        if fs::rename(&pending, &snapshot).is_err() {
            let _ = fs::remove_file(&pending);
            return Err(DesktopError("storeIo"));
        }
        // rename后失败无法断言旧文件仍在；此实例拒绝后续写，重开可恢复新事实。
        self.blocked = true;
        #[cfg(test)]
        if self.fail_after_rename {
            return Err(DesktopError("storeIo"));
        }
        sync(&self.root)?;
        self.committed = Some(bytes);
        self.blocked = false;
        Ok(())
    }
}
