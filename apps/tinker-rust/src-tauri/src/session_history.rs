//! 只读兼容 Electron 简化消息 JSONL；按行限制输入，仅保留一页，不写回源数据。
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{collections::VecDeque, io::BufRead};

pub const MAX_LINE_BYTES: usize = 1_048_576;
pub const MAX_PAGE_MESSAGES: usize = 256;
/// 页还受原始行字节预算约束；解析后 JSON 堆内存并不等于该字节数。
pub const MAX_PAGE_SOURCE_BYTES: usize = 8 * MAX_LINE_BYTES;
const MAX_SAFE_TIMESTAMP: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MessageRole {
    User,
    Assistant,
    Tool,
    Status,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LegacyMessage {
    pub id: String,
    pub role: MessageRole,
    pub content: String,
    pub created_at: u64,
    /// 不解释未知字段，保留未来扩展或已有工具/错误元数据的 JSON 语义。
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HistoryEntry {
    pub line_number: u64,
    pub message: LegacyMessage,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HistoryPage {
    /// 保持源记录顺序；分页不按时间戳重排，也不对重复 ID 猜测去重。
    pub entries: Vec<HistoryEntry>,
    pub next_before_line: Option<u64>,
    pub incomplete_tail: Option<u64>,
}

#[derive(Debug, Clone, Copy)]
pub struct HistoryOptions {
    pub limit: usize,
    pub before_line: Option<u64>,
}
impl Default for HistoryOptions {
    fn default() -> Self {
        Self {
            limit: 64,
            before_line: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HistoryError {
    InvalidOptions,
    Io { line: u64 },
    LineTooLarge { line: u64 },
    Corrupt { line: u64 },
    InvalidMessage { line: u64 },
}

pub fn read_history(
    reader: impl BufRead,
    options: HistoryOptions,
) -> Result<HistoryPage, HistoryError> {
    let page = scan_history(reader, options, |value| {
        validate_legacy(&value)?;
        serde_json::from_value(value).map_err(|_| ())
    })?;
    Ok(HistoryPage {
        entries: page
            .entries
            .into_iter()
            .map(|(line_number, message)| HistoryEntry {
                line_number,
                message,
            })
            .collect(),
        next_before_line: page.next_before_line,
        incomplete_tail: page.incomplete_tail,
    })
}

/// 两种读取器使用同一校验，避免兼容路径放宽旧消息约束或复制大块未知元数据。
pub(crate) fn validate_legacy(value: &Value) -> Result<(), ()> {
    let valid = value["id"].as_str().is_some_and(|id| !id.is_empty())
        && matches!(
            value["role"].as_str(),
            Some("user" | "assistant" | "tool" | "status")
        )
        && value["content"].is_string()
        && value["createdAt"]
            .as_u64()
            .is_some_and(|timestamp| timestamp <= MAX_SAFE_TIMESTAMP);
    if valid {
        Ok(())
    } else {
        Err(())
    }
}

pub(crate) struct ScannedHistory<T> {
    pub entries: Vec<(u64, T)>,
    pub next_before_line: Option<u64>,
    pub incomplete_tail: Option<u64>,
}

/// 有界扫描只负责源行、JSON 和页预算；调用方决定记录语义。
pub(crate) fn scan_history<T>(
    mut reader: impl BufRead,
    options: HistoryOptions,
    mut decode: impl FnMut(Value) -> Result<T, ()>,
) -> Result<ScannedHistory<T>, HistoryError> {
    if !(1..=MAX_PAGE_MESSAGES).contains(&options.limit) || options.before_line == Some(0) {
        return Err(HistoryError::InvalidOptions);
    }
    let mut entries = VecDeque::with_capacity(options.limit);
    let mut line_number = 0u64;
    let mut bytes = Vec::new();
    let mut has_earlier = false;
    let mut retained_source_bytes = 0;
    let mut incomplete_tail = None;
    loop {
        line_number = line_number
            .checked_add(1)
            .ok_or(HistoryError::InvalidOptions)?;
        if options
            .before_line
            .is_some_and(|before| line_number >= before)
        {
            break;
        }
        bytes.clear();
        // Take 必须在 read_until 之前限制字节，避免超长输入先分配整个文件。
        let read = std::io::Read::take(&mut reader, (MAX_LINE_BYTES + 1) as u64)
            .read_until(b'\n', &mut bytes)
            .map_err(|_| HistoryError::Io { line: line_number })?;
        if read == 0 {
            break;
        }
        if bytes.len() > MAX_LINE_BYTES {
            return Err(HistoryError::LineTooLarge { line: line_number });
        }
        let text = match std::str::from_utf8(&bytes) {
            Ok(text) => text,
            // 追加中断也可能发生在中文/emoji的多字节码点中，不将完整前缀变成整页失败。
            Err(error) if error.error_len().is_none() && !bytes.ends_with(b"\n") => {
                // 只有尚可继续写成 JSON 的前缀可降级；坏 JSON 后追加半个码点仍是损坏。
                if serde_json::from_slice::<Value>(&bytes[..error.valid_up_to()])
                    .is_err_and(|error| error.is_eof())
                {
                    incomplete_tail = Some(line_number);
                    break;
                }
                return Err(HistoryError::Corrupt { line: line_number });
            }
            Err(_) => return Err(HistoryError::Corrupt { line: line_number }),
        };
        if text.trim().is_empty() {
            continue;
        }
        let value: Value = match serde_json::from_str(text) {
            Ok(value) => value,
            Err(error) if error.is_eof() && !bytes.ends_with(b"\n") => {
                incomplete_tail = Some(line_number);
                break;
            }
            Err(_) => return Err(HistoryError::Corrupt { line: line_number }),
        };
        let message =
            decode(value).map_err(|_| HistoryError::InvalidMessage { line: line_number })?;
        while entries.len() == options.limit
            || retained_source_bytes + bytes.len() > MAX_PAGE_SOURCE_BYTES
        {
            if let Some((_, size)) = entries.pop_front() {
                retained_source_bytes -= size;
            }
            has_earlier = true;
        }
        retained_source_bytes += bytes.len();
        entries.push_back(((line_number, message), bytes.len()));
    }
    Ok(ScannedHistory {
        next_before_line: if has_earlier {
            entries.front().map(|((line, _), _)| *line)
        } else {
            None
        },
        entries: entries.into_iter().map(|(entry, _)| entry).collect(),
        incomplete_tail,
    })
}
