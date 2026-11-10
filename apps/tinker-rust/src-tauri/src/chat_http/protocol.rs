//! 协议可映射的档位上界；具体模型支持由可信宿主显式声明。
use serde::{Deserialize, Serialize};
#[derive(Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum HttpProtocol {
    #[default]
    #[serde(rename = "openai-chat")]
    OpenaiChat,
    #[serde(rename = "anthropic-messages")]
    AnthropicMessages,
}
impl HttpProtocol {
    pub fn allowed_efforts(self) -> &'static [&'static str] {
        match self {
            Self::OpenaiChat => &["low", "medium", "high"],
            Self::AnthropicMessages => &["low", "medium", "high", "max"],
        }
    }
}
