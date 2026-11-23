//! 独立原生预览的会话图片版本、请求收据与只读恢复。
mod disk;
mod provider;
#[cfg(test)]
mod tests;

use crate::desktop_runtime::protocol::{id, DesktopError, Result, MAX_SAFE_INTEGER};
use base64::{engine::general_purpose::STANDARD, Engine};
pub use provider::LoopbackImageProvider;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::File,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, MutexGuard,
    },
};
const LIMIT: usize = 128;
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImageStatus {
    Pending,
    Succeeded,
    Failed,
    Interrupted,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImageAsset {
    pub id: String,
    pub filename: String,
    pub prompt: String,
    pub model: String,
    pub channel_id: String,
    pub base_image_id: Option<String>,
    pub reference_ids: Vec<String>,
    pub width: u32,
    pub height: u32,
    pub content_sha256: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImageTurn {
    pub request_id: String,
    pub prompt: String,
    pub base_image_id: Option<String>,
    pub created_at: u64,
    pub status: ImageStatus,
    pub asset: Option<ImageAsset>,
    pub error: Option<String>,
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn image_id(session: &str, request: &str) -> String {
    format!(
        "img-{}",
        &digest(format!("{session}/{request}").as_bytes())[..32]
    )
}
fn valid_prompt(prompt: &str) -> bool {
    !prompt.trim().is_empty() && prompt.len() <= 8192
}
type Active = HashSet<(String, String)>;
struct Store {
    dir: PathBuf,
    _lock: File,
    active: Mutex<Active>,
}
#[derive(Clone)]
pub struct ImageStore(Arc<Store>);
impl ImageStore {
    pub fn open(root: &Path) -> Result<Self> {
        let (dir, lock) = disk::open(root)?;
        Ok(Self(Arc::new(Store {
            dir,
            _lock: lock,
            active: Mutex::default(),
        })))
    }
    fn guard(&self) -> Result<MutexGuard<'_, Active>> {
        self.0.active.lock().map_err(|_| DesktopError("storeIo"))
    }
    fn session(&self, session: &str) -> Result<PathBuf> {
        id(session)?;
        // 文件系统可能不区分大小写；会话标识仍按协议逐字节隔离。
        Ok(self.0.dir.join(digest(session.as_bytes())))
    }
    fn recovered(&self, active: &Active, session: &str, mut turn: ImageTurn) -> ImageTurn {
        if turn.status == ImageStatus::Pending
            && !active.contains(&(session.into(), turn.request_id.clone()))
        {
            turn.status = ImageStatus::Interrupted;
        }
        turn
    }
    pub fn history(&self, session: &str) -> Result<Vec<ImageTurn>> {
        let dir = self.session(session)?;
        let guard = self.guard()?;
        Ok(disk::load(&dir, session)?
            .into_iter()
            .map(|turn| self.recovered(&guard, session, turn))
            .collect())
    }
    pub(crate) fn attachment(&self, session: &str, filename: &str) -> Result<ImageFile> {
        let dir = self.session(session)?;
        let _guard = self.guard()?;
        let asset = disk::load(&dir, session)?
            .into_iter()
            .filter_map(|turn| turn.asset)
            .find(|asset| asset.filename == filename)
            .ok_or(DesktopError("imageNotFound"))?;
        Ok(ImageFile { dir, asset })
    }
    pub fn execute(
        &self,
        session: &str,
        request_id: &str,
        prompt: &str,
        base_image_id: Option<&str>,
        created_at: u64,
        provider: &LoopbackImageProvider,
    ) -> Result<ImageTurn> {
        self.execute_cancellable(
            session,
            request_id,
            prompt,
            base_image_id,
            created_at,
            provider,
            &AtomicBool::new(false),
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn execute_cancellable(
        &self,
        session: &str,
        request_id: &str,
        prompt: &str,
        base_image_id: Option<&str>,
        created_at: u64,
        provider: &LoopbackImageProvider,
        cancelled: &AtomicBool,
    ) -> Result<ImageTurn> {
        let dir = self.session(session)?;
        id(request_id)?;
        if !valid_prompt(prompt) || created_at > MAX_SAFE_INTEGER {
            return Err(DesktopError("invalidImageInput"));
        }
        let key = (session.to_owned(), request_id.to_owned());
        let reference = {
            let mut active = self.guard()?;
            let mut turns = disk::load(&dir, session)?;
            if let Some(previous) = turns.iter().find(|turn| turn.request_id == request_id) {
                if previous.prompt != prompt || previous.base_image_id.as_deref() != base_image_id {
                    return Err(DesktopError("imageRequestConflict"));
                }
                return Ok(self.recovered(&active, session, previous.clone()));
            }
            if turns.len() >= LIMIT {
                return Err(DesktopError("imageLimit"));
            }
            let reference = base_image_id
                .map(|image_id| {
                    let asset = find(&turns, image_id)?;
                    Ok::<_, DesktopError>((image_id, disk::png(&dir, asset)?))
                })
                .transpose()?;
            disk::private_dir(&dir)?;
            turns.push(ImageTurn {
                request_id: request_id.into(),
                prompt: prompt.into(),
                base_image_id: base_image_id.map(str::to_owned),
                created_at,
                status: ImageStatus::Pending,
                asset: None,
                error: None,
            });
            // 先持久化请求，再释放互斥锁运行网络；重启从不重发未完成请求。
            disk::save(&dir, &turns)?;
            active.insert(key.clone());
            reference
        };
        let result = provider.request(prompt, reference, cancelled);
        let mut active = self.guard()?;
        active.remove(&key);
        let mut turns = disk::load(&dir, session)?;
        let turn = turns
            .iter_mut()
            .find(|t| t.request_id == request_id)
            .ok_or(DesktopError("corruptImages"))?;
        if cancelled.load(Ordering::Acquire)
            || matches!(result, Err(DesktopError("imageInterrupted")))
        {
            turn.status = ImageStatus::Interrupted;
        } else {
            match result {
                Err(err) => {
                    turn.status = ImageStatus::Failed;
                    turn.error = Some(err.0.into());
                }
                Ok((bytes, width, height)) => {
                    let image_id = image_id(session, request_id);
                    let filename = format!("{image_id}.png");
                    disk::put(&dir, &filename, &bytes)?;
                    turn.status = ImageStatus::Succeeded;
                    turn.asset = Some(ImageAsset {
                        id: image_id,
                        filename,
                        model: provider::MODEL.into(),
                        channel_id: provider::CHANNEL.into(),
                        prompt: prompt.into(),
                        reference_ids: turn.base_image_id.iter().cloned().collect(),
                        base_image_id: turn.base_image_id.clone(),
                        width,
                        height,
                        content_sha256: digest(&bytes),
                    });
                }
            }
        }
        let result = turn.clone();
        disk::save(&dir, &turns)?;
        Ok(result)
    }
}
/// 由当前会话索引解析的不可变版本，调用方不能提供本机路径。
pub(crate) struct ImageFile {
    dir: PathBuf,
    asset: ImageAsset,
}
impl ImageFile {
    pub(crate) fn size(&self) -> Result<u64> {
        use crate::formal_platform::store::{directory, regular};
        directory(&self.dir, true)?;
        Ok(regular(&self.dir.join(&self.asset.filename), provider::MAX_PNG)?.len())
    }
    pub(crate) fn read_base64(&self) -> Result<String> {
        Ok(STANDARD.encode(disk::png(&self.dir, &self.asset)?))
    }
}
fn find<'a>(turns: &'a [ImageTurn], id: &str) -> Result<&'a ImageAsset> {
    turns
        .iter()
        .filter_map(|turn| turn.asset.as_ref())
        .find(|a| a.id == id)
        .ok_or(DesktopError("imageNotFound"))
}
