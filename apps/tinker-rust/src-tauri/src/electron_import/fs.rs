//! 以用户选择的目录为读取边界，逐层验证目录句柄，不跟随符号链接。
use super::{DesktopError, Result};
use std::{
    ffi::{CStr, CString, OsStr},
    fs::File,
    io::{ErrorKind, Read},
    os::{
        fd::{AsRawFd, FromRawFd},
        unix::{ffi::OsStrExt, fs::MetadataExt},
    },
    path::{Component, Path},
};

pub(super) struct Dir(File);
const UNSAFE: DesktopError = DesktopError("unsafeImportPath");
const IO: DesktopError = DesktopError("importReadFailed");
fn open(dir: &File, name: &OsStr, flags: i32) -> Result<Option<File>> {
    if Path::new(name).components().count() != 1
        || !matches!(
            Path::new(name).components().next(),
            Some(Component::Normal(_))
        )
        || name.as_bytes().contains(&b'/')
    {
        return Err(UNSAFE);
    }
    let c = CString::new(name.as_bytes()).map_err(|_| UNSAFE)?;
    // 只读打开文件；O_NONBLOCK 防止被替换成 FIFO 后阻塞。
    let fd = unsafe {
        libc::openat(
            dir.as_raw_fd(),
            c.as_ptr(),
            flags | libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NONBLOCK | libc::O_NOFOLLOW,
        )
    };
    if fd < 0 {
        let e = std::io::Error::last_os_error();
        return if e.kind() == ErrorKind::NotFound {
            Ok(None)
        } else if matches!(e.raw_os_error(), Some(libc::ELOOP | libc::ENOTDIR)) {
            Err(UNSAFE)
        } else {
            Err(IO)
        };
    }
    Ok(Some(unsafe { File::from_raw_fd(fd) }))
}
impl Dir {
    pub(super) fn selected(path: &Path) -> Result<Self> {
        let mut parts = path.components();
        if parts.next() != Some(Component::RootDir) {
            return Err(UNSAFE);
        }
        let mut fd = File::open("/").map_err(|_| IO)?;
        for part in parts {
            let Component::Normal(name) = part else {
                return Err(UNSAFE);
            };
            fd = open(&fd, name, libc::O_DIRECTORY)?.ok_or(DesktopError("invalidImportFolder"))?;
        }
        Ok(Self(fd))
    }
    pub(super) fn identity(&self) -> Result<(u64, u64)> {
        let meta = self.0.metadata().map_err(|_| IO)?;
        Ok((meta.dev(), meta.ino()))
    }
    pub(super) fn child(&self, name: &str) -> Result<Option<Self>> {
        open(&self.0, OsStr::new(name), libc::O_DIRECTORY).map(|f| f.map(Self))
    }
    pub(super) fn file(&self, name: &str, limit: usize) -> Result<Option<Vec<u8>>> {
        let Some(mut file) = open(&self.0, OsStr::new(name), 0)? else {
            return Ok(None);
        };
        let before = file.metadata().map_err(|_| IO)?;
        if !before.is_file() || before.nlink() != 1 {
            return Err(UNSAFE);
        }
        if before.len() > limit as u64 {
            return Err(DesktopError("importLimit"));
        }
        let mut bytes = Vec::with_capacity(before.len() as usize);
        (&mut file)
            .take(limit as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| IO)?;
        let after = file.metadata().map_err(|_| IO)?;
        if before.len() != bytes.len() as u64
            || after.len() != before.len()
            || after.nlink() != 1
            || before.modified().ok() != after.modified().ok()
        {
            return Err(IO);
        }
        Ok(Some(bytes))
    }
    // 仅在 sdk-config/projects 枚举一级目录，再按索引指定的 SDK ID 读取文件。
    pub(super) fn project_names(&self) -> Result<Vec<String>> {
        struct Stream(*mut libc::DIR);
        impl Drop for Stream {
            fn drop(&mut self) {
                unsafe { libc::closedir(self.0) };
            }
        }
        let dup = unsafe { libc::fcntl(self.0.as_raw_fd(), libc::F_DUPFD_CLOEXEC, 0) };
        if dup < 0 {
            return Err(IO);
        }
        let raw = unsafe { libc::fdopendir(dup) };
        if raw.is_null() {
            unsafe { libc::close(dup) };
            return Err(IO);
        }
        let stream = Stream(raw);
        let mut names = Vec::new();
        let mut count = 0;
        loop {
            unsafe { *libc::__error() = 0 };
            let entry = unsafe { libc::readdir(stream.0) };
            if entry.is_null() {
                if unsafe { *libc::__error() } != 0 {
                    return Err(IO);
                }
                break;
            }
            let name = unsafe { CStr::from_ptr((*entry).d_name.as_ptr()) };
            if matches!(name.to_bytes(), b"." | b"..") {
                continue;
            }
            count += 1;
            if count > 256 {
                return Err(DesktopError("importLimit"));
            }
            if name.to_bytes().starts_with(b".")
                || !matches!(unsafe { (*entry).d_type }, libc::DT_DIR | libc::DT_UNKNOWN)
            {
                continue;
            }
            if let Ok(name) = name.to_str() {
                names.push(name.to_owned());
            }
        }
        names.sort();
        Ok(names)
    }
}
