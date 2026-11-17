//! 链快照有界分帧；投递期间保留不可变阶段，完整提交后才能替换。
use crate::desktop_runtime::protocol::{DesktopError, Result};
use serde_json::{json, Value};
pub fn frames(snapshot: &Value) -> Result<Vec<Value>> {
    let size = serde_json::to_vec(snapshot)
        .map_err(|_| DesktopError("invalidReply"))?
        .len();
    if size > 16 * 1024 * 1024 {
        return Err(DesktopError("historyLimit"));
    }
    if size <= 4 * 1024 * 1024 - 1024 {
        return Ok(vec![snapshot.clone()]);
    }
    let event = &snapshot["payload"]["event"];
    let groups = event["executions"]
        .as_array()
        .ok_or(DesktopError("invalidReply"))?;
    if groups.len() > 128 {
        return Err(DesktopError("historyLimit"));
    }
    let count = groups.len() + 1;
    let id = json!([
        event["chainId"],
        event["revision"],
        snapshot["snapshotSequence"]
    ])
    .to_string();
    let mut metadata = event.clone();
    metadata["executions"] = json!([]);
    let mut frames = Vec::new();
    let mut bytes = 0;
    for index in 0..count {
        let part = json!({"type":"native_chain_snapshot_part","snapshotId":id,"index":index,"count":count,"executions":groups.get(index).map(|g|vec![g.clone()]).unwrap_or_default(),"final":if index+1==count {metadata.clone()} else {Value::Null}});
        let mut frame = json!({"sessionId":snapshot["sessionId"],"requestId":snapshot["requestId"],"startedAt":snapshot["startedAt"],"snapshotSequence":snapshot["snapshotSequence"]});
        frame["payload"] = json!({"kind":"asci_event","event":part});
        let size = serde_json::to_vec(&frame)
            .map_err(|_| DesktopError("invalidReply"))?
            .len();
        bytes += size;
        if size > 4 * 1024 * 1024 - 1024 || bytes > 16 * 1024 * 1024 {
            return Err(DesktopError("historyLimit"));
        }
        frames.push(frame);
    }
    Ok(frames)
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn unicode_snapshot_is_staged_with_four_mib_frames_and_sixteen_mib_total() {
        let group =
            json!({"runId":"r","snapshot":{"sdkMessages":[{"text":"你好🌱".repeat(350_000)}]}});
        let snapshot = json!({"sessionId":"s","requestId":"a","payload":{"kind":"asci_event","event":{"type":"native_chain_snapshot","chainId":"a","revision":2,"executions":[group.clone(),group]}}});
        let frames = frames(&snapshot).unwrap();
        assert!(frames.len() > 1);
        assert!(frames
            .iter()
            .all(|f| serde_json::to_vec(f).unwrap().len() <= 4 * 1024 * 1024));
        let huge = json!({"sessionId":"s","requestId":"a","payload":{"kind":"asci_event","event":{"executions":[{"text":"🌱".repeat(4_200_000)}]}}});
        assert_eq!(super::frames(&huge).unwrap_err().0, "historyLimit");
    }
}
