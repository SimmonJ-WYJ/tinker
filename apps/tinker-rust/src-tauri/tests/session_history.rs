use std::io::{self, BufReader, Cursor, Read};
use tinker_rust_foundation::session_history::{
    read_history, HistoryError, HistoryOptions, MessageRole, MAX_LINE_BYTES,
};

fn line(id: usize, role: &str, content: &str) -> String {
    format!(
        "{}\n",
        serde_json::json!({"id":format!("m-{id}"),"role":role,"content":content,"createdAt":1700000000000u64+id as u64})
    )
}
fn page(
    input: &str,
    limit: usize,
    before_line: Option<u64>,
) -> Result<tinker_rust_foundation::session_history::HistoryPage, HistoryError> {
    read_history(
        Cursor::new(input.as_bytes()),
        HistoryOptions { limit, before_line },
    )
}
#[test]
fn empty_history_has_no_messages_or_cursor() {
    let result = page("", 64, None).unwrap();
    assert!(result.entries.is_empty());
    assert_eq!(result.next_before_line, None);
    assert_eq!(result.incomplete_tail, None);
}
#[test]
fn unicode_roles_and_unknown_metadata_survive_without_rewriting_source() {
    let input = ["user", "assistant", "tool", "status"]
        .iter()
        .enumerate()
        .map(|(i, role)| line(i, role, "  修改图像 🧠\n"))
        .collect::<String>();
    let original = input.clone();
    let result = page(&input, 64, None).unwrap();
    assert_eq!(result.entries.len(), 4);
    assert_eq!(result.entries[0].message.role, MessageRole::User);
    assert_eq!(result.entries[3].message.role, MessageRole::Status);
    assert_eq!(result.entries[1].message.content, "  修改图像 🧠\n");
    assert_eq!(input, original);
    let extra = serde_json::json!({"id":"exact","role":"assistant","content":"ok","createdAt":1,"model":"fixture","events":[{"future":"keep"}],"imageEditReference":{"imageId":"first"}});
    let result = page(&extra.to_string(), 64, None).unwrap();
    assert_eq!(
        serde_json::to_value(&result.entries[0].message).unwrap(),
        extra
    );
}
#[test]
fn pages_are_chronological_and_do_not_repeat_or_lose_messages() {
    let input = (1..=10).map(|i| line(i, "user", "ok")).collect::<String>();
    let mut before = None;
    let mut pages = Vec::new();
    loop {
        let result = page(&input, 3, before).unwrap();
        before = result.next_before_line;
        pages.push(
            result
                .entries
                .iter()
                .map(|entry| entry.line_number)
                .collect::<Vec<_>>(),
        );
        if before.is_none() {
            break;
        }
    }
    assert_eq!(
        pages,
        vec![vec![8, 9, 10], vec![5, 6, 7], vec![2, 3, 4], vec![1]]
    );
}
#[test]
fn blank_lines_keep_source_line_cursors_and_complete_non_newline_tail_is_valid() {
    let input = format!(
        "\n{}\r\n{}",
        line(1, "user", "first"),
        line(2, "assistant", "last").trim_end()
    );
    let result = page(&input, 1, None).unwrap();
    assert_eq!(result.entries[0].line_number, 4);
    assert_eq!(result.incomplete_tail, None);
    let previous = page(&input, 1, result.next_before_line).unwrap();
    assert_eq!(previous.entries[0].line_number, 2);
    assert_eq!(previous.next_before_line, None);
}
#[test]
fn incomplete_last_record_is_reported_but_not_committed_or_silently_repaired() {
    let input = format!("{}{{\"id\":\"unfinished", line(1, "user", "keep"));
    let result = page(&input, 64, None).unwrap();
    assert_eq!(result.entries.len(), 1);
    assert_eq!(result.incomplete_tail, Some(2));
    assert!(input.ends_with("unfinished"));
    assert_eq!(
        page(&(input + "\n"), 64, None),
        Err(HistoryError::Corrupt { line: 2 })
    );
}
#[test]
fn corrupt_middle_and_invalid_semantics_fail_without_a_partial_success() {
    assert_eq!(
        page(
            &format!("{}not json\n{}", line(1, "user", "a"), line(2, "user", "b")),
            64,
            None
        ),
        Err(HistoryError::Corrupt { line: 2 })
    );
    for invalid in [
        serde_json::json!({"id":"x","role":"developer","content":"x","createdAt":1}),
        serde_json::json!({"type":"assistant","message":{"content":[]}}),
        serde_json::json!({"id":"x","role":"user","content":"x","createdAt":9007199254740992u64}),
        serde_json::json!({"id":"","role":"user","content":"x","createdAt":1}),
    ] {
        assert_eq!(
            page(&invalid.to_string(), 64, None),
            Err(HistoryError::InvalidMessage { line: 1 })
        );
    }
}
#[test]
fn line_and_option_limits_are_enforced_before_unbounded_allocation() {
    assert_eq!(
        page(&"x".repeat(MAX_LINE_BYTES + 1), 64, None),
        Err(HistoryError::LineTooLarge { line: 1 })
    );
    for limit in [0, 257, usize::MAX] {
        assert_eq!(page("", limit, None), Err(HistoryError::InvalidOptions));
    }
    assert_eq!(page("", 64, Some(0)), Err(HistoryError::InvalidOptions));
    assert!(page("broken", 64, Some(1)).unwrap().entries.is_empty());
}
struct BrokenRead;
impl Read for BrokenRead {
    fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
        Err(io::Error::other("private fixture error"))
    }
}
#[test]
fn read_errors_and_invalid_utf8_are_typed_without_contents() {
    assert_eq!(
        read_history(BufReader::new(BrokenRead), HistoryOptions::default()),
        Err(HistoryError::Io { line: 1 })
    );
    assert_eq!(
        read_history(Cursor::new([0xff, b'\n']), HistoryOptions::default()),
        Err(HistoryError::Corrupt { line: 1 })
    );
}

