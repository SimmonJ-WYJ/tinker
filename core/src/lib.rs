use std::collections::HashMap;
#[derive(Default)]
struct Channel {
    draft: String,
    messages: Vec<String>,
}
pub struct Session {
    active: String,
    channels: HashMap<String, Channel>,
}
impl Default for Session {
    fn default() -> Self {
        Self {
            active: "demo".into(),
            channels: ["demo", "local", "compatible"]
                .into_iter()
                .map(|id| (id.into(), Channel::default()))
                .collect(),
        }
    }
}
impl Session {
    pub fn select(&mut self, id: &str) -> Result<(), &'static str> {
        if !self.channels.contains_key(id) {
            return Err("未知渠道");
        }
        self.active = id.into();
        Ok(())
    }
    pub fn edit(&mut self, text: &str) {
        self.channels.get_mut(&self.active).unwrap().draft = text.into();
    }
    pub fn draft(&self) -> &str {
        &self.channels[&self.active].draft
    }
    pub fn messages(&self) -> &[String] {
        &self.channels[&self.active].messages
    }
    pub fn send(&mut self) -> Result<(), &'static str> {
        if self.draft().trim().is_empty() {
            return Err("请输入消息");
        }
        if self.active != "demo" {
            return Err("真实模型尚未接入；草稿已保留");
        }
        let c = self.channels.get_mut(&self.active).unwrap();
        c.messages.push(c.draft.clone());
        c.messages
            .push("这是本地演示回复，未调用任何模型。你的对话流程已经连通。".into());
        c.draft.clear();
        Ok(())
    }
}
