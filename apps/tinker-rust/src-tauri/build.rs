fn main() {
    if std::env::var_os("CARGO_FEATURE_FORMAL_PREVIEW").is_some() {
        let file = if std::env::var_os("CARGO_FEATURE_FORMAL_NATIVE_QA").is_some() {
            "tauri.qa.conf.json"
        } else {
            "tauri.formal.conf.json"
        };
        let config = std::fs::read_to_string(file).expect("正式配置");
        std::env::set_var("TAURI_CONFIG", config);
    }
    tauri_build::build()
}
