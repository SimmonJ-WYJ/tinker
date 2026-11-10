//! 不可变的显式父链与有界文本上下文；不接受渲染器消息数组。
use crate::run_types::{validate_id, RunError};
use serde::{Deserialize, Serialize};
pub const CONTEXT_POLICY_VERSION: u32 = 1;
pub const MAX_CONTEXT_ANCESTORS: usize = 16;
pub const MAX_CONTEXT_BYTES: usize = 512 * 1024;
pub const MAX_HTTP_REQUEST_BYTES: usize = 4 * 1024 * 1024;
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ParentRunRef {
    pub run_id: String,
    pub sequence: u64,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RunLineage {
    Standalone,
    Continuation {
        parent: ParentRunRef,
        policy_version: u32,
    },
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ChatRole {
    User,
    Assistant,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ChatMessage {
    pub role: ChatRole,
    pub content: String,
}
#[derive(Debug, Clone)]
pub struct RunContext {
    messages: Vec<ChatMessage>,
}
impl RunContext {
    pub fn single(input: &str) -> Self {
        Self {
            messages: vec![ChatMessage {
                role: ChatRole::User,
                content: input.into(),
            }],
        }
    }
    pub fn messages(&self) -> &[ChatMessage] {
        &self.messages
    }
    pub(crate) fn from_turns(turns: Vec<(String, String)>, input: &str) -> Result<Self, RunError> {
        if turns.len() > MAX_CONTEXT_ANCESTORS {
            return Err(RunError::ContextLimitExceeded);
        }
        let mut messages = Vec::new();
        let mut bytes = input.len();
        for (user, assistant) in turns {
            bytes = bytes
                .checked_add(user.len())
                .and_then(|n| n.checked_add(assistant.len()))
                .ok_or(RunError::ContextLimitExceeded)?;
            if bytes > MAX_CONTEXT_BYTES {
                return Err(RunError::ContextLimitExceeded);
            }
            messages.push(ChatMessage {
                role: ChatRole::User,
                content: user,
            });
            messages.push(ChatMessage {
                role: ChatRole::Assistant,
                content: assistant,
            });
        }
        if bytes > MAX_CONTEXT_BYTES {
            return Err(RunError::ContextLimitExceeded);
        }
        messages.push(ChatMessage {
            role: ChatRole::User,
            content: input.into(),
        });
        Ok(Self { messages })
    }
}
pub(crate) fn validate_parent(parent: &ParentRunRef, id: &str) -> Result<(), RunError> {
    if validate_id(&parent.run_id).is_err() || parent.run_id == id || parent.sequence == 0 {
        return Err(RunError::CorruptLog);
    }
    Ok(())
}
