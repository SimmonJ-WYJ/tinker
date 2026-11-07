use serde_json::{json, Value};
use std::io::{self, BufReader, Cursor, Read};
use tinker_rust_foundation::{
    sdk_history::{read_sdk_history, SDKHistoryPage},
    session_history::{HistoryError, HistoryOptions, MAX_LINE_BYTES, MAX_PAGE_SOURCE_BYTES},
};

fn page(
    source: &str,
    limit: usize,
    before_line: Option<u64>,
) -> Result<SDKHistoryPage, HistoryError> {
    read_sdk_history(Cursor::new(source), HistoryOptions { limit, before_line })
}

fn user(text: &str) -> Value {
    json!({"type":"user","message":{"content":[{"type":"text","text":text}]},"parent_tool_use_id":null})
}

#[test]
fn synthetic_sdk_and_legacy_messages_are_readable_in_source_order() {
    let source = include_str!("../fixtures/sdk-messages.jsonl");
    let result = page(source, 64, None).unwrap();
    assert_eq!(result.protocol_version, 1);
    assert_eq!(result.entries.len(), 9);
    let originals: Vec<Value> = source
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    for (index, entry) in result.entries.iter().enumerate() {
        assert_eq!(entry.line_number, index as u64 + 1);
        assert_eq!(Value::Object(entry.raw.clone()), originals[index]);
    }
    assert_eq!(result.entries[0].kind, "legacy");
    assert_eq!(result.entries[0].text, "旧格式 🧠");
    assert_eq!(result.entries[0].uuid, None);
    assert_eq!(result.entries[1].text, "  修改原图 🧠\n");
    assert_eq!(result.entries[1].uuid.as_deref(), Some("user-uuid"));
    assert_eq!(result.entries[2].text, "<script>synthetic</script>\n第二段");
    for entry in &result.entries[3..] {
        assert!(entry.text.is_empty());
        assert_eq!(entry.kind, entry.raw["type"].as_str().unwrap());
    }
    assert_eq!(result.entries[8].uuid.as_deref(), Some("future-uuid"));
    assert_eq!(result.next_before_line, None);
    assert_eq!(result.incomplete_tail, None);
}

#[test]
fn response_serializes_exact_camel_case_protocol_and_explicit_null_fields() {
    let result = page(&user("正文").to_string(), 64, None).unwrap();
    assert_eq!(
        serde_json::to_value(result).unwrap(),
        json!({
            "protocolVersion":1,"entries":[{"lineNumber":1,"kind":"user","text":"正文","uuid":null,"raw":user("正文")}],
            "nextBeforeLine":null,"incompleteTail":null
        })
    );
}

#[test]
fn sdk_text_only_comes_from_text_blocks_and_unknown_fields_are_opaque() {
    let raw = json!({"type":"assistant","uuid":null,"message":{"content":[
        {"type":"thinking","thinking":"秘密"},
        {"type":"future_block","text":"不解释"},
        {"type":"tool_result","content":[{"type":"text","text":"不展开"}]},
        {"type":"text","text":""}, {"type":"text","text":"安全文本"}
    ]},"parent_tool_use_id":"parent","extension":{"html":"<b>原样保留</b>"}});
    let result = page(&raw.to_string(), 64, None).unwrap();
    assert_eq!(result.entries[0].text, "\n安全文本");
    assert_eq!(Value::Object(result.entries[0].raw.clone()), raw);
    let future = json!({"type":"future","message":false,"uuid":4,"role":"anything"});
    let entry = page(&future.to_string(), 64, None)
        .unwrap()
        .entries
        .remove(0);
    assert_eq!(entry.kind, "future");
    assert_eq!(entry.uuid, None);
    assert!(entry.text.is_empty());
    assert_eq!(Value::Object(entry.raw), future);
}

#[test]
fn user_and_assistant_validate_message_content_and_block_shape() {
    for kind in ["user", "assistant"] {
        for message in [
            Value::Null,
            json!("text"),
            json!({"content":null}),
            json!({"content":[null]}),
            json!({"content":[{}]}),
            json!({"content":[{"type":4}]}),
            json!({"content":[{"type":"text","text":4}]}),
            json!({"content":[{"type":"text"}]}),
        ] {
            assert_eq!(
                page(
                    &json!({"type":kind,"message":message}).to_string(),
                    64,
                    None
                ),
                Err(HistoryError::InvalidMessage { line: 1 })
            );
        }
        if kind == "assistant" {
            assert_eq!(
                page(&json!({"type":kind}).to_string(), 64, None),
                Err(HistoryError::InvalidMessage { line: 1 })
            );
            assert_eq!(
                page(&json!({"type":kind,"message":{}}).to_string(), 64, None),
                Err(HistoryError::InvalidMessage { line: 1 })
            );
        }
        assert!(page(
            &json!({"type":kind,"message":{"content":[]}}).to_string(),
            64,
            None
        )
        .is_ok());
    }
}

#[test]
fn mixed_reader_keeps_legacy_semantic_validation_strict() {
    for invalid in [
        json!(null),
        json!([]),
        json!({}),
        json!({"type":4}),
        json!({"type":""}),
        json!({"id":"","role":"user","content":"x","createdAt":1}),
        json!({"id":"x","role":"unknown","content":"x","createdAt":1}),
        json!({"id":"x","role":"user","content":4,"createdAt":1}),
        json!({"id":"x","role":"user","content":"x","createdAt":-1}),
        json!({"id":"x","role":"user","content":"x","createdAt":9007199254740992u64}),
    ] {
        assert_eq!(
            page(&invalid.to_string(), 64, None),
            Err(HistoryError::InvalidMessage { line: 1 })
        );
    }
}

