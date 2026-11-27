//! 导入记录独立于生成账本。旧版可继续读取并追加原有图片链。
use super::*;
use serde::{Deserialize, Serialize};

const INDEX: &str = "imports.json";
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportedImage {
    pub id: String,
    pub filename: String,
    pub display_name: String,
    pub width: u32,
    pub height: u32,
    pub content_sha256: String,
    pub created_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) history_source: Option<HistoryImageSource>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HistoryImageSource {
    pub message_id: String,
    pub attachment_id: String,
}

impl HistoryImageSource {
    fn valid(&self) -> bool {
        !self.message_id.is_empty()
            && self.message_id.len() <= 512
            && !self.attachment_id.is_empty()
            && self.attachment_id.len() <= 128
    }
}

fn valid_name(name: &str) -> bool {
    !name.trim().is_empty()
        && name.len() <= 255
        && name != "."
        && name != ".."
        && !name
            .chars()
            .any(|c| c.is_control() || c == '/' || c == '\\')
}
pub(super) fn reference_id(
    session: &str,
    name: &str,
    sha: &str,
    source: Option<&HistoryImageSource>,
) -> String {
    if let Some(source) = source {
        // 每个元组成员独立编码；相同像素、不同消息或附件均是不同的编辑来源。
        let identity = serde_json::to_vec(&(
            session,
            name,
            sha,
            &source.message_id,
            &source.attachment_id,
        ))
        .expect("字符串元组可序列化");
        return format!("ref-{}", &digest(&identity)[..32]);
    }
    format!(
        "ref-{}",
        &digest(format!("{session}\0{name}\0{sha}").as_bytes())[..32]
    )
}

pub(super) fn load(dir: &Path, session: &str) -> Result<Vec<ImportedImage>> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Index {
        version: u32,
        imports: Vec<ImportedImage>,
    }
    let Some(bytes) = disk::read_index(dir, INDEX)? else {
        return Ok(vec![]);
    };
    let index: Index = serde_json::from_slice(&bytes).map_err(|_| DesktopError("corruptImages"))?;
    if index.version != 1 {
        return Err(DesktopError("unsupportedVersion"));
    }
    let mut seen = HashSet::new();
    if index.imports.len() > LIMIT
        || index.imports.iter().any(|a| {
            !valid_name(&a.display_name)
                || a.created_at > MAX_SAFE_INTEGER
                || a.content_sha256.len() != 64
                || !a.content_sha256.bytes().all(|c| c.is_ascii_hexdigit())
                || a.history_source.as_ref().is_some_and(|s| !s.valid())
                || a.id
                    != reference_id(
                        session,
                        &a.display_name,
                        &a.content_sha256,
                        a.history_source.as_ref(),
                    )
                || a.filename != format!("{}.png", a.id)
                || a.width == 0
                || a.height == 0
                || provider::validate_pixel_count(a.width, a.height).is_err()
                || !seen.insert(&a.id)
        })
    {
        return Err(DesktopError("corruptImages"));
    }
    Ok(index.imports)
}
impl ImageStore {
    pub fn imports(&self, session: &str) -> Result<Vec<ImportedImage>> {
        let dir = self.session(session)?;
        let _guard = self.guard()?;
        load(&dir, session)
    }

    /// bytes 已由宿主从用户选定的图片读取；不接受原始磁盘路径。
    pub fn import_png(
        &self,
        session: &str,
        display_name: &str,
        bytes: &[u8],
        created_at: u64,
    ) -> Result<ImportedImage> {
        self.import_reference(session, display_name, bytes, created_at, None)
    }

