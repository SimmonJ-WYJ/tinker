//! 只读原始 SDK / 旧消息混排历史；仅提取正文文本，完整 JSON 保留且不解释工具或附件。
use crate::session_history::{scan_history, validate_legacy, HistoryError, HistoryOptions};
use serde::Serialize;
use serde_json::{Map, Value};
use std::io::BufRead;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SDKHistoryEntry {
    pub line_number: u64,
    /// SDK 保持源 type；旧消息固定为 legacy。未知类型仅作为不透明数据保留。
    pub kind: String,
    pub text: String,
    pub uuid: Option<String>,
    pub raw: Map<String, Value>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SDKHistoryPage {
    pub protocol_version: u8,
    pub entries: Vec<SDKHistoryEntry>,
    pub next_before_line: Option<u64>,
    pub incomplete_tail: Option<u64>,
}

pub fn read_sdk_history(
    reader: impl BufRead,
    options: HistoryOptions,
) -> Result<SDKHistoryPage, HistoryError> {
    let page = scan_history(reader, options, decode_message)?;
    Ok(SDKHistoryPage {
        protocol_version: 1,
        entries: page
            .entries
            .into_iter()
            .map(|(line_number, mut entry)| {
                entry.line_number = line_number;
                entry
            })
            .collect(),
        next_before_line: page.next_before_line,
        incomplete_tail: page.incomplete_tail,
    })
}

fn decode_message(value: Value) -> Result<SDKHistoryEntry, ()> {
    let raw = value.as_object().ok_or(())?;
    let (kind, text) = if let Some(kind) = raw.get("type") {
        let kind = kind.as_str().filter(|kind| !kind.is_empty()).ok_or(())?;
        let text = match kind {
            "user" => match raw.get("message") {
                Some(message) => extract_text(message, true)?,
                None => String::new(),
            },
            "assistant" => extract_text(raw.get("message").ok_or(())?, false)?,
            _ => String::new(),
        };
        (kind.to_owned(), text)
    } else {
        validate_legacy(&value)?;
        (
            "legacy".to_owned(),
            value["content"].as_str().ok_or(())?.to_owned(),
        )
    };
    let uuid = raw.get("uuid").and_then(Value::as_str).map(str::to_owned);
    let Value::Object(raw) = value else {
        return Err(());
    };
    Ok(SDKHistoryEntry {
        line_number: 0,
        kind,
        text,
        uuid,
        raw,
    })
}

fn extract_text(message: &Value, optional_content: bool) -> Result<String, ()> {
    let message = message.as_object().ok_or(())?;
    let content = match message.get("content") {
        None if optional_content => return Ok(String::new()),
        // 同时兼容 SDK 字符串正文与本仓库写入器的内容块数组。
        Some(Value::String(text)) => return Ok(text.clone()),
        Some(Value::Array(content)) => content,
        _ => return Err(()),
    };
    let mut parts = Vec::new();
    for block in content {
        let kind = block
            .as_object()
            .and_then(|block| block.get("type"))
            .and_then(Value::as_str)
            .ok_or(())?;
        if kind == "text" {
            parts.push(block.get("text").and_then(Value::as_str).ok_or(())?);
        }
    }
    Ok(parts.join("\n"))
}
