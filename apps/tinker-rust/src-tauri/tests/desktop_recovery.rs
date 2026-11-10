use serde_json::{json, Value};
use std::fs;
use tinker_rust_foundation::desktop_runtime::DesktopRuntime;
#[path = "support/desktop.rs"]
mod support;
use std::path::PathBuf;
use support::*;
#[test]
fn rejected_recovery_never_modifies_earlier_or_mismatched_runs() {
    fn tree(root: &std::path::Path) -> Vec<(PathBuf, Vec<u8>)> {
        let mut all = Vec::new();
        for entry in fs::read_dir(root).unwrap() {
            let p = entry.unwrap().path();
            if p.is_dir() {
                all.push((p.clone(), Vec::new()));
                all.extend(tree(&p));
            } else {
                all.push((p.clone(), fs::read(p).unwrap()));
            }
        }
        all.sort();
        all
    }
    for damage in ["mismatch", "future", "corrupt", "missing"] {
        let f = Fixture::new();
        let r = DesktopRuntime::open(&f.0, profiles()).unwrap();
        for n in 1..=2 {
            create(&r, false);
            let mut request = send_params(&format!("session-{n}"));
            request["requestId"] = json!(format!("r{n}"));
            call(&r, "chat.send", request);
        }
        drop(r);
        for n in 1..=2 {
            let path =
                f.0.join(format!("desktop-runtime-v1/session-{n}/runs-v1/r{n}.jsonl"));
            let text = fs::read_to_string(&path).unwrap();
            let lines: Vec<_> = text.lines().take(2).collect();
            fs::write(path, format!("{}\n", lines.join("\n"))).unwrap();
        }
        let path = f.0.join(if damage == "mismatch" {
            "desktop-runtime-v1/session-1/runs-v1/r1.jsonl"
        } else {
            "desktop-runtime-v1/session-2/runs-v1/r2.jsonl"
        });
        let text = fs::read_to_string(&path).unwrap();
        fs::write(
            &path,
            match damage {
                "mismatch" => text.replace("hello", "changed"),
                "future" => text.replace("\"protocolVersion\":1", "\"protocolVersion\":2"),
                "corrupt" => text + "{bad}\n",
                _ => text,
            },
        )
        .unwrap();
        if damage == "missing" {
            fs::remove_dir_all(f.0.join("desktop-runtime-v1/session-2/runs-v1/context-v2"))
                .unwrap();
        }
        let before = tree(&f.0);
        assert!(DesktopRuntime::open(&f.0, profiles()).is_err());
        assert!(tree(&f.0) == before, "{damage}失败恢复修改了完整session树");
    }
}
#[test]
fn history_exact_serialized_limit_includes_final_false() {
    for extra in [0usize, 1] {
        let f = Fixture::new();
        let r = DesktopRuntime::open(&f.0, profiles()).unwrap();
        let s = create(&r, false)["result"].clone();
        drop(r);
        let path = f.0.join("desktop-runtime-v1/journal.jsonl");
        let first = fs::read_to_string(&path).unwrap();
        let mut records = Vec::new();
        for n in 0..32 {
            let mut request = send_params("session-1");
            request["requestId"] = json!(format!("boundary-{n}"));
            request["userMessage"] = json!("x".repeat(63000));
            records.push(json!({"version":1,"sequence":n+2,"entry":{"kind":"bind","binding":{"request":request,"configRevision":"r1","acceptedAt":s["updatedAt"].as_u64().unwrap()+n+1,"parentRunId":null}}}));
        }
        let write = |records: &Vec<Value>| {
            fs::write(
                &path,
                first.clone() + &records.iter().map(|v| format!("{v}\n")).collect::<String>(),
            )
            .unwrap();
        };
        write(&records);
        let r = DesktopRuntime::open(&f.0, profiles()).unwrap();
        let page = call(
            &r,
            "sessions.history",
            json!({"sessionId":"session-1","after":0,"limit":128}),
        )["result"]
            .clone();
        assert_eq!(page["turns"].as_array().unwrap().len(), 32);
        let mut gap = 2 * 1024 * 1024 + extra - serde_json::to_vec(&page).unwrap().len();
        drop(r);
        for record in &mut records {
            let text = &mut record["entry"]["binding"]["request"]["userMessage"];
            let add = gap.min(65536 - 63000);
            *text = json!("x".repeat(63000 + add));
            gap -= add;
        }
        assert_eq!(gap, 0);
        write(&records);
        let r = DesktopRuntime::open(&f.0, profiles()).unwrap();
        let result = call(
            &r,
            "sessions.history",
            json!({"sessionId":"session-1","after":0,"limit":128}),
        )["result"]
            .clone();
        assert!(serde_json::to_vec(&result).unwrap().len() <= 2 * 1024 * 1024);
        assert_eq!(result["hasMore"], json!(extra == 1));
    }
}
#[test]
fn nonexistent_host_root_is_rejected_without_creating_ancestors() {
    let f = Fixture::new();
    let missing = f.0.join("missing/nested");
    assert!(DesktopRuntime::open(&missing, profiles()).is_err());
    assert!(!f.0.join("missing").exists());
}