#[test]
fn default_page_count_and_maximum_limit_preserve_source_line_cursors() {
    let source = (1..=270)
        .map(|id| format!("{}\n\n", user(&id.to_string())))
        .collect::<String>();
    let default = read_sdk_history(Cursor::new(&source), HistoryOptions::default()).unwrap();
    assert_eq!(default.entries.len(), 64);
    let mut before = None;
    let mut pages = Vec::new();
    loop {
        let result = page(&source, 256, before).unwrap();
        before = result.next_before_line;
        pages.push(
            result
                .entries
                .into_iter()
                .map(|entry| entry.line_number)
                .collect::<Vec<_>>(),
        );
        if before.is_none() {
            break;
        }
    }
    assert_eq!(
        pages.into_iter().rev().flatten().collect::<Vec<_>>(),
        (0..270).map(|n| n * 2 + 1).collect::<Vec<_>>()
    );
    for limit in [0, 257, usize::MAX] {
        assert_eq!(page("", limit, None), Err(HistoryError::InvalidOptions));
    }
    assert_eq!(page("", 64, Some(0)), Err(HistoryError::InvalidOptions));
    assert!(page("not json", 64, Some(1)).unwrap().entries.is_empty());
}

#[test]
fn every_truncated_unicode_sdk_tail_preserves_complete_prefix() {
    let saved = format!("{}\n", user("已保存"));
    let next = user("中文 🧠 with \"quotes\"\nsecond line").to_string();
    for boundary in 1..=next.len() {
        let mut input = saved.as_bytes().to_vec();
        input.extend_from_slice(&next.as_bytes()[..boundary]);
        let result = read_sdk_history(Cursor::new(input), HistoryOptions::default()).unwrap();
        assert_eq!(result.entries[0].text, "已保存");
        assert_eq!(
            result.entries.len(),
            if boundary == next.len() { 2 } else { 1 }
        );
        assert_eq!(
            result.incomplete_tail,
            if boundary == next.len() {
                None
            } else {
                Some(2)
            }
        );
    }
}

#[test]
fn corrupt_middle_invalid_utf8_and_newline_terminated_partial_tail_fail() {
    for tail in [
        b"not json\n".as_slice(),
        b"{\"type\":\"user\"\n",
        &[0xff],
        b"{\"type\":false}\xe4",
    ] {
        let mut input = format!("{}\n", user("saved")).into_bytes();
        input.extend_from_slice(tail);
        assert_eq!(
            read_sdk_history(Cursor::new(input), HistoryOptions::default()),
            Err(HistoryError::Corrupt { line: 2 })
        );
    }
}

#[test]
fn large_sdk_records_page_within_source_budget_without_losing_older_records() {
    let source = (0..20).map(|id| format!("{}\n", json!({"type":"future","uuid":id.to_string(),"opaque":"x".repeat(MAX_LINE_BYTES / 2)}))).collect::<String>();
    let lines = source.split_inclusive('\n').collect::<Vec<_>>();
    let mut before = None;
    let mut pages = Vec::new();
    loop {
        let result = page(&source, 64, before).unwrap();
        let retained: usize = result
            .entries
            .iter()
            .map(|entry| lines[entry.line_number as usize - 1].len())
            .sum();
        assert!(retained <= MAX_PAGE_SOURCE_BYTES);
        assert!(result.entries.len() < 20);
        before = result.next_before_line;
        pages.push(
            result
                .entries
                .into_iter()
                .map(|entry| entry.line_number)
                .collect::<Vec<_>>(),
        );
        if before.is_none() {
            break;
        }
    }
    assert_eq!(
        pages.into_iter().rev().flatten().collect::<Vec<_>>(),
        (1..=20).collect::<Vec<_>>()
    );
}

#[test]
fn oversized_sdk_line_is_rejected_before_consuming_the_rest_of_input() {
    let mut source = Cursor::new(vec![b'x'; MAX_LINE_BYTES * 4]);
    assert_eq!(
        read_sdk_history(&mut source, HistoryOptions::default()),
        Err(HistoryError::LineTooLarge { line: 1 })
    );
    assert_eq!(source.position(), (MAX_LINE_BYTES + 1) as u64);
}

struct BrokenRead;
impl Read for BrokenRead {
    fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
        Err(io::Error::other("合成私有错误"))
    }
}

#[test]
fn io_errors_expose_only_source_line() {
    assert_eq!(
        read_sdk_history(BufReader::new(BrokenRead), HistoryOptions::default()),
        Err(HistoryError::Io { line: 1 })
    );
}

#[test]
fn optional_user_payload_and_sdk_string_content_are_readable_without_normalizing_raw() {
    for raw in [json!({"type":"user"}), json!({"type":"user","message":{}})] {
        let result = page(&raw.to_string(), 64, None).unwrap();
        assert_eq!(result.entries[0].text, "");
        assert_eq!(Value::Object(result.entries[0].raw.clone()), raw);
    }
    for kind in ["user", "assistant"] {
        let raw = json!({"type":kind,"message":{"content":"  原始字符串 🧠\n<script>synthetic</script>"}});
        let result = page(&raw.to_string(), 64, None).unwrap();
        assert_eq!(
            result.entries[0].text,
            "  原始字符串 🧠\n<script>synthetic</script>"
        );
        assert_eq!(Value::Object(result.entries[0].raw.clone()), raw);
    }
}
