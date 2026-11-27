//! 本机路由账本仅追加。首次新接纳前固定旧前缀，供恢复会话识别此后本机接纳的任务。
use super::*;

const FILE: &str = "local-routed-boundary-v1.json";
const MAX_BYTES: usize = 256;

#[derive(Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Boundary {
    count: usize,
    digest: String,
}

impl Boundary {
    fn for_prefix(session: &str, entries: &[routes::RoutedEntry]) -> Self {
        let ids: Vec<_> = entries.iter().map(|e| e.turn.request_id.as_str()).collect();
        let bytes = serde_json::to_vec(&(session, &ids)).expect("字符串元组可序列化");
        Self {
            count: ids.len(),
            digest: digest(&bytes),
        }
    }
}

// 仅从本机接纳路径调用。归档、分叉、同请求重放均不创建此文件。
pub(super) fn record_boundary(dir: &Path, session: &str, entries: &[routes::RoutedEntry]) {
    if dir
        .join(FILE)
        .symlink_metadata()
        .is_err_and(|e| e.kind() == std::io::ErrorKind::NotFound)
    {
        let record = Boundary::for_prefix(session, entries);
        let bytes = serde_json::to_vec(&record).expect("边界元数据可序列化");
        // 写入失败只影响恢复会话的修订资格；下次接纳可以从更保守的新边界开始。
        let _ = disk::atomic_write(dir, FILE, &bytes, MAX_BYTES);
    }
}

pub(super) fn mark_local_suffix(dir: &Path, session: &str, entries: &mut [routes::RoutedEntry]) {
    let Ok(bytes) = crate::formal_platform::store::read_regular(&dir.join(FILE), MAX_BYTES) else {
        return;
    };
    let Ok(boundary) = serde_json::from_slice::<Boundary>(&bytes) else {
        return;
    };
    let Some(prefix) = entries.get(..boundary.count) else {
        return;
    };
    if boundary == Boundary::for_prefix(session, prefix) {
        for entry in &mut entries[boundary.count..] {
            entry.turn.admitted_locally = true;
        }
    }
}
