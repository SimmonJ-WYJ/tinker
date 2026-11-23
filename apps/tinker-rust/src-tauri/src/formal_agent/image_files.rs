//! 对外沿用会话文件浏览器的路径约定；仅开放当前会话已提交的图片和导入附件。
use super::actor::Actor;
use crate::desktop_runtime::protocol::{DesktopError, Result};
use crate::legacy_attachments::wire_name;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
impl Actor {
    pub fn image_file(&self, channel: &str, args: &[Value]) -> Result<Value> {
        let list = channel == "agent:list-directory";
        let text = channel == "agent:preview-read-text";
        if args.is_empty() || args.len() > if list || text { 2 } else { 1 } {
            return Err(DesktopError("invalidParams"));
        }
        if list && args.len() > 1 && !args[1].is_null() && !args[1].is_object() {
            return Err(DesktopError("invalidParams"));
        }
        let path = args[0].as_str().ok_or(DesktopError("invalidPath"))?;
        self.root.validate()?;
        let root = self.root.path().join("deliverables");
        let prefix = format!("{}/", root.to_str().ok_or(DesktopError("invalidPath"))?);
        let rel = if channel == "chat:read-attachment" {
            path
        } else {
            path.strip_prefix(&prefix)
                .ok_or(DesktopError("invalidPath"))?
        };
        let (sid, name) = if list {
            (rel, None)
        } else {
            let (sid, file) = rel.split_once('/').ok_or(DesktopError("invalidPath"))?;
            (sid, Some(file))
        };
        crate::desktop_runtime::protocol::id(sid)?;
        self.session(sid)?;
        let store = &self
            .images
            .as_ref()
            .ok_or(DesktopError("unsupported"))?
            .store;
        if let Some(name) = name {
            if name.starts_with("legacy-") {
                let files = self.runtime.imported_files(sid)?;
                let file = files
                    .iter()
                    .find(|f| wire_name(f) == name)
                    .ok_or(DesktopError("fileNotFound"))?;
                if channel == "agent:stat-file" {
                    return Ok(json!({"size":file.size,"isDirectory":false}));
                }
                let bytes = self
                    .runtime
                    .imported_file_bytes(sid, name)?
                    .ok_or(DesktopError("fileNotFound"))?;
                if text {
                    if !file.media_type.starts_with("text/") {
                        return Err(DesktopError("unsupported"));
                    }
                    return text_preview(&bytes, args.get(1));
                }
                return Ok(json!(STANDARD.encode(bytes)));
            }
            if text {
                return Err(DesktopError("unsupported"));
            }
            let file = store.attachment(sid, name)?;
            if channel == "agent:stat-file" {
                return Ok(json!({"size": file.size()?, "isDirectory": false}));
            }
            Ok(Value::String(file.read_base64()?))
        } else {
            let (turns, imports) = store.snapshot(sid)?;
            let mut entries:Vec<_>=turns.iter().filter_map(|t|t.asset.as_ref()).map(|a|json!({
                "name":a.filename,"path":root.join(sid).join(&a.filename),"isDirectory":false
            })).collect();
            entries.extend(imports.iter().map(|a|json!({
                "name":a.filename,"displayName":a.display_name,"imageId":a.id,"path":root.join(sid).join(&a.filename),"isDirectory":false
            })));
            entries.extend(self.runtime.imported_files(sid)?.iter().map(|file| {
                let name = wire_name(file);
                json!({"name":name,"displayName":file.filename,"path":root.join(sid).join(&name),"isDirectory":false})
            }));
            Ok(json!({"entries":entries,"hiddenCount":0}))
        }
    }
}

fn text_preview(bytes: &[u8], requested: Option<&Value>) -> Result<Value> {
    let limit = match requested {
        None | Some(Value::Null) => bytes.len(),
        Some(v) => v
            .as_u64()
            .and_then(|n| usize::try_from(n).ok())
            .ok_or(DesktopError("invalidParams"))?,
    };
    let content = std::str::from_utf8(bytes).map_err(|_| DesktopError("corruptImportedFile"))?;
    let mut end = limit.min(content.len());
    while !content.is_char_boundary(end) {
        end -= 1;
    }
    Ok(json!({"content":&content[..end],"truncated":end < content.len()}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn imported_text_preview_respects_byte_limits_without_splitting_characters() {
        let text = "A好!";
        assert_eq!(
            text_preview(text.as_bytes(), Some(&json!(3))).unwrap(),
            json!({"content":"A","truncated":true})
        );
        assert_eq!(
            text_preview(text.as_bytes(), Some(&json!(0))).unwrap(),
            json!({"content":"","truncated":true})
        );
        assert_eq!(
            text_preview(text.as_bytes(), None).unwrap(),
            json!({"content":text,"truncated":false})
        );
        assert!(text_preview(text.as_bytes(), Some(&json!(-1))).is_err());
        assert!(text_preview(&[255], None).is_err());
    }
}
