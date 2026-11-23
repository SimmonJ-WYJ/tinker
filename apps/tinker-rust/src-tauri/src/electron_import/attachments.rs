//! 只解析 Electron 写入的两种会话附件布局。
use super::{
    fs::Dir,
    reader::{file_in, safe_name, Budget},
    *,
};
use serde_json::Value;
use sha2::{Digest, Sha256};

pub(super) struct Files<'a> {
    pub root: &'a Dir,
    pub sid: &'a str,
    pub slug: Option<&'a str>,
    pub output: &'a mut Vec<SourceAttachment>,
    pub budget: &'a mut Budget,
}
type FileResult = std::result::Result<String, &'static str>;
fn ext(name: &str) -> Option<String> {
    name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase())
}
impl Files<'_> {
    pub fn descriptor(&mut self, desc: &Value) -> FileResult {
        let local = desc["localPath"].as_str().ok_or("invalidAttachment")?;
        let (sid, leaf) = local.split_once('/').ok_or("unsafeSource")?;
        let id = desc["imageId"]
            .as_str()
            .or(desc["id"].as_str())
            .ok_or("invalidAttachment")?;
        if sid != self.sid
            || !safe_name(leaf)
            || crate::desktop_runtime::protocol::id(id).is_err()
            || leaf.rsplit_once('.').map(|r| r.0) != Some(id)
        {
            return Err("unsafeSource");
        }
        let display = desc["displayName"]
            .as_str()
            .or(desc["filename"].as_str())
            .ok_or("invalidAttachment")?;
        self.load(&["attachments", sid], leaf, display)
    }
    pub fn workspace_file(&mut self, line: &str) -> FileResult {
        let (name, path) = line
            .strip_prefix("- ")
            .and_then(|s| s.split_once(": "))
            .ok_or("invalidAttachment")?;
        let slug = self.slug.ok_or("unsafeSource")?;
        if !safe_name(name)
            || path.split('/').any(|part| part == ".." || part == ".")
            || path.contains('\\')
        {
            return Err("unsafeSource");
        }
        let suffix = format!("agent-workspaces/{slug}/{}/{name}", self.sid);
        if !(path == suffix || (path.starts_with('/') && path.ends_with(&format!("/{suffix}")))) {
            return Err("unsafeSource");
        }
        self.load(&["agent-workspaces", slug, self.sid], name, name)
    }
    fn load(&mut self, dirs: &[&str], leaf: &str, display: &str) -> FileResult {
        if !safe_name(display)
            || ["CLAUDE.md", "AGENTS.md"]
                .iter()
                .any(|name| leaf.eq_ignore_ascii_case(name) || display.eq_ignore_ascii_case(name))
        {
            return Err("unsafeSource");
        }
        let extension = ext(leaf).ok_or("unsupportedAttachment")?;
        let (media, limit) = match extension.as_str() {
            "png" | "jpg" | "jpeg" => ("image/png", crate::picked_image::MAX_PICKED_BYTES),
            "txt" => ("text/plain", 256 * 1024),
            "md" => ("text/markdown", 256 * 1024),
            _ => return Err("unsupportedAttachment"),
        };
        let id = format!(
            "file-{:x}",
            Sha256::digest(format!("{}/{leaf}", dirs.join("/")))
        );
        let id = id[..37].to_owned();
        if self.output.iter().any(|a| a.id == id) {
            return Ok(id);
        }
        if self.output.len() >= 32 {
            return Err("attachmentLimit");
        }
        let bytes = file_in(self.root, dirs, leaf, limit.min(self.budget.bytes))
            .map_err(|e| match e.0 {
                "unsafeImportPath" => "unsafeSource",
                "importLimit" => "attachmentLimit",
                _ => "invalidAttachment",
            })?
            .ok_or("missingAttachment")?;
        self.budget
            .charge(bytes.len())
            .map_err(|_| "attachmentLimit")?;
        let bytes = if media == "image/png" {
            crate::picked_image::normalize_legacy_preview(&bytes, &extension)
                .map_err(|_| "invalidAttachment")?
        } else {
            if std::str::from_utf8(&bytes).is_err()
                || bytes.iter().any(|&b| b < 32 && !matches!(b, 9 | 10 | 13))
            {
                return Err("invalidAttachment");
            }
            bytes
        };
        self.budget.output = self
            .budget
            .output
            .checked_sub(bytes.len())
            .ok_or("attachmentLimit")?;
        self.output.push(SourceAttachment {
            id: id.clone(),
            filename: display.into(),
            media_type: media.into(),
            bytes,
        });
        Ok(id)
    }
}
