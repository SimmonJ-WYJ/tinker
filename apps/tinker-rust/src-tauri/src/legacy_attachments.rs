//! 备份中的文件名仅用于界面展示。私有副本和 IPC 均使用绑定内容的名称。
use crate::{
    desktop_runtime::protocol::{DesktopError, Result},
    electron_import::SourceAttachment,
    formal_platform::store::{directory, read_regular, sync_dir, write_new},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, fs, io::ErrorKind, path::Path};

const SUBDIR: &str = "imported-files";
const TEXT_LIMIT: usize = 256 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoredFile {
    pub id: String,
    pub filename: String,
    pub media_type: String,
    pub sha256: String,
    pub size: u64,
}

fn invalid() -> DesktopError {
    DesktopError("invalidImportedFile")
}

impl StoredFile {
    pub fn validate(&self) -> Result<()> {
        if self.id.is_empty()
            || self.id.len() > 128
            || self.filename.is_empty()
            || self.filename.len() > 255
            || self.filename.starts_with('.')
            || self
                .filename
                .chars()
                .any(|c| c.is_control() || matches!(c, '/' | '\\'))
            || self.sha256.len() != 64
            || !self.sha256.bytes().all(|c| c.is_ascii_hexdigit())
        {
            return Err(invalid());
        }
        let limit = self.limit()?;
        if self.size > limit as u64 {
            return Err(invalid());
        }
        Ok(())
    }
    fn limit(&self) -> Result<usize> {
        match self.media_type.as_str() {
            "image/png" => Ok(crate::picked_image::LEGACY_PNG_LIMIT),
            "text/plain" | "text/markdown" => Ok(TEXT_LIMIT),
            _ => Err(invalid()),
        }
    }
}

pub fn wire_name(file: &StoredFile) -> String {
    // Markdown 按纯文本显示，历史附件不会加载网络图片或执行嵌入内容。
    let ext = if file.media_type == "image/png" {
        "png"
    } else {
        "txt"
    };
    let key = Sha256::digest(format!("{}\0{}", file.id, file.sha256).as_bytes());
    format!("legacy-{key:x}.{ext}")
}

pub fn stage_files(dir: &Path, files: &[SourceAttachment]) -> Result<Vec<StoredFile>> {
    if files.is_empty() {
        return Ok(Vec::new());
    }
    if files.len() > 128 {
        return Err(DesktopError("storageLimit"));
    }
    directory(dir, true)?;
    let owned = dir.join(SUBDIR);
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    match builder.create(&owned) {
        Ok(()) => sync_dir(dir)?,
        Err(e) if e.kind() == ErrorKind::AlreadyExists => (),
        Err(e) => return Err(e.into()),
    }
    directory(&owned, true)?;
    let mut ids = HashSet::new();
    let mut stored = Vec::new();
    for item in files {
        let file = StoredFile {
            id: item.id.clone(),
            filename: item.filename.clone(),
            media_type: item.media_type.clone(),
            sha256: format!("{:x}", Sha256::digest(&item.bytes)),
            size: item.bytes.len() as u64,
        };
        file.validate()?;
        if !ids.insert(&item.id) {
            return Err(invalid());
        }
        if file.media_type == "image/png" {
            crate::picked_image::validate_legacy_png(&item.bytes)?;
        } else if std::str::from_utf8(&item.bytes).is_err() || item.bytes.contains(&0) {
            return Err(invalid());
        }
        let path = owned.join(wire_name(&file));
        match path.symlink_metadata() {
            Ok(_) => {
                read_asset(dir, &file)?;
            }
            Err(e) if e.kind() == ErrorKind::NotFound => {
                // 同一桌面写锁保护本次导入。先写临时文件，再原子发布最终文件名。
                let temp = path.with_extension("pending");
                match temp.symlink_metadata() {
                    Ok(_) => {
                        read_regular(&temp, file.limit()?)?;
                        fs::remove_file(&temp)?;
                    }
                    Err(e) if e.kind() == ErrorKind::NotFound => (),
                    Err(e) => return Err(e.into()),
                }
                write_new(&temp, &item.bytes)?;
                fs::rename(temp, path)?;
            }
            Err(e) => return Err(e.into()),
        }
        stored.push(file);
    }
    sync_dir(&owned)?;
    Ok(stored)
}

