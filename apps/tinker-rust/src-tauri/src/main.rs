#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::sync::Mutex;
use tauri::Manager;
use tinker_rust_foundation::{
    persistent_workspace::{AppError, PersistentWorkspace, Snapshot},
    session_store::StoreError,
};
type AppState = Mutex<Result<PersistentWorkspace, AppError>>;
fn with_workspace<T>(
    state: tauri::State<'_, AppState>,
    action: impl FnOnce(&mut PersistentWorkspace) -> Result<T, AppError>,
) -> Result<T, &'static str> {
    let mut guard = state.lock().map_err(|_| "stateUnavailable")?;
    let workspace = guard.as_mut().map_err(|error| error.code())?;
    action(workspace).map_err(AppError::code)
}
#[tauri::command]
fn snapshot(state: tauri::State<'_, AppState>) -> Result<Snapshot, &'static str> {
    with_workspace(state, |workspace| workspace.snapshot())
}
#[tauri::command]
fn save_draft(input: String, state: tauri::State<'_, AppState>) -> Result<(), &'static str> {
    with_workspace(state, |workspace| workspace.save(input))
}
#[tauri::command]
fn submit_draft(input: String, state: tauri::State<'_, AppState>) -> Result<(), &'static str> {
    with_workspace(state, |workspace| workspace.submit(input))
}
#[tauri::command]
fn recover_draft(
    expected_revision: u32,
    state: tauri::State<'_, AppState>,
) -> Result<(), &'static str> {
    with_workspace(state, |workspace| workspace.recover(expected_revision))
}
fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // 仅使用 Rust Lab 自身目录，禁止扫描或迁移 Electron 的真实数据。
            let workspace = app
                .path()
                .app_local_data_dir()
                .map_err(|_| AppError::Storage(StoreError::Io))
                .and_then(|path| PersistentWorkspace::open(path.join("session-store-v1")));
            app.manage(Mutex::new(workspace));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            snapshot,
            save_draft,
            submit_draft,
            recover_draft
        ])
        .run(tauri::generate_context!())
        .expect("Tinker Rust 启动失败");
}
