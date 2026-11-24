//! 独立渠道宿主；helper先于窗口初始化处理。
fn main() {
    #[cfg(target_os = "macos")]
    tinker_rust_foundation::formal_documents::dispatch_worker();
    if tinker_rust_foundation::credentialed_channels::process::dispatch() {
        return;
    }
    tinker_rust_foundation::formal_launch::run_channels(
        tauri::generate_context!("tauri.channels.conf.json"),
        false,
    );
}
