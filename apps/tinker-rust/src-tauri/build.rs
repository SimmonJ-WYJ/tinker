fn main() {
    if std::env::var_os("CARGO_FEATURE_FORMAL_PREVIEW").is_some() {
        let config = std::fs::read_to_string("tauri.formal.conf.json").expect("正式配置");
        std::env::set_var("TAURI_CONFIG", config);
    }
    tauri_build::build()
}
