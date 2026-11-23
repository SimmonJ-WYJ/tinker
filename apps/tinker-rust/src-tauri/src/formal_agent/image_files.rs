//! 对外沿用会话文件浏览器的路径约定；只从当前宿主已提交的图片目录查找。
use super::actor::Actor;
use crate::desktop_runtime::protocol::{DesktopError, Result};
use serde_json::{json, Value};
impl Actor {
    pub fn image_file(&self, channel: &str, args: &[Value]) -> Result<Value> {
        let list = channel == "agent:list-directory";
        if args.is_empty() || args.len() > if list { 2 } else { 1 } {
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
            Ok(json!({"entries":entries,"hiddenCount":0}))
        }
    }
}
