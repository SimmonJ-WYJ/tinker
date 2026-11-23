//! 仅导入用户可读的对话正文与明确绑定的附件描述。
use super::{
    attachments::Files,
    fs::Dir,
    reader::{timestamp, warning, Budget},
    *,
};
use crate::{
    desktop_runtime::protocol::id,
    run_types::{MAX_INPUT_BYTES, MAX_OUTPUT_BYTES},
};
use serde_json::Value;
use std::collections::HashSet;
fn note(
    files: &mut Vec<String>,
    result: std::result::Result<String, &'static str>,
    warnings: &mut Vec<ImportWarning>,
    sid: &str,
) {
    match result {
        Ok(id) => {
            if !files.contains(&id) {
                files.push(id);
            }
        }
        Err(code) => warning(warnings, code, sid),
    }
}
fn block_result(b: &Value) -> Option<Value> {
    let content = &b["content"];
    let text = content
        .as_str()
        .or_else(|| content.as_array()?.iter().find(|c| c["type"] == "text")?["text"].as_str())?;
    let response: Value = serde_json::from_str(text).ok()?;
    let mut image = response.get("generatedImage")?.as_object()?.clone();
    if !image.contains_key("id") {
        if let Some(id) = response["imageId"].as_str() {
            image.insert("id".into(), Value::String(id.into()));
        }
    }
    Some(Value::Object(image))
}
fn date(row: &Value, fallback: u64) -> u64 {
    timestamp(&row["_createdAt"])
        .or_else(|| timestamp(&row["createdAt"]))
        .or_else(|| {
            let s = row["timestamp"].as_str()?;
            let time =
                time::OffsetDateTime::parse(s, &time::format_description::well_known::Rfc3339)
                    .ok()?;
            let value = u64::try_from(time.unix_timestamp_nanos() / 1_000_000).ok()?;
            (value <= crate::desktop_runtime::protocol::MAX_SAFE_INTEGER).then_some(value)
        })
        .unwrap_or(fallback)
}
fn enriched_prompt(text: &str) -> bool {
    let text = text.trim_start();
    [
        "<conversation_history>",
        "<language_lock>",
        "**Current time:",
        "<user_retained_context>",
        "<mentioned_tools>",
        "<zotero-context>",
        "<zotero_attachments>",
        "<evidence-set-context>",
        "The user selected this exact image version for editing:",
        "<workspace_state>",
        "<working_directory>",
    ]
    .iter()
    .any(|prefix| text.starts_with(prefix))
        || text.trim_end().ends_with("</language_lock>")
}

