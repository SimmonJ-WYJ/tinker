//! 所有外部路径仅来自平台面板。临时文件与确认的目标固定在同一个目录句柄内。
use crate::desktop_runtime::protocol::{DesktopError, Result};
use std::{
    ffi::{CString, OsStr},
    fs::File,
    io::{Read, Write},
    os::{
        fd::{AsRawFd, FromRawFd},
        unix::{ffi::OsStrExt, fs::MetadataExt},
    },
    path::{Component, Path, PathBuf},
};

fn unavailable<T>(_: T) -> DesktopError {
    DesktopError("imageFileUnavailable")
}
fn name(s: &OsStr) -> Result<CString> {
    CString::new(s.as_bytes()).map_err(unavailable)
}
// 相对于已经打开的目录描述符逐层查找，全程禁用符号链接。
fn open_at(dir: &File, leaf: &CString, flags: i32) -> Result<File> {
    let fd = unsafe {
        libc::openat(
            dir.as_raw_fd(),
            leaf.as_ptr(),
            flags | libc::O_CLOEXEC | libc::O_NOFOLLOW,
            0o600 as libc::c_int,
        )
    };
    if fd < 0 {
        return Err(unavailable(()));
    }
    Ok(unsafe { File::from_raw_fd(fd) })
}
fn directory(path: &Path) -> Result<File> {
    directory_outside(path, None)
}
fn directory_outside(path: &Path, excluded: Option<(u64, u64)>) -> Result<File> {
    let mut parts = path.components();
    if parts.next() != Some(Component::RootDir) {
        return Err(unavailable(()));
    }
    let mut dir = File::open("/").map_err(unavailable)?;
    for part in parts {
        let Component::Normal(leaf) = part else {
            return Err(unavailable(()));
        };
        dir = open_at(&dir, &name(leaf)?, libc::O_DIRECTORY | libc::O_RDONLY)?;
        if let Some(identity) = excluded {
            let meta = dir.metadata().map_err(unavailable)?;
            if (meta.dev(), meta.ino()) == identity {
                return Err(unavailable(()));
            }
        }
    }
    Ok(dir)
}
fn split(path: &Path) -> Result<(&Path, &str)> {
    let parent = path.parent().ok_or_else(|| unavailable(()))?;
    let leaf = path
        .file_name()
        .and_then(OsStr::to_str)
        .filter(|s| !s.is_empty() && s.len() <= 255 && !s.chars().any(char::is_control))
        .ok_or_else(|| unavailable(()))?;
    Ok((parent, leaf))
}
pub(super) fn read_selected(path: &Path) -> Result<(String, Vec<u8>)> {
    let (leaf, file) = open_selected(path, None)?;
    let bytes = read_bounded(file, crate::picked_image::MAX_PICKED_BYTES, "imageTooLarge")?;
    Ok((leaf, bytes))
}
pub(super) fn open_selected(path: &Path, excluded: Option<(u64, u64)>) -> Result<(String, File)> {
    let (parent, leaf) = split(path)?;
    let dir = directory_outside(parent, excluded)?;
    let file = open_at(
        &dir,
        &name(OsStr::new(leaf))?,
        libc::O_RDONLY | libc::O_NONBLOCK,
    )?;
    let meta = file.metadata().map_err(unavailable)?;
    if !meta.is_file() || (excluded.is_some() && meta.nlink() != 1) {
        return Err(unavailable(()));
    }
    Ok((leaf.to_owned(), file))
}
pub(super) fn read_bounded(file: File, max: usize, limit_error: &'static str) -> Result<Vec<u8>> {
    let meta = file.metadata().map_err(unavailable)?;
    if meta.len() > max as u64 {
        return Err(DesktopError(limit_error));
    }
    let mut bytes = Vec::with_capacity(meta.len() as usize);
    file.take(max as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(unavailable)?;
    if bytes.len() > max {
        return Err(DesktopError(limit_error));
    }
    if bytes.len() as u64 != meta.len() {
        return Err(unavailable(()));
    }
    Ok(bytes)
}
pub(crate) struct StagedExport {
    dir: File,
    parent: PathBuf,
    temp: CString,
    dest: CString,
    active: bool,
}
pub(super) fn stage_export(path: &Path, bytes: &[u8]) -> Result<StagedExport> {
    if bytes.len() > crate::formal_images::MAX_PNG {
        return Err(DesktopError("imageTooLarge"));
    }
    let (parent, leaf) = split(path)?;
    if !path
        .extension()
        .and_then(OsStr::to_str)
        .is_some_and(|v| v.eq_ignore_ascii_case("png"))
    {
        return Err(DesktopError("unsupportedImageFormat"));
    }
    let dir = directory(parent)?;
    let temp = CString::new(format!(
        ".tinker-{}.tmp",
        crate::credentialed_channels::catalog::random_reference()?
    ))
    .map_err(unavailable)?;
    let mut file = open_at(&dir, &temp, libc::O_CREAT | libc::O_EXCL | libc::O_WRONLY)?;
    let stage = StagedExport {
        dir,
        parent: parent.to_owned(),
        temp,
        dest: name(OsStr::new(leaf))?,
        active: true,
    };
    file.write_all(bytes)
        .and_then(|()| file.sync_all())
        .map_err(unavailable)?;
    Ok(stage)
}
impl StagedExport {
    pub(crate) fn commit(mut self) -> Result<()> {
        let expected = self.dir.metadata().map_err(unavailable)?;
        let current = directory(&self.parent)?.metadata().map_err(unavailable)?;
        if (current.dev(), current.ino()) != (expected.dev(), expected.ino()) {
            return Err(unavailable(()));
        }
        let dir = self.dir.as_raw_fd();
        let rc = unsafe {
            libc::renameatx_np(
                dir,
                self.temp.as_ptr(),
                dir,
                self.dest.as_ptr(),
                libc::RENAME_EXCL,
            )
        };
        if rc != 0 {
            return Err(
                if std::io::Error::last_os_error().kind() == std::io::ErrorKind::AlreadyExists {
                    DesktopError("imageFileExists")
                } else {
                    unavailable(())
                },
            );
        }
        self.active = false;
        Ok(())
    }
}
impl Drop for StagedExport {
    fn drop(&mut self) {
        if self.active {
            unsafe { libc::unlinkat(self.dir.as_raw_fd(), self.temp.as_ptr(), 0) };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, os::unix::fs::symlink};
    fn directory() -> PathBuf {
        let dir = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "tinker-native-panel-{}",
            crate::credentialed_channels::catalog::random_reference().unwrap()
        ));
        fs::create_dir(&dir).unwrap();
        dir
    }
    #[test]
    fn only_regular_selected_inputs_and_new_png_destinations_are_used() {
        let root = directory();
        let file = root.join("fixture.png");
        fs::write(&file, b"png").unwrap();
        assert_eq!(read_selected(&file).unwrap().1, b"png");
        let alias = root.join("alias.png");
        symlink(&file, &alias).unwrap();
        assert!(read_selected(&alias).is_err());
        let target = root.join("export.png");
        assert_eq!(
            stage_export(&target, &vec![0; crate::formal_images::MAX_PNG + 1])
                .err()
                .unwrap()
                .0,
            "imageTooLarge"
        );
        assert!(!target.exists());
        let staged = stage_export(&target, b"first").unwrap();
        assert!(!target.exists());
        fs::write(&target, b"other").unwrap();
        assert!(staged.commit().is_err());
        assert_eq!(fs::read(&target).unwrap(), b"other");
        assert!(stage_export(&root.join("bad.jpg"), b"x").is_err());
        assert!(stage_export(&alias, b"x")
            .and_then(|stage| stage.commit())
            .is_err());
        assert_eq!(fs::read(file).unwrap(), b"png");
        let cancelled = root.join("cancelled.png");
        drop(stage_export(&cancelled, b"discard").unwrap());
        assert!(!cancelled.exists());
        let output = root.join("saved.png");
        stage_export(&output, b"final").unwrap().commit().unwrap();
        assert_eq!(fs::read(output).unwrap(), b"final");
        assert_eq!(root.read_dir().unwrap().count(), 4);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn special_input_and_swapped_parent_are_rejected_or_stay_anchored() {
        let root = directory();
        let parent = root.join("dir");
        fs::create_dir(&parent).unwrap();
        let fifo = parent.join("fifo.png");
        let name = CString::new(fifo.as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(name.as_ptr(), 0o600) }, 0);
        assert!(read_selected(&fifo).is_err());
        let stage = stage_export(&parent.join("test.png"), b"safe").unwrap();
        let original = root.join("renamed");
        fs::rename(&parent, &original).unwrap();
        let other = root.join("other");
        fs::create_dir(&other).unwrap();
        symlink(&other, &parent).unwrap();
        assert!(stage.commit().is_err());
        assert!(!other.join("test.png").exists());
        assert!(!original.join("test.png").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
