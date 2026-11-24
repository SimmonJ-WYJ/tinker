//! 项目目录仅通过已固定的描述符读写；路径失效时不向替代目录发布。
use super::{storage::project_name, DesktopError, Result, TrustedRoot, MAX_RECORD_BYTES, PENDING};
use std::{
    ffi::{CStr, CString, OsStr},
    fs::{self, File, Metadata},
    io::{ErrorKind, Read, Write},
    os::{
        fd::{AsRawFd, FromRawFd},
        unix::{ffi::OsStrExt, fs::MetadataExt},
    },
    path::{Component, Path},
};

fn name(value: &OsStr) -> Result<CString> {
    if !matches!(
        Path::new(value).components().next(),
        Some(Component::Normal(_))
    ) || value.as_bytes().contains(&b'/')
    {
        return Err(DesktopError("unsafePath"));
    }
    CString::new(value.as_bytes()).map_err(|_| DesktopError("unsafePath"))
}

fn open_at(dir: &File, name: &CStr, flags: i32) -> Result<Option<File>> {
    let fd = unsafe {
        libc::openat(
            dir.as_raw_fd(),
            name.as_ptr(),
            flags | libc::O_CLOEXEC | libc::O_NOFOLLOW | libc::O_NONBLOCK,
            0o600 as libc::c_int,
        )
    };
    if fd < 0 {
        let e = std::io::Error::last_os_error();
        return if e.kind() == ErrorKind::NotFound {
            Ok(None)
        } else if matches!(e.raw_os_error(), Some(libc::ELOOP | libc::ENOTDIR)) {
            Err(DesktopError("unsafePath"))
        } else {
            Err(e.into())
        };
    }
    Ok(Some(unsafe { File::from_raw_fd(fd) }))
}

fn open_root(path: &Path) -> Result<File> {
    let mut parts = path.components();
    if parts.next() != Some(Component::RootDir) {
        return Err(DesktopError("unsafePath"));
    }
    let mut dir = File::open("/")?;
    for part in parts {
        let Component::Normal(leaf) = part else {
            return Err(DesktopError("unsafePath"));
        };
        dir = open_at(&dir, &name(leaf)?, libc::O_DIRECTORY | libc::O_RDONLY)?
            .ok_or(DesktopError("unsafePath"))?;
    }
    Ok(dir)
}

fn private(meta: &Metadata) -> Result<()> {
    if meta.uid() != unsafe { libc::geteuid() } || meta.mode() & 0o077 != 0 {
        return Err(DesktopError("unsafePath"));
    }
    Ok(())
}

fn regular(file: &File) -> Result<Metadata> {
    let meta = file.metadata()?;
    private(&meta)?;
    if !meta.is_file() || meta.nlink() != 1 {
        return Err(DesktopError("unsafePath"));
    }
    if meta.len() > MAX_RECORD_BYTES as u64 {
        return Err(DesktopError("storageLimit"));
    }
    Ok(meta)
}

fn same(a: &Metadata, b: &Metadata) -> Result<()> {
    if (a.dev(), a.ino()) != (b.dev(), b.ino()) {
        return Err(DesktopError("storeChanged"));
    }
    Ok(())
}

pub(super) struct ProjectDir {
    trusted: TrustedRoot,
    parent: File,
    leaf: CString,
    file: File,
}

impl ProjectDir {
    pub(super) fn open(root: &TrustedRoot, workspace: &str, write: bool) -> Result<Option<Self>> {
        Self::open_with_sync(root, workspace, write, |dir| Ok(dir.sync_all()?))
    }

