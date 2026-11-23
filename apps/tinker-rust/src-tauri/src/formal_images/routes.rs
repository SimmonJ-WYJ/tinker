//! 仅在显式使用托管图片路由时创建。旧版可独立读取和追加原账本。
use super::*;
const FILE: &str = "routed-images-v1.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ImageAction {
    Generate,
    Edit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ImageProtocol {
    OpenaiImages,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ImageRoute {
    pub channel_id: String,
    pub model_id: String,
    pub revision: String,
    pub protocol: ImageProtocol,
    pub action: ImageAction,
}
impl ImageRoute {
    pub(super) fn validate(&self, base: Option<&str>) -> Result<()> {
        id(&self.channel_id)?;
        id(&self.revision)?;
        crate::desktop_runtime::protocol::model_id(&self.model_id)?;
        if self.model_id.contains("://")
            || self.model_id.contains(['?', '#'])
            || (self.action == ImageAction::Edit) != base.is_some()
        {
            return Err(DesktopError("invalidImageInput"));
        }
        Ok(())
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct RoutedEntry {
    pub turn: ImageTurn,
    pub route: ImageRoute,
    pub retry_of: Option<String>,
    pub text_head: Option<String>,
    pub original: usize,
    pub derived: usize,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct RoutedReceipts {
    version: u32,
    pub entries: Vec<RoutedEntry>,
}
impl RoutedReceipts {
    pub fn get(&self, id: &str) -> Option<&RoutedEntry> {
        self.entries.iter().find(|e| e.turn.request_id == id)
    }
    pub fn read(
        dir: &Path,
        sid: &str,
        original: &[ImageTurn],
        derived: &[ImageTurn],
        imports: &[ImportedImage],
    ) -> Result<Self> {
        let Some(data) = disk::read_index(dir, FILE)? else {
            return Ok(Self {
                version: 1,
                entries: vec![],
            });
        };
        let mut index: Self =
            serde_json::from_slice(&data).map_err(|_| DesktopError("corruptImages"))?;
        if index.version != 1 {
            return Err(DesktopError("unsupportedVersion"));
        }
        if index.entries.len() > LIMIT {
            return Err(DesktopError("corruptImages"));
        }
        let mut requests: HashSet<_> = original
            .iter()
            .chain(derived)
            .map(|t| t.request_id.clone())
            .collect();
        let mut sources: HashSet<_> = imports.iter().map(|a| a.id.clone()).collect();
        let (mut o, mut d) = (0, 0);
        for i in 0..index.entries.len() {
            let (previous, current) = index.entries.split_at_mut(i);
            let entry = &mut current[0];
            let t = &mut entry.turn;
            if !requests.insert(t.request_id.clone())
                || id(&t.request_id).is_err()
                || !valid_prompt(&t.prompt)
                || t.created_at > MAX_SAFE_INTEGER
                || entry.route.validate(t.base_image_id.as_deref()).is_err()
                || entry.text_head.as_ref().is_some_and(|s| id(s).is_err())
                || entry.original < o
                || entry.derived < d
                || entry.original > original.len()
                || entry.derived > derived.len()
            {
                return Err(DesktopError("corruptImages"));
            }
            for old in original[o..entry.original]
                .iter()
                .chain(&derived[d..entry.derived])
            {
                if let Some(a) = &old.asset {
                    sources.insert(a.id.clone());
                }
            }
            (o, d) = (entry.original, entry.derived);
            if t.base_image_id
                .as_ref()
                .is_some_and(|base| !sources.contains(base))
            {
                return Err(DesktopError("corruptImages"));
            }
            if let Some(source) = entry.retry_of.as_ref() {
                if !previous.iter().any(|e| {
                    e.turn.request_id == *source
                        && e.route == entry.route
                        && e.turn.prompt == t.prompt
                        && e.turn.base_image_id == t.base_image_id
                        && !e.turn.user_stopped()
                        && e.turn.status != ImageStatus::Succeeded
                }) {
                    return Err(DesktopError("corruptImages"));
                }
            }
            disk::validate_result(sid, t, &entry.route.model_id, &entry.route.channel_id)?;
            if let Some(a) = &t.asset {
                sources.insert(a.id.clone());
            }
            t.route = Some(entry.route.clone());
        }
        Ok(index)
    }
    pub fn save(&self, dir: &Path) -> Result<()> {
        let bytes = serde_json::to_vec(self).map_err(|_| DesktopError("storeIo"))?;
        disk::write_index(dir, FILE, &bytes)
    }
}
impl SessionImages {
    pub fn into_history(self) -> (Vec<ImageTurn>, Vec<ImportedImage>) {
        let mut history = Vec::new();
        let mut original = self.original.into_iter();
        let mut derived = self.derived.into_iter();
        let (mut o, mut d) = (0, 0);
        for entry in self.routed.entries {
            let offset = history.len();
            history.extend(original.by_ref().take(entry.original - o));
            history.extend(derived.by_ref().take(entry.derived - d));
            if d < entry.derived {
                history[offset..].sort_by_key(|t| t.created_at);
            }
            history.push(entry.turn);
            (o, d) = (entry.original, entry.derived);
        }
        let offset = history.len();
        history.extend(original);
        if derived.len() > 0 {
            history.extend(derived);
            history[offset..].sort_by_key(|t| t.created_at);
        }
        (history, self.imports)
    }
    pub fn find_mut(&mut self, id: &str) -> Result<&mut ImageTurn> {
        self.original
            .iter_mut()
            .chain(&mut self.derived)
            .chain(self.routed.entries.iter_mut().map(|e| &mut e.turn))
            .find(|t| t.request_id == id)
            .ok_or(DesktopError("corruptImages"))
    }
    pub fn save_for(&self, dir: &Path, request: &str) -> Result<()> {
        if self.routed.get(request).is_some() {
            return self.routed.save(dir);
        }
        let derived = self.derived.iter().any(|t| t.request_id == request);
        disk::save_turns(
            dir,
            if derived {
                &self.derived
            } else {
                &self.original
            },
            derived,
        )
    }
}
