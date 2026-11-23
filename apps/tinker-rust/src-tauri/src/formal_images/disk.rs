//! 小型原子索引与不可变 PNG 文件；仅在经过验证的私有根内读写。
use super::*;
use crate::formal_platform::store::{directory, options, read_regular, sync_dir, write_new};
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

pub(super) fn load(dir: &Path, session: &str) -> Result<Vec<ImageTurn>> {
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
        return Ok(vec![]);
    }
    directory(dir, true)?;
    let file = dir.join(INDEX);
    if missing(&file)? {
        return Ok(vec![]);
    }
    let catalog: Catalog = serde_json::from_slice(&read_regular(&file, MAX_INDEX_BYTES)?)
        .map_err(|_| DesktopError("corruptImages"))?;
    if catalog.version != 1 {
        return Err(DesktopError("unsupportedVersion"));
    }
    if catalog.turns.len() > LIMIT {
        return Err(DesktopError("corruptImages"));
    }
    let mut ids = HashSet::new();
    let mut requests = HashSet::new();
    for turn in &catalog.turns {
        if id(&turn.request_id).is_err()
            || !valid_prompt(&turn.prompt)
            || !requests.insert(&turn.request_id)
            || turn
                .base_image_id
                .as_ref()
                .is_some_and(|s| !ids.contains(s))
        {
            return Err(DesktopError("corruptImages"));
        }
        match (&turn.status, &turn.asset, &turn.error) {
            (ImageStatus::Succeeded, Some(asset), None)
                if asset.id == image_id(session, &turn.request_id)
                    && asset.filename == format!("{}.png", asset.id)
                    && asset.base_image_id == turn.base_image_id
                    && asset.reference_ids.iter().eq(turn.base_image_id.iter())
                    && asset.prompt == turn.prompt
                    && asset.model == provider::MODEL
                    && asset.channel_id == provider::CHANNEL
                    && asset.content_sha256.len() == 64 =>
            {
                ids.insert(asset.id.clone());
            }
            (ImageStatus::Failed, None, Some(_))
            | (ImageStatus::Pending | ImageStatus::Interrupted, None, None) => {}
            _ => return Err(DesktopError("corruptImages")),
        }
    }
    Ok(catalog.turns)
}

pub(super) fn save(dir: &Path, turns: &[ImageTurn]) -> Result<()> {
    directory(dir, true)?;
    // 单写锁下复用暂存名；上次未发布的残留不会作为正式收据读取。
    let temp = dir.join("turns.next");
    match temp.symlink_metadata() {
        Ok(_) => {
            read_regular(&temp, MAX_INDEX_BYTES)?;
            fs::remove_file(&temp)?;
        }
        Err(e) if e.kind() == ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    let payload = serde_json::to_vec(&serde_json::json!({"version":1,"turns":turns}))
        .map_err(|_| DesktopError("storeIo"))?;
    if payload.len() > MAX_INDEX_BYTES {
        return Err(DesktopError("storageLimit"));
    }
    write_new(&temp, &payload)?;
    fs::rename(temp, dir.join(INDEX))?;
    sync_dir(dir)
}
pub(super) fn png(dir: &Path, asset: &ImageAsset) -> Result<Vec<u8>> {
    directory(dir, true)?;
    let bytes = read_regular(&dir.join(&asset.filename), provider::MAX_PNG)?;
    if digest(&bytes) != asset.content_sha256 {
        return Err(DesktopError("corruptImage"));
    }
    Ok(bytes)
}
pub(super) fn put(dir: &Path, name: &str, bytes: &[u8]) -> Result<()> {
    directory(dir, true)?;
    write_new(&dir.join(name), bytes)?;
    sync_dir(dir)
}
