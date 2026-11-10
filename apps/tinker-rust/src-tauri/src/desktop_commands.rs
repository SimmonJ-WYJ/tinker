//! Tauri仅转发同一正式服务；renderer不能配置root、端点或秘密。
use crate::desktop_runtime::{DesktopReply, DesktopRuntime};
use serde_json::Value;
pub struct DesktopHostState(pub Option<DesktopRuntime>);
#[tauri::command]
pub fn desktop_runtime_request(
    request: Value,
    state: tauri::State<'_, DesktopHostState>,
) -> Result<DesktopReply, &'static str> {
    state
        .0
        .as_ref()
        .ok_or("runtimeUnavailable")?
        .dispatch(request)
        .map_err(|e| e.0)
}
