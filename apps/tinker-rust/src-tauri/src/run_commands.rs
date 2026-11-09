//! Rust Lab IPC：只接请求ID/文本/固定场景；可信宿主注入执行器，文件IO离开WebView线程。
use crate::{
    run_controller::RunController,
    run_provider::{OfflineFixture, RunProvider},
    run_types::{OfflineScenario, RunError, RunEventPage, RunSnapshot},
};
use std::{path::Path, sync::Arc};

pub struct RunHostState {
    controller: Result<Arc<RunController>, &'static str>,
    provider: Option<Arc<dyn RunProvider>>,
}
impl RunHostState {
    pub fn new(root: impl AsRef<Path>) -> Self {
        Self {
            controller: RunController::open(root).map(Arc::new).map_err(code),
            provider: None,
        }
    }
    // 仅供受信任的Rust宿主注入；IPC参数不能选择实现。
    pub fn with_provider(root: impl AsRef<Path>, provider: Arc<dyn RunProvider>) -> Self {
        Self {
            controller: RunController::open(root).map(Arc::new).map_err(code),
            provider: Some(provider),
        }
    }
    /// 可信宿主显式构造网络配置；前端不能选择端点、模型或凭据。
    pub fn with_chat_http(
        root: impl AsRef<Path>,
        config: crate::chat_http::ChatHttpConfig,
    ) -> Self {
        Self::with_provider(
            root,
            Arc::new(crate::chat_http::ChatHttpProvider::new(config)),
        )
    }
    pub fn unavailable() -> Self {
        Self {
            controller: Err("runUnavailable"),
            provider: None,
        }
    }
    fn controller(&self) -> Result<Arc<RunController>, &'static str> {
        self.controller
            .as_ref()
            .map(Arc::clone)
            .map_err(|error| *error)
    }
}
fn code(error: RunError) -> &'static str {
    match error {
        RunError::InvalidRunId
        | RunError::InvalidScenario
        | RunError::InvalidCursor
        | RunError::InvalidLimit => "runInvalidOptions",
        other => other.code(),
    }
}
#[tauri::command]
pub async fn start_lab_run(
    request_id: String,
    input: String,
    scenario: String,
    state: tauri::State<'_, RunHostState>,
) -> Result<RunSnapshot, &'static str> {
    let scenario: OfflineScenario = scenario.parse().map_err(code)?;
    if input.trim().is_empty() {
        return Err("emptyInput");
    }
    let controller = state.controller()?;
    let provider = state
        .provider
        .clone()
        .unwrap_or_else(|| Arc::new(OfflineFixture::new(scenario)));
    tauri::async_runtime::spawn_blocking(move || {
        controller
            .start_with_provider(request_id, input, scenario, provider)
            .map_err(code)
    })
    .await
    .map_err(|_| "runUnavailable")?
}
#[tauri::command]
pub async fn cancel_lab_run(
    run_id: String,
    state: tauri::State<'_, RunHostState>,
) -> Result<RunSnapshot, &'static str> {
    let controller = state.controller()?;
    tauri::async_runtime::spawn_blocking(move || controller.cancel(&run_id).map_err(code))
        .await
        .map_err(|_| "runUnavailable")?
}
#[tauri::command]
pub async fn read_lab_run(
    run_id: Option<String>,
    after_sequence: Option<u64>,
    limit: Option<usize>,
    state: tauri::State<'_, RunHostState>,
) -> Result<RunEventPage, &'static str> {
    let after = after_sequence.unwrap_or(0);
    if after > 9_007_199_254_740_991 {
        return Err("runInvalidOptions");
    }
    let controller = state.controller()?;
    tauri::async_runtime::spawn_blocking(move || {
        controller
            .read(run_id.as_deref(), after, limit.unwrap_or(64))
            .map_err(code)
    })
    .await
    .map_err(|_| "runUnavailable")?
}
