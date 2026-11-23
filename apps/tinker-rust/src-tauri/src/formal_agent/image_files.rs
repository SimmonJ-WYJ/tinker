//! 对外沿用会话文件浏览器的路径约定；仅开放当前会话已提交的图片和导入附件。
use super::actor::Actor;
use crate::desktop_runtime::protocol::{DesktopError, Result};
use crate::legacy_attachments::wire_name;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::collections::VecDeque;
// 原图分块读取，双图对比最多保留两份已校验数据，每片重新检查会话归属。
const MAX_RANGE: usize = 256 * 1024;
const MAX_LEGACY_INLINE: u64 = 512 * 1024;
struct VerifiedOriginal {
    session: String,
    filename: String,
    sha256: String,
    bytes: Vec<u8>,
}
#[derive(Default)]
pub(super) struct Originals(VecDeque<VerifiedOriginal>);
impl Originals {
    pub(super) fn clear(&mut self) {
        self.0.clear();
    }

    fn read_range(
        &mut self,
        sid: &str,
        filename: &str,
        sha: &str,
        range: std::ops::Range<usize>,
        total: usize,
        read: impl FnOnce() -> Result<Vec<u8>>,
    ) -> Result<Value> {
        let index = self
            .0
            .iter()
            .position(|v| v.session == sid && v.filename == filename && v.sha256 == sha);
        let previous = index.and_then(|i| self.0.remove(i));
        // 首次读取核验原图；缓存被腾出后，后续分块仍须匹配原摘要。
        let original = if let Some(old) = previous.filter(|_| range.start != 0) {
            old
        } else {
            if self.0.len() == 2 {
                self.0.pop_front();
            }
            VerifiedOriginal {
                session: sid.into(),
                filename: filename.into(),
                sha256: sha.into(),
                bytes: read()?,
            }
        };
        if original.bytes.len() != total {
            return Err(DesktopError("imageSourceChanged"));
        }
        let offset = range.start;
        let finished = range.end == total;
        let data = STANDARD.encode(&original.bytes[range]);
        if !finished {
            self.0.push_back(original);
        }
        Ok(json!({"data":data,"offset":offset,"totalBytes":total,"sha256":sha}))
    }
}
impl Actor {
    pub(super) fn read_image_range(&mut self, args: &[Value]) -> Result<Value> {
        if !(4..=5).contains(&args.len()) {
            return Err(DesktopError("invalidParams"));
        }
        let sid = args[0].as_str().ok_or(DesktopError("invalidParams"))?;
        let filename = args[1].as_str().ok_or(DesktopError("invalidParams"))?;
        let file = self.view_file(sid, filename)?;
        let images = self.images.as_mut().expect("resolved image host");
        let integer = |arg: &Value| {
            arg.as_u64()
                .and_then(|v| usize::try_from(v).ok())
                .ok_or(DesktopError("invalidParams"))
        };
        let offset = integer(&args[2])?;
        let limit = integer(&args[3])?;
        let sha = file.sha256();
        if limit == 0 || limit > MAX_RANGE || (offset != 0 && args.len() != 5) {
            return Err(DesktopError("invalidParams"));
        }
        if let Some(expected) = args.get(4) {
            if expected.as_str() != Some(sha) {
                return Err(DesktopError("imageSourceChanged"));
            }
        }
        let total = usize::try_from(file.size()?).map_err(|_| DesktopError("imageTooLarge"))?;
        if offset >= total {
            return Err(DesktopError("invalidParams"));
        }
        images.originals.read_range(
            sid,
            filename,
            sha,
            offset..offset.saturating_add(limit).min(total),
            total,
            || file.read_bytes(),
        )
    }

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
            if file.size()? > MAX_LEGACY_INLINE {
                return Err(DesktopError("imageTooLarge"));
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
    fn two_parallel_original_views_verify_each_source_once() {
        let mut originals = Originals::default();
        for name in ["a", "b"] {
            originals
                .read_range("sid", name, "digest", 0..1, 2, || Ok(vec![1, 2]))
                .unwrap();
        }
        for name in ["a", "b"] {
            let last = originals
                .read_range("sid", name, "digest", 1..2, 2, || {
                    panic!("original was re-read")
                })
                .unwrap();
            assert_eq!(last["data"], STANDARD.encode([2]));
        }
        assert!(originals.0.is_empty());
    }

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