    pub(super) fn open_with_sync(
        root: &TrustedRoot,
        workspace: &str,
        write: bool,
        sync_parent: impl FnOnce(&File) -> Result<()>,
    ) -> Result<Option<Self>> {
        let leaf = name(OsStr::new(&project_name(workspace)?))?;
        let parent = open_root(root.path())?;
        root.validate()?;
        same(&parent.metadata()?, &fs::symlink_metadata(root.path())?)?;
        if write {
            let rc = unsafe { libc::mkdirat(parent.as_raw_fd(), leaf.as_ptr(), 0o700) };
            if rc != 0 && std::io::Error::last_os_error().kind() != ErrorKind::AlreadyExists {
                return Err(DesktopError("storeIo"));
            }
            // 上次 mkdir 之后如未确认父目录同步，本次即使目录已存在也必须重做。
            sync_parent(&parent)?;
        }
        let Some(file) = open_at(&parent, &leaf, libc::O_DIRECTORY | libc::O_RDONLY)? else {
            return Ok(None);
        };
        private(&file.metadata()?)?;
        if write {
            file.try_lock().map_err(|e| match e {
                fs::TryLockError::WouldBlock => DesktopError("storeLocked"),
                fs::TryLockError::Error(e) => e.into(),
            })?;
        }
        let dir = Self {
            trusted: root.clone(),
            parent,
            leaf,
            file,
        };
        dir.verify_current()?;
        Ok(Some(dir))
    }

    pub(super) fn verify_current(&self) -> Result<()> {
        self.trusted.validate()?;
        same(
            &self.parent.metadata()?,
            &fs::symlink_metadata(self.trusted.path())?,
        )?;
        let entry = open_at(&self.parent, &self.leaf, libc::O_DIRECTORY | libc::O_RDONLY)?
            .ok_or(DesktopError("storeChanged"))?;
        private(&entry.metadata()?)?;
        same(&self.file.metadata()?, &entry.metadata()?)
    }

    pub(super) fn read(&self, leaf: &str) -> Result<Option<Vec<u8>>> {
        let Some(mut file) = open_at(&self.file, &name(OsStr::new(leaf))?, libc::O_RDONLY)? else {
            return Ok(None);
        };
        let before = regular(&file)?;
        let mut bytes = Vec::with_capacity(before.len() as usize);
        (&mut file)
            .take(MAX_RECORD_BYTES as u64 + 1)
            .read_to_end(&mut bytes)?;
        let after = regular(&file)?;
        if before.len() != bytes.len() as u64
            || after.len() != before.len()
            || before.modified()? != after.modified()?
        {
            return Err(DesktopError("storeChanged"));
        }
        Ok(Some(bytes))
    }

    pub(super) fn clear_pending(&self) -> Result<()> {
        self.verify_current()?;
        let pending = name(OsStr::new(PENDING))?;
        if let Some(file) = open_at(&self.file, &pending, libc::O_RDONLY)? {
            regular(&file)?;
            if unsafe { libc::unlinkat(self.file.as_raw_fd(), pending.as_ptr(), 0) } != 0 {
                return Err(DesktopError("storeIo"));
            }
        }
        Ok(())
    }

    pub(super) fn publish(&self, leaf: &str, bytes: &[u8]) -> Result<()> {
        self.verify_current()?;
        let dest = name(OsStr::new(leaf))?;
        let pending = name(OsStr::new(PENDING))?;
        if bytes.len() > MAX_RECORD_BYTES {
            return Err(DesktopError("storageLimit"));
        }
        let mut file = open_at(
            &self.file,
            &pending,
            libc::O_CREAT | libc::O_EXCL | libc::O_WRONLY,
        )?
        .ok_or(DesktopError("storeIo"))?;
        file.write_all(bytes)?;
        file.sync_all()?;
        self.verify_current()?;
        let fd = self.file.as_raw_fd();
        #[cfg(target_os = "macos")]
        let rc = unsafe {
            libc::renameatx_np(fd, pending.as_ptr(), fd, dest.as_ptr(), libc::RENAME_EXCL)
        };
        #[cfg(target_os = "linux")]
        let rc = unsafe {
            libc::syscall(
                libc::SYS_renameat2,
                fd,
                pending.as_ptr(),
                fd,
                dest.as_ptr(),
                libc::RENAME_NOREPLACE,
            )
        };
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        let rc = {
            if open_at(&self.file, &dest, libc::O_RDONLY)?.is_some() {
                return Err(DesktopError("storeChanged"));
            }
            unsafe { libc::renameat(fd, pending.as_ptr(), fd, dest.as_ptr()) }
        };
        if rc != 0 {
            return Err(DesktopError("storeIo"));
        }
        self.commit()
    }

    pub(super) fn commit(&self) -> Result<()> {
        self.file.sync_all()?;
        self.verify_current()
    }
}
