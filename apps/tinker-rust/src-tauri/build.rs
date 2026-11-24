fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let source = "src/formal_documents/pdfkit.m";
        println!("cargo:rerun-if-changed={source}");
        cc::Build::new()
            .file(source)
            .flag("-fobjc-arc")
            .compile("tinker_pdfkit");
        println!("cargo:rustc-link-lib=framework=PDFKit");
        println!("cargo:rustc-link-lib=framework=Foundation");
    }
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