pub fn read_asset(dir: &Path, file: &StoredFile) -> Result<Vec<u8>> {
    file.validate()?;
    let owned = dir.join(SUBDIR);
    directory(&owned, true)?;
    let bytes = read_regular(&owned.join(wire_name(file)), file.limit()?)?;
    if bytes.len() as u64 != file.size || format!("{:x}", Sha256::digest(&bytes)) != file.sha256 {
        return Err(DesktopError("corruptImportedFile"));
    }
    Ok(bytes)
}

pub fn project(msg: &mut Value, sid: &str, ids: &[String], files: &[StoredFile]) {
    // 仅展示清单内的附件。资源引用不拼接进模型上下文。
    msg["_importedFiles"] = json!(ids
        .iter()
        .filter_map(|id| files.iter().find(|file| &file.id == id))
        .map(
            |file| json!({"filename":file.filename,"mediaType":file.media_type,
           "path":format!("{sid}/{}",wire_name(file))})
        )
        .collect::<Vec<_>>());
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::credentialed_channels::catalog::random_reference;
    use std::fs;
    fn temp() -> std::path::PathBuf {
        let dir = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(random_reference().unwrap());
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(&dir).unwrap();
        dir
    }
    fn note() -> SourceAttachment {
        SourceAttachment {
            id: "a1".into(),
            filename: "meeting.md".into(),
            media_type: "text/markdown".into(),
            bytes: b"A note".to_vec(),
        }
    }
    #[test]
    fn repeated_assets_use_immutable_bytes_and_session_only_references() {
        let dir = temp();
        let files = stage_files(&dir, &[note()]).unwrap();
        let name = wire_name(&files[0]);
        assert!(!name.contains("meeting"));
        assert!(name.ends_with(".txt"));
        assert_eq!(stage_files(&dir, &[note()]).unwrap(), files);
        assert_eq!(read_asset(&dir, &files[0]).unwrap(), b"A note");
        let mut msg = serde_json::json!({"message":{"content":[{"type":"text","text":"hello"}]}});
        project(&mut msg, "sid", &["a1".into()], &files);
        assert_eq!(msg["_importedFiles"][0]["path"], format!("sid/{name}"));
        assert_eq!(msg["message"]["content"][0]["text"], "hello");
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn invalid_or_replaced_file_cannot_be_read_as_an_imported_attachment() {
        let dir = temp();
        let mut invalid = note();
        invalid.filename = "../key".into();
        assert!(stage_files(&dir, &[invalid]).is_err());
        let file = stage_files(&dir, &[note()]).unwrap().remove(0);
        fs::write(dir.join("imported-files").join(wire_name(&file)), b"Other!").unwrap();
        assert!(stage_files(&dir, &[note()]).is_err());
        assert!(read_asset(&dir, &file).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn staged_attachment_retries_after_interruption_and_refuses_linked_destinations() {
        use std::os::unix::fs::symlink;
        let dir = temp();
        let file = stage_files(&dir, &[note()]).unwrap().remove(0);
        let path = dir.join(SUBDIR).join(wire_name(&file));
        let pending = path.with_extension("pending");
        fs::rename(&path, &pending).unwrap();
        assert_eq!(stage_files(&dir, &[note()]).unwrap(), vec![file.clone()]);
        assert!(!pending.exists());
        let external = dir.join("unrelated.md");
        fs::rename(&path, &external).unwrap();
        symlink(&external, &pending).unwrap();
        assert!(stage_files(&dir, &[note()]).is_err());
        assert_eq!(fs::read(&external).unwrap(), b"A note");
        fs::remove_dir_all(dir).unwrap();
    }
}
