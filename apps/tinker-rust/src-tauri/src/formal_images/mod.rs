//! 独立原生预览的会话图片版本、请求收据与只读恢复。
mod credentialed_provider;
pub(crate) use credentialed_provider::CredentialedImageProvider;
mod disk;
mod portable;
pub(crate) use portable::PortableImages;
mod imports;
mod provider;
mod routes;
pub(crate) use routes::{ImageAction, ImageProtocol, ImageRoute};
mod tasks;
mod thumbnail;
use crate::session_lifecycle::RunStatus;
pub use imports::ImportedImage;
use imports::SessionImages;
pub(crate) use tasks::{ImageAdmission, ImageTaskSummary};
pub(crate) use thumbnail::MAX_THUMBNAIL_BYTES;
#[cfg(test)]
mod tests;

use crate::desktop_runtime::protocol::{id, DesktopError, Result, MAX_SAFE_INTEGER};
use base64::{engine::general_purpose::STANDARD, Engine};
pub use provider::LoopbackImageProvider;
pub(crate) use provider::{dimensions, validate_pixel_count, MAX_PNG};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
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
    // 旧 v1 账本不包含路由字段。仅从独立路由收据恢复，不接受 renderer 自报。
    #[serde(skip)]
    route: Option<ImageRoute>,
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
#[derive(Default)]
struct Active {
    requests: HashSet<(String, String)>,
    summaries: HashMap<String, Option<ImageTaskSummary>>,
}
impl Active {
    fn reserved_bytes(&self, session: &str) -> usize {
        if self.requests.iter().any(|(s, _)| s == session) {
            MAX_PNG
        } else {
            0
        }
    }
}
struct Store {
    dir: PathBuf,
    _lock: File,
    active: Mutex<Active>,
    thumbnail_worker: Mutex<()>,
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
            thumbnail_worker: Mutex::default(),
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
            && !active
                .requests
                .contains(&(session.into(), turn.request_id.clone()))
        {
            turn.status = ImageStatus::Interrupted;
        }
        turn
    }
    pub fn history(&self, session: &str) -> Result<Vec<ImageTurn>> {
        Ok(self.snapshot(session)?.0)
    }
    pub(crate) fn snapshot(&self, session: &str) -> Result<(Vec<ImageTurn>, Vec<ImportedImage>)> {
        let dir = self.session(session)?;
        let guard = self.guard()?;
        let session_images = SessionImages::open(&dir, session)?;
        let (turns, imports) = session_images.into_history();
        Ok((
            turns
                .into_iter()
                .map(|turn| self.recovered(&guard, session, turn))
                .collect(),
            imports,
        ))
    }
    pub(crate) fn attachment(&self, session: &str, filename: &str) -> Result<ImageFile> {
        let dir = self.session(session)?;
        let _guard = self.guard()?;
        let images = SessionImages::open(&dir, session)?;
        let (_, name, hash, _) = images
            .sources()
            .find(|(_, name, _, _)| *name == filename)
            .ok_or(DesktopError("imageNotFound"))?;
        Ok(ImageFile {
            store: self.clone(),
            session: session.into(),
            dir,
            filename: name.into(),
            sha256: hash.into(),
        })
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
        // 旧接口以请求 ID、输入与原图重放，保留原始时间。窗口提交的 admit 还校验时间。
        let timestamp = self
            .history(session)?
            .into_iter()
            .find(|t| t.request_id == request_id)
            .map_or(created_at, |turn| turn.created_at);
        match self.admit(
            session,
            request_id,
            prompt,
            base_image_id,
            timestamp,
            None,
            None,
        )? {
            ImageAdmission::Replay(turn) => Ok(turn),
            ImageAdmission::New(job) => job.execute(provider, cancelled),
        }
    }
}
/// 由当前会话索引解析的不可变版本，调用方不能提供本机路径。
pub(crate) struct ImageFile {
    store: ImageStore,
    session: String,
    dir: PathBuf,
    filename: String,
    sha256: String,
}
impl ImageFile {
    pub(crate) fn sha256(&self) -> &str {
        &self.sha256
    }
    pub(crate) fn size(&self) -> Result<u64> {
        use crate::formal_platform::store::{directory, regular};
        directory(&self.dir, true)?;
        Ok(regular(&self.dir.join(&self.filename), provider::MAX_PNG)?.len())
    }
    pub(crate) fn read_bytes(&self) -> Result<Vec<u8>> {
        disk::png(&self.dir, &self.filename, &self.sha256)
    }
    pub(crate) fn read_base64(&self) -> Result<String> {
        Ok(STANDARD.encode(self.read_bytes()?))
    }
}