pub(super) fn parse(
    bytes: &[u8],
    raw_sdk: bool,
    root: &Dir,
    slug: Option<&str>,
    session: &mut SourceSession,
    budget: &mut Budget,
    warnings: &mut Vec<ImportWarning>,
) -> Result<()> {
    let sid = session.source_session_id.as_str();
    let mut files = Files {
        root,
        sid,
        slug,
        output: &mut session.attachments,
        budget,
    };
    let mut seen = HashSet::<String>::new();
    let mut tools = HashSet::new();
    let mut rows = 0;
    for (index, line) in bytes.split(|&c| c == b'\n').enumerate() {
        if line.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        rows += 1;
        if rows > 8192 || line.len() > 2 * 1024 * 1024 {
            return Err(DesktopError("invalidHistory"));
        }
        let row: Value = match serde_json::from_slice(line) {
            Ok(v) => v,
            Err(_) => {
                warning(warnings, "incompleteHistory", sid);
                continue;
            }
        };
        if [
            "isSidechain",
            "isMeta",
            "isSynthetic",
            "isApiErrorMessage",
            "isCompactSummary",
        ]
        .iter()
        .any(|key| row[*key] == true)
            || !row["parent_tool_use_id"].is_null()
            || !row["error"].is_null()
        {
            warning(warnings, "unsupportedRecord", sid);
            continue;
        }
        let legacy = row.get("type").is_none();
        let Some(mut role) = (if legacy {
            row["role"].as_str()
        } else {
            row["type"].as_str()
        })
        .filter(|r| matches!(*r, "user" | "assistant")) else {
            warning(warnings, "unsupportedRecord", sid);
            continue;
        };
        let fallback = format!("legacy-line-{}", index + 1);
        let source_id = row["uuid"]
            .as_str()
            .or(row["id"].as_str())
            .filter(|v| id(v).is_ok())
            .unwrap_or(&fallback);
        if seen.contains(source_id) {
            warning(warnings, "duplicateMessage", sid);
            continue;
        }
        let content = if legacy {
            &row["content"]
        } else {
            &row["message"]["content"]
        };
        let mut ids = vec![];
        let mut text = String::new();
        let mut has_text = false;
        if let Some(s) = content.as_str() {
            text = s.to_string();
            has_text = true;
        } else if let Some(blocks) = content.as_array() {
            if blocks.len() > 1024 {
                return Err(DesktopError("invalidHistory"));
            }
            let mut result_row = false;
            for block in blocks {
                match block["type"].as_str() {
                    Some("text") => {
                        if let Some(s) = block["text"].as_str() {
                            if has_text {
                                text.push('\n');
                            }
                            text.push_str(s);
                            has_text = true;
                        }
                    }
                    Some("tool_use")
                        if role == "assistant"
                            && block["name"] == "mcp__asci-image__generate_image" =>
                    {
                        if let Some(token) = block["id"].as_str().filter(|v| id(v).is_ok()) {
                            tools.insert(token.to_owned());
                        }
                    }
                    Some("tool_result") if role == "user" => {
                        result_row = true;
                        if block["tool_use_id"]
                            .as_str()
                            .is_some_and(|t| tools.remove(t))
                            && block["is_error"] != true
                        {
                            if let Some(desc) = block_result(block) {
                                note(&mut ids, files.descriptor(&desc), warnings, sid);
                            }
                        }
                    }
                    _ => warning(warnings, "unsupportedRecord", sid),
                }
            }
            // 工具结果及随附文本不作为用户输入。
            if result_row {
                role = "assistant";
                text.clear();
                has_text = false;
            }
        }
        if role == "user" {
            // 原始 SDK 日志可能只有注入工作目录、渠道上下文等信息后的复合提示。
            // 缺少展示版正文时跳过该行，避免把宿主信息存入新会话和后续模型上下文。
            if raw_sdk && enriched_prompt(&text) {
                warning(warnings, "unsupportedRecord", sid);
                continue;
            }
            if text.trim() == "/compact"
                || ["<system-reminder>", "<local-command-", "<command-name>"]
                    .iter()
                    .any(|p| text.trim_start().starts_with(p))
            {
                warning(warnings, "unsupportedRecord", sid);
                continue;
            }

            if let Some(desc) = row.get("imageEditReference").filter(|v| !v.is_null()) {
                note(&mut ids, files.descriptor(desc), warnings, sid);
            }
            if let Some(refs) = row["attachments"].as_array() {
                for desc in refs.iter().take(64) {
                    note(&mut ids, files.descriptor(desc), warnings, sid);
                }
                if refs.len() > 64 {
                    warning(warnings, "attachmentLimit", sid);
                }
            }
            if let Some(rest) = text.strip_prefix("<attached_files>") {
                if let Some((list, body)) = rest.split_once("</attached_files>") {
                    for (n, line) in list.lines().filter(|v| !v.is_empty()).enumerate() {
                        if n == 64 {
                            warning(warnings, "attachmentLimit", sid);
                            break;
                        }
                        note(&mut ids, files.workspace_file(line), warnings, sid);
                    }
                    text = body.trim_start_matches(['\n', '\r']).to_owned();
                } else {
                    warning(warnings, "incompleteHistory", sid);
                    text.clear();
                    has_text = false;
                }
            }
        }
        if role == "user" {
            while text.starts_with("<referenced_directory ") {
                warning(warnings, "unsupportedRecord", sid);
                if let Some((_, body)) = text.split_once("</referenced_directory>") {
                    text = body.trim_start_matches(['\n', '\r']).to_owned();
                } else {
                    text.clear();
                    has_text = false;
                    break;
                }
            }
        }
        if !has_text && ids.is_empty() {
            continue;
        }
        if text.len()
            > if role == "user" {
                MAX_INPUT_BYTES
            } else {
                MAX_OUTPUT_BYTES
            }
            || session.messages.len() >= 256
        {
            return Err(DesktopError("invalidHistory"));
        }
        seen.insert(source_id.to_owned());
        session.messages.push(SourceMessage {
            id: source_id.into(),
            role: role.into(),
            text,
            created_at: date(&row, session.created_at),
            attachment_ids: ids,
        });
    }
    if session.messages.is_empty() {
        return Err(DesktopError("invalidHistory"));
    }
    Ok(())
}