    pub(crate) fn import_reference(
        &self,
        session: &str,
        display_name: &str,
        bytes: &[u8],
        created_at: u64,
        history_source: Option<HistoryImageSource>,
    ) -> Result<ImportedImage> {
        let dir = self.session(session)?;
        if history_source.as_ref().is_some_and(|s| !s.valid())
            || !valid_name(display_name)
            || created_at > MAX_SAFE_INTEGER
        {
            return Err(DesktopError("invalidImageInput"));
        }
        let (width, height) = provider::dimensions(bytes)?;
        let hash = digest(bytes);
        let id = reference_id(session, display_name, &hash, history_source.as_ref());
        let guard = self.guard()?;
        let mut imports = load(&dir, session)?;
        if let Some(existing) = imports.iter().find(|a| a.id == id) {
            disk::png(&dir, &existing.filename, &existing.content_sha256)?;
            return Ok(existing.clone());
        }
        if imports.len() >= LIMIT {
            return Err(DesktopError("imageLimit"));
        }
        disk::private_dir(&dir)?;
        let filename = format!("{id}.png");
        // 崩溃可能发生在不可变 PNG 同步与索引提交之间。仅采用本请求精确匹配的内容。
        let new_file = match dir.join(&filename).symlink_metadata() {
            Ok(_) => {
                disk::png(&dir, &filename, &hash)?;
                false
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let reserved = guard.reserved_bytes(session);
                disk::asset_budget(&dir, bytes.len() + reserved)?;
                disk::atomic_write(&dir, &filename, bytes, provider::MAX_PNG)?;
                true
            }
            Err(e) => return Err(e.into()),
        };
        let item = ImportedImage {
            id,
            filename,
            display_name: display_name.into(),
            history_source,
            width,
            height,
            content_sha256: hash,
            created_at,
        };
        imports.push(item.clone());
        let data = serde_json::to_vec(&serde_json::json!({"version":1,"imports":imports}))
            .map_err(|_| DesktopError("storeIo"))?;
        if let Err(error) = disk::write_index(&dir, INDEX, &data) {
            // A directory sync can fail after publishing. Delete only a new uncredited original.
            if new_file && load(&dir, session).is_ok_and(|r| !r.iter().any(|a| a.id == item.id)) {
                disk::png(&dir, &item.filename, &item.content_sha256)?;
                std::fs::remove_file(dir.join(&item.filename))?;
                crate::formal_platform::store::sync_dir(&dir)?;
            }
            return Err(error);
        }
        Ok(item)
    }
}

pub(super) struct SessionImages {
    pub original: Vec<ImageTurn>,
    pub derived: Vec<ImageTurn>,
    pub(super) imports: Vec<ImportedImage>,
    pub(super) routed: routes::RoutedReceipts,
}
impl SessionImages {
    pub fn open(dir: &Path, sid: &str) -> Result<Self> {
        let original = disk::load_turns(dir, sid, None)?;
        let imports = load(dir, sid)?;
        let derived = disk::load_turns(dir, sid, Some(&imports))?;
        let mut requests = HashSet::new();
        if original
            .iter()
            .chain(&derived)
            .any(|t| !requests.insert(&t.request_id))
        {
            return Err(DesktopError("corruptImages"));
        }
        let routed = routes::RoutedReceipts::read(dir, sid, &original, &derived, &imports)?;
        Ok(Self {
            routed,
            original,
            derived,
            imports,
        })
    }
    pub fn turns(&self) -> impl Iterator<Item = &ImageTurn> {
        self.original
            .iter()
            .chain(&self.derived)
            .chain(self.routed.entries.iter().map(|e| &e.turn))
    }
    /// 两个账本独立提交；旧程序仍能读取全部原有生成链。
    pub fn partition(&mut self, derived: bool) -> &mut Vec<ImageTurn> {
        if derived {
            &mut self.derived
        } else {
            &mut self.original
        }
    }
    pub fn sources(&self) -> impl Iterator<Item = (&str, &str, &str, bool)> {
        self.original
            .iter()
            .map(|t| (t, false))
            .chain(self.derived.iter().map(|t| (t, true)))
            .chain(self.routed.entries.iter().map(|e| (&e.turn, false)))
            .filter_map(|(t, derived)| {
                t.asset.as_ref().map(|a| {
                    (
                        a.id.as_str(),
                        a.filename.as_str(),
                        a.content_sha256.as_str(),
                        derived,
                    )
                })
            })
            .chain(self.imports.iter().map(|a| {
                (
                    a.id.as_str(),
                    a.filename.as_str(),
                    a.content_sha256.as_str(),
                    true,
                )
            }))
    }
}
