//! 搜索原 UI 能呈现的 SDK 文本。片段边界保留完整字符，偏移使用 JS UTF-16。
use serde_json::{json, Value};

fn snippet(text: &str, needle: &str) -> Option<(String, usize, usize)> {
    let folded_start = text.to_lowercase().find(needle)?;
    let folded_end = folded_start + needle.len();
    // 一个字符的小写映射可能变长（如 İ → i + 组合点），不可直接切原 UTF-8。
    let mut folded = 0;
    let mut start = 0;
    let mut end = text.len();
    for (byte, ch) in text.char_indices() {
        if folded <= folded_start {
            start = byte;
        }
        folded += ch.to_lowercase().map(char::len_utf8).sum::<usize>();
        if folded >= folded_end {
            end = byte + ch.len_utf8();
            break;
        }
    }
    let context = |chars: &mut dyn Iterator<Item = char>| {
        let (mut bytes, mut units) = (0, 0);
        for ch in chars {
            if units + ch.len_utf16() > 40 {
                break;
            }
            bytes += ch.len_utf8();
            units += ch.len_utf16();
        }
        (bytes, units)
    };
    let (left, left_units) = context(&mut text[..start].chars().rev());
    let (right, _) = context(&mut text[end..].chars());
    let from = start - left;
    let to = end + right;
    let prefix = if from > 0 { "..." } else { "" };
    let suffix = if to < text.len() { "..." } else { "" };
    Some((
        format!("{prefix}{}{suffix}", &text[from..to]),
        prefix.len() + left_units,
        text[start..end].encode_utf16().count(),
    ))
}

/// 原 UI 在已有正常正文/工具块的回合中只显示末尾错误标签，不展示错误消息的隐藏正文。
pub(super) fn turn_hit(needle: &str, messages: &[Value]) -> Option<Value> {
    let has_normal_blocks = messages.iter().any(|m| {
        m["type"] == "assistant"
            && m["error"].is_null()
            && m["message"]["content"]
                .as_array()
                .is_some_and(|blocks| !blocks.is_empty())
    });
    messages
        .iter()
        .filter(|m| !has_normal_blocks || m["error"].is_null())
        .find_map(|m| hit(needle, m))
}

pub(super) fn hit(needle: &str, message: &Value) -> Option<Value> {
    let role = message["type"].as_str()?;
    if !matches!(role, "user" | "assistant") {
        return None;
    }
    let content = message["message"]["content"].as_array()?;
    let blocks: Vec<_> = content
        .iter()
        .filter(|block| block["type"] == "text")
        .filter_map(|block| block["text"].as_str())
        .filter(|text| !text.is_empty())
        .collect();
    let mut text = blocks.join("\n");
    if role == "user" {
        // groupIntoTurns 隐藏压缩指令；UserInputMessage 仅渲染附件块之外的正文。
        if blocks.len() == content.len() && blocks.concat().trim() == "/compact" {
            return None;
        }
        if let Some((prefix, rest)) = text.split_once("<attached_files>") {
            if let Some((_, suffix)) = rest.split_once("</attached_files>") {
                text = format!("{prefix}{}", suffix.trim_start_matches('\n'))
                    .trim()
                    .to_owned();
            }
        }
    }
    let (snippet, start, length) = snippet(&text, needle)?;
    let uuid = message["uuid"].as_str()?;
    // 与 renderer/lib/native-message-identity.ts 的展示身份一致。
    let id = if let (Some(chain), Some(queued)) = (
        message["_desktopQueueChainId"].as_str(),
        message["_desktopQueueUuid"].as_str(),
    ) {
        format!("native-queue:{}", json!([chain, queued]))
    } else if let Some(run) = message["_desktopRunId"].as_str() {
        format!("native-run:{}", json!([run, uuid]))
    } else {
        uuid.to_owned()
    };
    Some(
        json!({"messageId":id,"role":role,"snippet":snippet,"matchStart":start,"matchLength":length}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn folded_offsets_use_original_utf16_not_lowercase_bytes() {
        assert_eq!(
            snippet("😀İ BEFORE ΩΣ", "before"),
            Some(("😀İ BEFORE ΩΣ".into(), 4, 6))
        );
        assert_eq!(snippet("😀İ", "i\u{307}"), Some(("😀İ".into(), 2, 1)));
        assert_eq!(snippet("AİB", "\u{307}b"), Some(("AİB".into(), 1, 2)));
        let result = snippet(
            &format!("{}a🌱B{}", "🍐".repeat(25), "葱".repeat(42)),
            "🌱b",
        )
        .unwrap();
        assert_eq!(result.1, 42);
        assert_eq!(result.2, 3);
    }
    #[test]
    fn hidden_user_markup_is_neither_a_hit_nor_part_of_surrounding_context() {
        let mut message = json!({"type":"user","uuid":"u","message":{"content":[{"type":"text","text":"<attached_files>\n- file: /private/hidden-marker\n</attached_files>\nvisible line"}]}});
        assert!(hit("hidden-marker", &message).is_none());
        assert_eq!(hit("visible", &message).unwrap()["snippet"], "visible line");
        message["message"]["content"][0]["text"] = json!(" /compact ");
        assert!(hit("compact", &message).is_none());
    }
    #[test]
    fn error_only_turn_exposes_partial_text_but_mixed_tool_error_does_not() {
        let error = json!({"type":"assistant","uuid":"partial","message":{"content":[{"type":"text","text":"partial body"}]},"error":{"message":"responseFailed"}});
        assert!(turn_hit("partial", std::slice::from_ref(&error)).is_some());
        let previous = json!({"type":"assistant","uuid":"tool","message":{"content":[{"type":"tool_use","name":"read"}]}});
        assert!(turn_hit("partial", &[previous, error]).is_none());
    }

    #[test]
    fn raw_tool_arguments_status_and_tool_results_are_not_searchable() {
        let message = json!({"type":"assistant","uuid":"plain","_desktopRunId":"a","message":{"content":[{"type":"tool_use","input":{"path":"private-marker"}},{"type":"text","text":"visible block"}]}});
        assert!(hit("private", &message).is_none());
        assert_eq!(
            hit("visible", &message).unwrap()["messageId"],
            r#"native-run:["a","plain"]"#
        );
        let tool = json!({"type":"user","uuid":"b","message":{"content":[{"type":"tool_result","content":"private-marker"}]}});
        assert!(hit("private", &tool).is_none());
    }
}
