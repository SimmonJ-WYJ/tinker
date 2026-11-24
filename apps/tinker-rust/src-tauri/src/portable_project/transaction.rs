//! 先在私有目录验证完整资产图，再持久化唯一提交意图。恢复在打开桌面窗口前结束。
use super::*;
use crate::formal_platform::store::{directory, read_regular, sync_dir, write_new};
use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
};
const NAMESPACE: &str = "portable-project-v1";
const INTENT: &str = "pending.tinkerproject";
#[derive(Clone, Copy, PartialEq)]
enum Mode {
    Inspect,
    Restore,
    Recover,
}
struct Transaction<'a, P> {
    root: &'a TrustedRoot,
    runtime: &'a DesktopRuntime,
    platform: &'a P,
    images: &'a ImageStore,
}

fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn exists(path: &Path) -> Result<bool> {
    match path.symlink_metadata() {
        Ok(_) => Ok(true),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e.into()),
    }
}
fn namespace(root: &TrustedRoot) -> Result<PathBuf> {
    root.validate()?;
    let path = root.path().join(NAMESPACE);
    if !exists(&path)? {
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(&path)?;
        sync_dir(root.path())?;
    }
    directory(&path, true)?;
    Ok(path)
}
// 所有名称来自宿主固定值或摘要，创建文件、同步、原子发布后再确认父目录。
fn publish_file(base: &Path, name: &str, bytes: &[u8]) -> Result<()> {
    let temp = base.join("write.pending");
    if exists(&temp)? {
        crate::formal_platform::store::regular(&temp, MAX_ARCHIVE_BYTES)?;
        fs::remove_file(&temp)?;
    }
    write_new(&temp, bytes)?;
    rename_new(&temp, &base.join(name))?;
    sync_dir(base)
}
fn rename_new(from: &Path, to: &Path) -> Result<()> {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        use std::{ffi::CString, os::unix::ffi::OsStrExt};
        let cpath = |p: &Path| {
            CString::new(p.as_os_str().as_bytes()).map_err(|_| DesktopError("unsafePath"))
        };
        let (from, to) = (cpath(from)?, cpath(to)?);
        #[cfg(target_os = "macos")]
        let status = unsafe { libc::renamex_np(from.as_ptr(), to.as_ptr(), libc::RENAME_EXCL) };
        #[cfg(target_os = "linux")]
        let status = unsafe {
            libc::renameat2(
                libc::AT_FDCWD,
                from.as_ptr(),
                libc::AT_FDCWD,
                to.as_ptr(),
                libc::RENAME_NOREPLACE,
            )
        };
        if status != 0 {
            return Err(match io::Error::last_os_error().kind() {
                ErrorKind::AlreadyExists => DesktopError("projectConflict"),
                _ => DesktopError("storeIo"),
            });
        }
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = (from, to);
        Err(DesktopError("unsupportedPlatform"))
    }
}
struct Staging(TrustedRoot);
impl Staging {
    fn new(root: &TrustedRoot) -> Result<Self> {
        let path = root.path().join(NAMESPACE).join("stage");
        if exists(&path)? {
            directory(&path, true)?;
            // 固定私有临时命名空间仅由此事务使用；remove_dir_all 不跟随符号链接。
            fs::remove_dir_all(&path)?;
        }
        Ok(Self(TrustedRoot::create_portable_staging(root)?))
    }
}
impl Drop for Staging {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(self.0.path());
    }
}
fn receipt_name(id: &str) -> String {
    format!("receipt-{}.sha256", hash(id.as_bytes()))
}
fn read_receipt(base: &Path, id: &str) -> Result<Option<Vec<u8>>> {
    let path = base.join(receipt_name(id));
    if exists(&path)? {
        Ok(Some(read_regular(&path, 64)?))
    } else {
        Ok(None)
    }
}
fn asset_dir(base: &Path, group: Option<&SessionImages>, project: &str) -> PathBuf {
    match group {
        Some(group) => base
            .join("formal-images-v1")
            .join(hash(group.session_id.as_bytes())),
        None => base.join(format!("project-documents-v1-{}", hash(project.as_bytes()))),
    }
}
fn install_directory(stage: &Path, live: &Path) -> Result<()> {
    directory(stage, true)?;
    let source = stage.parent().ok_or(DesktopError("unsafePath"))?;
    let target = live.parent().ok_or(DesktopError("unsafePath"))?;
    directory(target, true)?;
    rename_new(stage, live)?;
    sync_dir(target)?;
    sync_dir(source)
}
fn same<T: Serialize>(a: &T, b: &T) -> Result<()> {
    let fingerprint = |v: &T| {
        struct HashWriter(Sha256);
        impl Write for HashWriter {
            fn write(&mut self, b: &[u8]) -> io::Result<usize> {
                self.0.update(b);
                Ok(b.len())
            }
            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }
        let mut hasher = HashWriter(Sha256::new());
        serde_json::to_writer(&mut hasher, v).map_err(|_| DesktopError("invalidProjectArchive"))?;
        Ok::<_, DesktopError>(hasher.0.finalize())
    };
    if fingerprint(a)? != fingerprint(b)? {
        return Err(DesktopError("projectConflict"));
    }
    Ok(())
}
pub(crate) fn recover(
    root: &TrustedRoot,
    runtime: &DesktopRuntime,
    platform: &impl ProjectCatalog,
    images: &ImageStore,
) -> Result<()> {
    root.validate()?;
    let base = root.path().join(NAMESPACE);
    if !exists(&base)? {
        return Ok(());
    }
    directory(&base, true)?;
    let path = base.join(INTENT);
    if exists(&path)? {
        let bytes = read_regular(&path, MAX_ARCHIVE_BYTES)?;
        Transaction {
            root,
            runtime,
            platform,
            images,
        }
        .apply(&bytes, decode(&bytes)?, &base, Mode::Recover)?;
    }
    Ok(())
}
pub(crate) fn restore(
    root: &TrustedRoot,
    runtime: &DesktopRuntime,
    platform: &impl ProjectCatalog,
    images: &ImageStore,
    bytes: &[u8],
) -> Result<RestoreReport> {
    // 非法容器连暂存目录也不创建。
    let payload = decode(bytes)?;
    recover(root, runtime, platform, images)?;
    let base = namespace(root)?;
    Transaction {
        root,
        runtime,
        platform,
        images,
    }
    .apply(bytes, payload, &base, Mode::Restore)
}
pub(crate) fn preflight(
    root: &TrustedRoot,
    runtime: &DesktopRuntime,
    platform: &impl ProjectCatalog,
    images: &ImageStore,
    bytes: &[u8],
) -> Result<Summary> {
    let payload = decode(bytes)?;
    let info = summary(&payload);
    let base = namespace(root)?;
    if exists(&base.join(INTENT))? {
        return Err(DesktopError("recoveryRequired"));
    }
    Transaction {
        root,
        runtime,
        platform,
        images,
    }
    .apply(bytes, payload, &base, Mode::Inspect)?;
    Ok(info)
}
impl<P: ProjectCatalog> Transaction<'_, P> {
    fn apply(
        &self,
        bytes: &[u8],
        mut payload: Payload,
        base: &Path,
        mode: Mode,
    ) -> Result<RestoreReport> {
        let Self {
            root,
            runtime,
            platform,
            images,
        } = *self;
        let recovering = mode == Mode::Recover;
        guard_text(platform, bytes)?;
        let project = &payload.project;
        let digest = hash(bytes);
        let receipt = read_receipt(base, &project.id)?;
        let existing = platform.portable_project(&project.id)?;
        if let Some(saved) = &receipt {
            if saved != digest.as_bytes() || (!recovering && existing.is_none()) {
                return Err(DesktopError("projectConflict"));
            }
            if existing.is_some() {
                if recovering {
                    fs::remove_file(base.join(INTENT))?;
                    sync_dir(base)?;
                }
                return Ok(RestoreReport {
                    workspace_id: project.id.clone(),
                    already_restored: true,
                });
            }
            // 已提交会话 journal 与收据，目录尚未发布；重启须先结束这一笔事务。
            sync_dir(base)?;
        }
        if let Some(existing) = &existing {
            if !recovering || existing != project {
                return Err(DesktopError("projectConflict"));
            }
        } else {
            platform.prepare_portable_project(project, false)?;
        }
        let map = runtime.map_portable_sessions(&project.id, &mut payload.sessions)?;
        for group in &mut payload.images {
            if let Some(new) = map.get(&group.session_id) {
                if new != &group.session_id {
                    group.images.remap_session(&group.session_id, new)?;
                    group.session_id = new.clone();
                }
            }
        }
        runtime.preflight_portable_sessions(&project.id, &payload.sessions)?;
        let staging = Staging::new(root)?;
        formal_documents::stage_portable(&staging.0, &project.id, &payload.documents)?;
        let staged_images = ImageStore::open(staging.0.path())?;
        for group in &payload.images {
            staged_images.stage_portable(&group.session_id, &group.images)?;
        }
        for session in &payload.sessions {
            session.validate_references(&staging.0, &project.id)?;
        }
        drop(staged_images);
        // 在写入提交意图之前排除任何私有目标冲突，绝不认领既有资料目录。
        let mut moves = Vec::new();
        let docs_live = asset_dir(root.path(), None, &project.id);
        if exists(&docs_live)? {
            if !recovering {
                return Err(DesktopError("projectConflict"));
            }
            same(
                &formal_documents::export_portable(root, &project.id)?,
                &formal_documents::export_portable(&staging.0, &project.id)?,
            )?;
            sync_dir(root.path())?;
        } else if !payload.documents.is_empty() {
            moves.push((asset_dir(staging.0.path(), None, &project.id), docs_live));
        }
        for session in &payload.sessions {
            if !payload
                .images
                .iter()
                .any(|group| group.session_id == session.session_id())
            {
                let image_dir = root
                    .path()
                    .join("formal-images-v1")
                    .join(hash(session.session_id().as_bytes()));
                if exists(&image_dir)? {
                    return Err(DesktopError("projectConflict"));
                }
            }
        }
        for group in &payload.images {
            let live = asset_dir(root.path(), Some(group), &project.id);
            if exists(&live)? {
                if !recovering {
                    return Err(DesktopError("projectConflict"));
                }
                let mut budget = MAX_ARCHIVE_BYTES;
                same(
                    &images.export_portable(&group.session_id, &mut budget)?,
                    &group.images,
                )?;
                sync_dir(live.parent().ok_or(DesktopError("unsafePath"))?)?;
            } else {
                moves.push((asset_dir(staging.0.path(), Some(group), &project.id), live));
            }
        }
        if mode == Mode::Inspect {
            return Ok(RestoreReport {
                workspace_id: project.id.clone(),
                already_restored: false,
            });
        }
        if !recovering {
            publish_file(base, INTENT, bytes)?;
        }
        for (from, to) in moves {
            install_directory(&from, &to)?;
        }
        runtime.restore_portable_sessions(&project.id, &payload.sessions, || {
            if receipt.is_none() {
                publish_file(base, &receipt_name(&project.id), digest.as_bytes())?;
            }
            if existing.is_none() {
                platform.prepare_portable_project(project, true)?;
            }
            Ok(())
        })?;
        fs::remove_file(base.join(INTENT))?;
        sync_dir(base)?;
        Ok(RestoreReport {
            workspace_id: project.id.clone(),
            already_restored: false,
        })
    }
}
