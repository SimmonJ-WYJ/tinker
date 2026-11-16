//! 跨版本预算、历史兼容与权限绑定的合成反例。
use super::*;
use crate::run_context::ParentRunRef;
#[test]
fn tool_journal_result_complete_encoded_boundaries() {
    for fragment in ["x", "é", "\u{0001}", "\"\\\n"] {
        for call_id in ["call-0".into(), "c".repeat(64)] {
            let mut bounded = result_at_encoded_limit(
                ToolResult {
                    call_id,
                    ..result(0, ToolOutcome::Succeeded)
                },
                fragment,
            );
            assert!(bounded.content.len() <= MAX_TOOL_RESULT_BYTES);
            assert_eq!(bounded.validate(), Ok(()));
            bounded.content.push('x');
            assert_eq!(
                serde_json::to_vec(&bounded).unwrap().len(),
                MAX_TOOL_RESULT_BYTES + 1
            );
            assert_eq!(bounded.validate(), Err(RunError::ToolLimit), "{fragment:?}");
            bounded.content.pop();
            bounded.content.pop();
            assert_eq!(bounded.validate(), Ok(()));
        }
    }
    let mut raw = result(0, ToolOutcome::Succeeded);
    raw.content = "é".repeat(MAX_TOOL_RESULT_BYTES / 2 + 1);
    assert!(raw.content.len() > MAX_TOOL_RESULT_BYTES);
    assert_eq!(raw.validate(), Err(RunError::ToolLimit));
}
#[test]
fn tool_journal_context_rejects_encoded_result_overflow() {
    for fragment in ["é", "\u{0001}", "\"\\\n"] {
        let mut bounded = result_at_encoded_limit(result(0, ToolOutcome::Succeeded), fragment);
        let context = |result| ToolContext {
            messages: vec![
                TranscriptMessage::User {
                    text: "question".into(),
                },
                TranscriptMessage::Assistant {
                    round: 0,
                    text: String::new(),
                    call: Some(call(0)),
                },
                TranscriptMessage::Tool { result },
            ],
        };
        assert_eq!(context(bounded.clone()).validate(), Ok(()));
        bounded.content.push('x');
        assert_eq!(context(bounded).validate(), Err(RunError::ToolLimit));
    }
}
#[test]
fn tool_journal_load_rejects_encoded_result_overflow() {
    let t = Temp::new();
    let s = RunStore::open(&t.0).unwrap();
    let mut r = create(&s, "one", 1);
    pending(&s, &mut r, 0);
    resolve(&s, &mut r, PermissionDecision::Granted);
    add(
        &s,
        &mut r,
        ToolRecordKind::ToolStarted {
            call_id: "call-0".into(),
        },
    );
    let prefix = fs::read(t.log("one")).unwrap();
    for fragment in ["é", "\u{0001}", "\"\\\n"] {
        let bounded = result_at_encoded_limit(result(0, ToolOutcome::Succeeded), fragment);
        let mut record = ToolRecord {
            version: 1,
            run_id: "one".into(),
            sequence: r.snapshot.sequence + 1,
            event: ToolRecordKind::ToolFinished { result: bounded },
        };
        let write_record = |record: &ToolRecord| {
            let mut bytes = prefix.clone();
            let encoded = serde_json::to_vec(record).unwrap();
            assert!(encoded.len() < MAX_EVENT_BYTES);
            bytes.extend(encoded);
            bytes.push(b'\n');
            fs::write(t.log("one"), bytes).unwrap();
        };
        write_record(&record);
        assert_eq!(
            s.load_tool_run("one").unwrap().snapshot.sequence,
            record.sequence
        );
        if let ToolRecordKind::ToolFinished { result } = &mut record.event {
            result.content.push('x');
        }
        write_record(&record);
        assert_eq!(s.load_tool_run("one").unwrap_err(), RunError::CorruptLog);
    }
}
#[test]
fn tool_journal_duplicate_event_fields_are_rejected() {
    let mut accepted = Vec::new();
    let events = [
        r#"{"kind":"started"}"#,
        r#"{"kind":"roundStarted","round":0}"#,
        r#"{"kind":"textDelta","round":0,"text":"x"}"#,
        r#"{"kind":"roundFinished","round":0,"call":{"round":0,"callId":"call-0","name":"workspace_list","arguments":{"path":"a.txt"}}}"#,
        r#"{"kind":"permissionRequested","ticket":{"permissionId":"p-one-0","runId":"one","call":{"round":0,"callId":"call-0","name":"workspace_list","arguments":{"path":"a.txt"}},"workspaceRevision":"synthetic-v1","expiresAtMs":123}}"#,
        r#"{"kind":"permissionResolved","receipt":{"permissionId":"p-one-0","decision":"granted","sequence":6}}"#,
        r#"{"kind":"toolStarted","callId":"call-0"}"#,
        r#"{"kind":"toolFinished","result":{"callId":"call-0","outcome":"succeeded","content":"ok"}}"#,
        r#"{"kind":"terminated","status":"failed","errorCode":"toolFailed","closedCall":{"callId":"call-0","outcome":"failed","content":"error"}}"#,
    ];
    for event in events {
        assert!(serde_json::from_str::<ToolRecordKind>(event).is_ok());
        // 在每个字段前注入同名 null；末值保持合法，必须在规范化前拒绝。
        for (i, _) in event.match_indices("\":") {
            let start = event[..i].rfind('"').unwrap();
            let key = &event[start..i + 2];
            let duplicate = format!("{}{}null,{}", &event[..start], key, &event[start..]);
            if serde_json::from_str::<ToolRecordKind>(&duplicate).is_ok() {
                accepted.push(duplicate);
            }
        }
    }
    let duplicate_kind = r#"{"kind":"roundStarted","kind":"started"}"#;
    if serde_json::from_str::<ToolRecordKind>(duplicate_kind).is_ok() {
        accepted.push(duplicate_kind.into());
    }
    assert!(
        accepted.is_empty(),
        "accepted duplicate fields: {accepted:?}"
    );
}
#[test]
fn tool_journal_load_rejects_duplicate_record_and_binding_fields() {
    let t = Temp::new();
    let s = RunStore::open(&t.0).unwrap();
    let mut r = create(&s, "one", 1);
    pending(&s, &mut r, 0);
    resolve(&s, &mut r, PermissionDecision::Granted);
    add(
        &s,
        &mut r,
        ToolRecordKind::ToolStarted {
            call_id: "call-0".into(),
        },
    );
    add(
        &s,
        &mut r,
        ToolRecordKind::ToolFinished {
            result: result(0, ToolOutcome::Succeeded),
        },
    );
    let original = fs::read_to_string(t.log("one")).unwrap();
    let lines: Vec<_> = original.lines().collect();
    let mut accepted = Vec::new();
    for line_index in 1..lines.len() {
        let line = lines[line_index];
        for (i, _) in line.match_indices("\":") {
            let start = line[..i].rfind('"').unwrap();
            let key = &line[start..i + 2];
            let duplicate = format!("{}{}null,{}", &line[..start], key, &line[start..]);
            let mut changed = lines.clone();
            changed[line_index] = &duplicate;
            fs::write(t.log("one"), format!("{}\n", changed.join("\n"))).unwrap();
            match s.load_tool_run("one") {
                Err(error) => assert_eq!(error, RunError::CorruptLog, "{duplicate}"),
                Ok(_) => accepted.push(duplicate),
            }
        }
    }
    assert!(accepted.is_empty(), "accepted duplicate rows: {accepted:?}");
}
#[test]
fn tool_journal_cross_version_context_counts_encoded_metadata() {
    let t = Temp::new();
    let s = RunStore::open(&t.0).unwrap();
    let mut old = s
        .create("old", "old".into(), OfflineScenario::Success)
        .unwrap();
    s.append(&mut old, RunRecordKind::Started, None, None)
        .unwrap();
    for _ in 0..32 {
        s.append(&mut old, RunRecordKind::Delta, Some("x".repeat(8192)), None)
            .unwrap();
    }
    s.append(&mut old, RunRecordKind::Completed, None, None)
        .unwrap();
    let mut r = s
        .create_tool_run(ToolRunHeader {
            storage_version: 3,
            policy_version: 1,
            run_id: "child".into(),
            input: "new".into(),
            created_order: 2,
            parent: Some(ParentRunRef {
                run_id: "old".into(),
                sequence: old.snapshot.sequence,
            }),
            workspace_revision: "rev".into(),
        })
        .unwrap();
    add(&s, &mut r, ToolRecordKind::Started);
    add(&s, &mut r, ToolRecordKind::RoundStarted { round: 0 });
    for index in 0..32 {
        add(
            &s,
            &mut r,
            ToolRecordKind::TextDelta {
                round: 0,
                // 完整JSON字符串的引号也占两个字节；保留跨版本metadata溢出反例。
                text: "y".repeat(if index == 31 { 8190 } else { 8192 }),
            },
        );
    }
    add(
        &s,
        &mut r,
        ToolRecordKind::RoundFinished {
            round: 0,
            call: None,
        },
    );
    add(
        &s,
        &mut r,
        ToolRecordKind::Terminated {
            status: RunStatus::Completed,
            error_code: None,
            closed_call: None,
        },
    );
    assert_eq!(
        s.tool_context_for(
            Some(&ParentRunRef {
                run_id: "child".into(),
                sequence: r.snapshot.sequence
            }),
            3,
            "next"
        )
        .unwrap_err(),
        RunError::ContextLimitExceeded
    );
}
#[test]
fn tool_journal_cycle_and_v3_order_collision_are_rejected() {
    let t = Temp::new();
    let s = RunStore::open(&t.0).unwrap();
    let mut a = create(&s, "a", 1);
    add(&s, &mut a, ToolRecordKind::Started);
    complete(&s, &mut a, 0);
    let mut b = s
        .create_tool_run(ToolRunHeader {
            run_id: "b".into(),
            created_order: 2,
            parent: Some(ParentRunRef {
                run_id: "a".into(),
                sequence: a.snapshot.sequence,
            }),
            ..a.header.clone()
        })
        .unwrap();
    add(&s, &mut b, ToolRecordKind::Started);
    complete(&s, &mut b, 0);
    let bytes = fs::read_to_string(t.log("a")).unwrap();
    let mut lines = bytes.lines();
    let mut h: serde_json::Value = serde_json::from_str(lines.next().unwrap()).unwrap();
    h["parent"] = serde_json::json!({"runId":"b","sequence":b.snapshot.sequence});
    fs::write(
        t.log("a"),
        format!("{}\n{}\n", h, lines.collect::<Vec<_>>().join("\n")),
    )
    .unwrap();
    assert_eq!(
        s.tool_context_for(
            Some(&ParentRunRef {
                run_id: "b".into(),
                sequence: b.snapshot.sequence
            }),
            3,
            "next"
        )
        .unwrap_err(),
        RunError::CorruptLog
    );
    fs::write(t.log("a"), bytes).unwrap();
    let mut old = s
        .create("legacy", "old".into(), OfflineScenario::Success)
        .unwrap();
    assert_eq!(old.created_order, 3);
    s.append(&mut old, RunRecordKind::Started, None, None)
        .unwrap();
    let bytes = fs::read_to_string(t.log("b")).unwrap();
    let mut lines = bytes.lines();
    let mut h: serde_json::Value = serde_json::from_str(lines.next().unwrap()).unwrap();
    h["createdOrder"] = serde_json::json!(3);
    fs::write(
        t.log("b"),
        format!("{}\n{}\n", h, lines.collect::<Vec<_>>().join("\n")),
    )
    .unwrap();
    assert_eq!(s.ids().unwrap_err(), RunError::CorruptLog);
}
#[test]
fn tool_journal_permission_binding_rejects_mismatched_facts() {
    let t = Temp::new();
    let s = RunStore::open(&t.0).unwrap();
    let mut r = create(&s, "one", 1);
    add(&s, &mut r, ToolRecordKind::Started);
    add(&s, &mut r, ToolRecordKind::RoundStarted { round: 0 });
    add(
        &s,
        &mut r,
        ToolRecordKind::RoundFinished {
            round: 0,
            call: Some(call(0)),
        },
    );
    let valid = PermissionTicket {
        permission_id: "p-one-0".into(),
        run_id: "one".into(),
        call: call(0),
        workspace_revision: r.header.workspace_revision.clone(),
        expires_at_ms: 123,
    };
    for field in 0..4 {
        let mut ticket = valid.clone();
        match field {
            0 => ticket.run_id = "other".into(),
            1 => ticket.permission_id = "p-other-0".into(),
            2 => ticket.workspace_revision = "other".into(),
            _ => ticket.call.call_id = "other".into(),
        };
        let before = r.snapshot.clone();
        assert!(s
            .append_tool_record(&mut r, ToolRecordKind::PermissionRequested { ticket })
            .is_err());
        assert_eq!(r.snapshot, before);
    }
}
#[test]
fn tool_journal_provider_default_error_is_durable() {
    let t = Temp::new();
    let s = RunStore::open(&t.0).unwrap();
    let mut r = create(&s, "one", 1);
    add(&s, &mut r, ToolRecordKind::Started);
    add(
        &s,
        &mut r,
        ToolRecordKind::Terminated {
            status: RunStatus::Failed,
            error_code: Some(RunError::ContextUnsupported.code().into()),
            closed_call: None,
        },
    );
    assert_eq!(s.load_tool_run("one").unwrap().snapshot, r.snapshot);
}
#[test]
fn tool_journal_result_and_terminal_fit_at_encoded_log_boundary() {
    let t = Temp::new();
    let s = RunStore::open(&t.0).unwrap();
    let mut r = create(&s, "one", 1);
    pending(&s, &mut r, 0);
    resolve(&s, &mut r, PermissionDecision::Granted);
    let mut events = r.events.clone();
    let filler = ToolRecord {
        version: 1,
        run_id: "one".into(),
        sequence: 0,
        event: ToolRecordKind::TextDelta {
            round: 0,
            text: String::new(),
        },
    };
    events.splice(3..3, std::iter::repeat_n(filler, 260));
    for (i, e) in events.iter_mut().enumerate() {
        e.sequence = i as u64 + 1;
        if let ToolRecordKind::PermissionResolved { receipt } = &mut e.event {
            receipt.sequence = e.sequence;
        }
    }
    let started = ToolRecord {
        version: 1,
        run_id: "one".into(),
        sequence: events.len() as u64 + 1,
        event: ToolRecordKind::ToolStarted {
            call_id: "call-0".into(),
        },
    };
    let target =
        MAX_LOG_BYTES - 2 * (MAX_EVENT_BYTES + 1) - serde_json::to_vec(&started).unwrap().len() - 1;
    let mut bytes = serde_json::to_vec(&r.header).unwrap();
    bytes.push(b'\n');
    let encoded: Vec<_> = events
        .iter()
        .map(|e| serde_json::to_vec(e).unwrap())
        .collect();
    let mut padding = target - bytes.len() - encoded.iter().map(|b| b.len() + 1).sum::<usize>();
    for mut line in encoded {
        let n = padding.min(MAX_EVENT_BYTES - line.len());
        line.resize(line.len() + n, b' ');
        padding -= n;
        bytes.extend(line);
        bytes.push(b'\n');
    }
    assert_eq!(padding, 0);
    assert_eq!(bytes.len(), target);
    fs::write(t.log("one"), bytes).unwrap();
    let mut r = s.load_tool_run("one").unwrap();
    add(&s, &mut r, started.event);
    let result = result_at_encoded_limit(result(0, ToolOutcome::Succeeded), "\u{0001}");
    add(&s, &mut r, ToolRecordKind::ToolFinished { result });
    add(
        &s,
        &mut r,
        ToolRecordKind::Terminated {
            status: RunStatus::Failed,
            error_code: Some("toolLimit".into()),
            closed_call: None,
        },
    );
    assert!(r.log_bytes <= MAX_LOG_BYTES);
}
