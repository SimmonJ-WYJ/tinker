//! 小型原子索引与不可变 PNG 文件；仅在经过验证的私有根内读写。
use super::*;
use crate::formal_platform::store::{
    directory, options, read_regular, regular, sync_dir, write_new,
};
use std::{
    fs::{self, File},
    io::ErrorKind,
};

const INDEX: &str = "turns.json";
const MAX_INDEX_BYTES: usize = 4 * 1024 * 1024;
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Catalog {
    version: u32,
    turns: Vec<ImageTurn>,
}

pub(super) fn open(root: &Path) -> Result<(PathBuf, File)> {
    directory(root, true)?;
    let dir = root.join("formal-images-v1");
    private_dir(&dir)?;
    let lock = dir.join("writer.lock");
    if lock.symlink_metadata().is_ok() {
        read_regular(&lock, 0)?;
    }
    let file = options()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(lock)?;
    file.try_lock().map_err(|_| DesktopError("storeLocked"))?;
    Ok((dir, file))
}

pub(super) fn private_dir(path: &Path) -> Result<()> {
    let parent = path.parent().ok_or(DesktopError("unsafePath"))?;
    directory(parent, true)?;
    match path.symlink_metadata() {
        Ok(_) => directory(path, true),
        Err(e) if e.kind() == ErrorKind::NotFound => {
            let mut builder = fs::DirBuilder::new();
            #[cfg(unix)]
            {
                use std::os::unix::fs::DirBuilderExt;
                builder.mode(0o700);
            }
            builder.create(path)?;
            sync_dir(parent)
        }
        Err(e) => Err(e.into()),
    }
}

pub(super) fn read_index(dir: &Path, name: &str) -> Result<Option<Vec<u8>>> {
    // 只读访问未知会话不创建任何数据。
    directory(dir.parent().ok_or(DesktopError("unsafePath"))?, true)?;
    let missing = |p: &Path| -> Result<bool> {
        match p.symlink_metadata() {
            Ok(_) => Ok(false),
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(true),
            Err(e) => Err(e.into()),
        }
    };
    if missing(dir)? {
        return Ok(None);
    }
    directory(dir, true)?;
    let file = dir.join(name);
    if missing(&file)? {
        return Ok(None);
    }
    Ok(Some(read_regular(&file, MAX_INDEX_BYTES)?))
}

const EXTENSION: &str = "import-edits.json";
pub(super) fn load_turns(
    dir: &Path,
    session: &str,
    imports: Option<&[ImportedImage]>,
) -> Result<Vec<ImageTurn>> {
    let Some(bytes) = read_index(dir, if imports.is_some() { EXTENSION } else { INDEX })? else {
        return Ok(vec![]);
    };
    let catalog: Catalog =
        serde_json::from_slice(&bytes).map_err(|_| DesktopError("corruptImages"))?;
    if catalog.version != 1 {
        return Err(DesktopError("unsupportedVersion"));
    }
    if catalog.turns.len() > LIMIT {
        return Err(DesktopError("corruptImages"));
    }
    let mut ids: HashSet<_> = imports
        .unwrap_or_default()
        .iter()
        .map(|r| r.id.clone())
        .collect();
    let mut requests = HashSet::new();
    for turn in &catalog.turns {
        if id(&turn.request_id).is_err()
            || !valid_prompt(&turn.prompt)
            || (imports.is_some() && turn.base_image_id.is_none())
            || !requests.insert(&turn.request_id)
            || turn
                .base_image_id
                .as_ref()
                .is_some_and(|s| !ids.contains(s))
        {
            return Err(DesktopError("corruptImages"));
        }
        validate_result(session, turn, provider::MODEL, provider::CHANNEL)?;
        if let Some(a) = &turn.asset {
            ids.insert(a.id.clone());
        }
    }
    Ok(catalog.turns)
}