#[test]
fn fixture_checked_against_typescript_agent_message_is_readable_without_losing_fields() {
    let source = include_str!("../fixtures/legacy-agent-messages.jsonl");
    let result = page(source, 64, None).unwrap();
    assert_eq!(result.entries.len(), 4);
    assert_eq!(result.entries[0].message.content, "  修改原图 🧠\n");
    assert_eq!(result.entries[1].message.extra["model"], "fixture-model");
    assert_eq!(
        result.entries[3].message.extra["fixtureExtra"]["unknownField"],
        serde_json::json!([1, true, null])
    );
    let before = page(
        source,
        2,
        result.entries.last().map(|entry| entry.line_number),
    )
    .unwrap();
    assert_eq!(
        before
            .entries
            .iter()
            .map(|entry| entry.message.id.as_str())
            .collect::<Vec<_>>(),
        vec!["fixture-assistant", "fixture-tool"]
    );
}

#[test]
fn truncated_multibyte_tail_preserves_prior_complete_messages_but_invalid_utf8_is_rejected() {
    let complete = line(1, "user", "完整记录");
    for partial in [vec![0xe4], vec![0xe4, 0xb8], vec![0xf0, 0x9f, 0xa7]] {
        let mut input = complete.as_bytes().to_vec();
        input.extend_from_slice(b"{\"id\":\"m-2\",\"role\":\"assistant\",\"content\":\"");
        input.extend_from_slice(&partial);
        let result = read_history(Cursor::new(&input), HistoryOptions::default()).unwrap();
        assert_eq!(result.entries.len(), 1);
        assert_eq!(result.entries[0].message.content, "完整记录");
        assert_eq!(result.incomplete_tail, Some(2));
        input.push(b'\n');
        assert_eq!(
            read_history(Cursor::new(input), HistoryOptions::default()),
            Err(HistoryError::Corrupt { line: 2 })
        );
    }
    let mut invalid = complete.into_bytes();
    invalid.extend_from_slice(&[0xff]);
    assert_eq!(
        read_history(Cursor::new(invalid), HistoryOptions::default()),
        Err(HistoryError::Corrupt { line: 2 })
    );
}

#[test]
fn bad_json_prefix_cannot_be_hidden_by_a_truncated_utf8_codepoint() {
    for bad_prefix in ["not-json", "{\"id\": 1} trailing", "[1,]", "{\"id\":\"x\"}"] {
        let mut input = line(1, "user", "complete").into_bytes();
        input.extend_from_slice(bad_prefix.as_bytes());
        input.push(0xe4);
        assert_eq!(
            read_history(Cursor::new(input), HistoryOptions::default()),
            Err(HistoryError::Corrupt { line: 2 })
        );
    }
}

#[test]
fn every_partial_byte_boundary_of_a_valid_unicode_record_preserves_complete_history() {
    let complete = line(1, "user", "saved");
    let next = line(2, "assistant", "中文 🧠 with \"quotes\"\nsecond line");
    let next = next.trim_end().as_bytes();
    for boundary in 1..=next.len() {
        let mut input = complete.as_bytes().to_vec();
        input.extend_from_slice(&next[..boundary]);
        let result = read_history(Cursor::new(input), HistoryOptions::default()).unwrap();
        assert_eq!(result.entries[0].message.id, "m-1");
        if boundary < next.len() {
            assert_eq!(result.entries.len(), 1, "boundary {boundary}");
            assert_eq!(result.incomplete_tail, Some(2), "boundary {boundary}");
        } else {
            assert_eq!(result.entries.len(), 2);
            assert_eq!(result.incomplete_tail, None);
        }
    }
}

#[test]
fn oversized_record_stops_consuming_at_the_line_bound() {
    let input = vec![b'x'; MAX_LINE_BYTES * 4];
    let mut reader = Cursor::new(input);
    assert_eq!(
        read_history(&mut reader, HistoryOptions::default()),
        Err(HistoryError::LineTooLarge { line: 1 })
    );
    assert_eq!(reader.position(), (MAX_LINE_BYTES + 1) as u64);
}

#[test]
fn large_valid_messages_page_by_source_budget_without_losing_older_records() {
    let input = (1..=20)
        .map(|id| line(id, "assistant", &"x".repeat(MAX_LINE_BYTES / 2)))
        .collect::<String>();
    let source_lines = input.split_inclusive('\n').collect::<Vec<_>>();
    let first = page(&input, 64, None).unwrap();
    assert!(
        first.entries.len() < 20,
        "large records must not fill the entire message-count window"
    );
    assert!(first.next_before_line.is_some());
    let mut before = None;
    let mut pages = Vec::new();
    loop {
        let result = page(&input, 64, before).unwrap();
        let retained_bytes: usize = result
            .entries
            .iter()
            .map(|entry| source_lines[entry.line_number as usize - 1].len())
            .sum();
        assert!(retained_bytes <= MAX_LINE_BYTES * 8);
        before = result.next_before_line;
        pages.push(
            result
                .entries
                .iter()
                .map(|entry| entry.message.id.clone())
                .collect::<Vec<_>>(),
        );
        if before.is_none() {
            break;
        }
    }
    let recovered = pages.into_iter().rev().flatten().collect::<Vec<_>>();
    assert_eq!(
        recovered,
        (1..=20).map(|id| format!("m-{id}")).collect::<Vec<_>>()
    );
}
