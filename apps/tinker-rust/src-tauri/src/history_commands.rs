//! 历史 IPC 只接收会话 ID 与游标，解析离开 UI 线程，错误不包含内容或绝对路径。
use crate::{
    history_library::HistoryLibrary, sdk_history::SDKHistoryPage, session_history::HistoryOptions,
};
use std::path::Path;

pub struct HistoryState(pub Option<HistoryLibrary>);
impl HistoryState {
    pub fn new(root: impl AsRef<Path>) -> Self {
        Self(Some(HistoryLibrary::new(root)))
    }
    pub fn unavailable() -> Self {
        Self(None)
    }
}

#[tauri::command]
pub async fn read_session_history(
    session_id: String,
    before_line: Option<u64>,
    limit: Option<usize>,
    state: tauri::State<'_, HistoryState>,
) -> Result<SDKHistoryPage, &'static str> {
    let library = state.0.as_ref().ok_or("historyUnavailable")?.clone();
    tauri::async_runtime::spawn_blocking(move || {
        library
            .read(
                &session_id,
                HistoryOptions {
                    limit: limit.unwrap_or(64),
                    before_line,
                },
            )
            .map_err(|error| error.code())
    })
    .await
    .map_err(|_| "historyUnavailable")?
}