pub(super) fn validate_result(
    session: &str,
    turn: &ImageTurn,
    model: &str,
    channel: &str,
) -> Result<()> {
    match (&turn.status, &turn.asset, &turn.error) {
        (ImageStatus::Succeeded, Some(a), None)
            if a.id == image_id(session, &turn.request_id)
                && a.filename == format!("{}.png", a.id)
                && a.base_image_id == turn.base_image_id
                && a.reference_ids.iter().eq(turn.base_image_id.iter())
                && a.prompt == turn.prompt
                && a.model == model
                && a.channel_id == channel
                && a.width > 0
                && a.height > 0
                && provider::validate_pixel_count(a.width, a.height).is_ok()
                && a.content_sha256.len() == 64
                && a.content_sha256.bytes().all(|b| b.is_ascii_hexdigit()) =>
        {
            Ok(())
        }
        (ImageStatus::Failed, None, Some(_))
        | (ImageStatus::Pending | ImageStatus::Interrupted, None, None) => Ok(()),
        _ => Err(DesktopError("corruptImages")),
    }
}

pub(super) fn save_turns(dir: &Path, turns: &[ImageTurn], derived: bool) -> Result<()> {
    let data = serde_json::to_vec(&serde_json::json!({"version":1,"turns":turns}))
        .map_err(|_| DesktopError("storeIo"))?;
    write_index(dir, if derived { EXTENSION } else { INDEX }, &data)
}

pub(super) fn write_index(dir: &Path, name: &str, payload: &[u8]) -> Result<()> {
    atomic_write(dir, name, payload, MAX_INDEX_BYTES)
}
// 先同步临时文件，再一次发布；崩溃前已经写出的部份永不当作有效的最终 PNG。
pub(super) fn atomic_write(dir: &Path, name: &str, payload: &[u8], limit: usize) -> Result<()> {
    directory(dir, true)?;
    // 单写锁下复用暂存名；上次未发布的残留不会作为正式收据读取。
    let temp = if name == INDEX {
        dir.join("turns.next")
    } else {
        dir.join(format!("{name}.next"))
    };
    match temp.symlink_metadata() {
        Ok(_) => {
            regular(&temp, limit)?;
            fs::remove_file(&temp)?;
        }
        Err(e) if e.kind() == ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    if payload.len() > limit {
        return Err(DesktopError("storageLimit"));
    }
    write_new(&temp, payload)?;
    fs::rename(temp, dir.join(name))?;
    sync_dir(dir)
}
pub(super) fn png(dir: &Path, filename: &str, sha256: &str) -> Result<Vec<u8>> {
    directory(dir, true)?;
    let bytes = read_regular(&dir.join(filename), provider::MAX_PNG)?;
    if digest(&bytes) != sha256 {
        return Err(DesktopError("corruptImage"));
    }
    Ok(bytes)
}
pub(super) fn put(dir: &Path, name: &str, bytes: &[u8]) -> Result<()> {
    directory(dir, true)?;
    use std::io::Write;
    let path = dir.join(name);
    let mut file = options().write(true).create_new(true).open(&path)?;
    if let Err(error) = file
        .write_all(bytes)
        .and_then(|()| file.sync_all())
        .map_err(DesktopError::from)
        .and_then(|()| sync_dir(dir))
    {
        // create_new 已证明本次创建了文件；保留目录中预先存在的任何版本。
        fs::remove_file(path)?;
        sync_dir(dir)?;
        return Err(error);
    }
    Ok(())
}

pub(super) fn discard_uncommitted(dir: &Path, asset: &ImageAsset) -> Result<()> {
    png(dir, &asset.filename, &asset.content_sha256)?;
    fs::remove_file(dir.join(&asset.filename))?;
    sync_dir(dir)
}

// 在存储锁下统计原图、预览缓存与写入中断的残留文件。收据索引单独限额。
const SESSION_ASSET_BYTES: u64 = 128 * 1024 * 1024;
pub(super) fn asset_budget(dir: &Path, additional: usize) -> Result<()> {
    directory(dir, true)?;
    let mut total = additional as u64;
    for (i, entry) in fs::read_dir(dir)?.enumerate() {
        if i >= 12 * LIMIT + 32 {
            return Err(DesktopError("imageStorageLimit"));
        }
        let entry = entry?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let name = name.strip_suffix(".next").unwrap_or(name);
        if (name.ends_with(".png") || name.ends_with(".thumbnail-v1"))
            && entry.file_type()?.is_file()
        {
            // 只统计直接文件，跳过异常目录或链接，访问目标时另行校验。
            let size = fs::symlink_metadata(entry.path())?.len();
            total = total
                .checked_add(size)
                .ok_or(DesktopError("imageStorageLimit"))?;
            if total > SESSION_ASSET_BYTES {
                return Err(DesktopError("imageStorageLimit"));
            }
        }
    }
    Ok(())
}
