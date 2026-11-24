//! 仅此入口显式授权合成工具，配置身份在创建宿主前检查。
fn main() {
    #[cfg(target_os = "macos")]
    tinker_rust_foundation::formal_documents::dispatch_worker();
    tinker_rust_foundation::formal_launch::run_tools(
        tauri::generate_context!("tauri.tools.conf.json"),
        "com.tinker.tools-preview",
        None,
    );
}
