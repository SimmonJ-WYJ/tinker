#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HostHealth {
    protocol_version: u32,
    host: &'static str,
    architecture: &'static str,
    model_execution: bool,
    shell_execution: bool,
}
#[tauri::command]
fn host_health() -> HostHealth {
    HostHealth { protocol_version: 1, host: "tauri-rust", architecture: std::env::consts::ARCH, model_execution: false, shell_execution: false }
}
fn main() {
    tauri::Builder::default().invoke_handler(tauri::generate_handler![host_health])
        .run(tauri::generate_context!()).expect("原生宿主启动失败");
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn prototype_reports_no_model_or_shell_execution() {
        let health = host_health();
        assert_eq!(health.protocol_version, 1);
        assert!(!health.model_execution);
        assert!(!health.shell_execution);
    }
}
