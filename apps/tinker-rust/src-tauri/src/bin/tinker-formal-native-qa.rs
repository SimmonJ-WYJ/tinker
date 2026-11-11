//! 仅合成原生验收使用，禁止作为用户交付包。
fn main() {
    tinker_rust_foundation::formal_launch::run(
        tauri::generate_context!("tauri.qa.conf.json"),
        "com.tinker.formal-native-qa",
        Some(tinker_rust_foundation::formal_native_qa::start),
    );
}
