//! 正式预览入口；QA 控制器不在此包的默认 feature 中。
fn main() {
    #[cfg(target_os = "macos")]
    tinker_rust_foundation::formal_documents::dispatch_worker();
    tinker_rust_foundation::formal_launch::run(
        tauri::generate_context!("tauri.formal.conf.json"),
        "com.tinker.formal-preview",
        None,
    );
}
