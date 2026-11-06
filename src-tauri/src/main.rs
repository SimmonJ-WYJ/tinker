use std::sync::Mutex;
use tinker_core::Session;
#[derive(serde::Serialize)]
struct Snapshot {
    draft: String,
    messages: Vec<String>,
}
#[tauri::command]
fn session(
    action: String,
    value: String,
    state: tauri::State<'_, Mutex<Session>>,
) -> Result<Snapshot, String> {
    let mut s = state.lock().map_err(|_| "会话不可用")?;
    match action.as_str() {
        "select" => s.select(&value).map_err(str::to_string)?,
        "edit" => s.edit(&value),
        "send" => s.send().map_err(str::to_string)?,
        "read" => (),
        _ => return Err("未知操作".into()),
    }
    Ok(Snapshot {
        draft: s.draft().into(),
        messages: s.messages().to_vec(),
    })
}
#[tauri::command]
fn save_secret(channel: String, secret: String) -> Result<(), String> {
    if !["local", "compatible"].contains(&channel.as_str()) {
        return Err("无效渠道".into());
    }
    if secret.trim().is_empty() || secret.len() > 8192 {
        return Err("密钥为空或过长".into());
    }
    #[cfg(target_os = "macos")]
    {
        security_framework::passwords::set_generic_password(
            "dev.tinker.foundation",
            &channel,
            secret.as_bytes(),
        )
        .map_err(|_| "系统钥匙串保存失败".to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("此平台尚未接入安全存储".into())
    }
}
fn main() {
    tauri::Builder::default()
        .manage(Mutex::new(Session::default()))
        .invoke_handler(tauri::generate_handler![session, save_secret])
        .run(tauri::generate_context!())
        .expect("Tinker could not start");
}
