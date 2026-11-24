//! 仅 owned 合成工具原生验收，禁止作为用户交付包。
fn main() {
    #[cfg(target_os = "macos")]
    tinker_rust_foundation::formal_documents::dispatch_worker();
    tinker_rust_foundation::formal_launch::run_tools_qa(
        tauri::generate_context!("tauri.tools-qa.conf.json"),
        tinker_rust_foundation::formal_native_qa::hooks(),
    );
}
