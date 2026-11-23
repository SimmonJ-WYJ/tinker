use serde_json::json;
use tinker_rust_foundation::credentialed_channels::catalog::{Catalog, EndpointPolicy};
fn args() -> Vec<serde_json::Value> {
    vec![
        json!({"channel":{"id":"one","name":"One","protocol":"openai-chat","baseUrl":"https://api.example.test/v1","enabled":true,"models":[{"modelId":"model","label":"Model"}]},"credential":{"replace":"11111111111111111111111111111111"}}),
    ]
}
#[test]
fn supported_create_commits_only_nonsecret_reference_and_unsupported_provider_is_rejected() {
    let mut c = Catalog::empty("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into()).unwrap();
    let mut invalid = args();
    invalid[0]["channel"]["protocol"] = json!("unknown-image");
    assert!(c
        .apply("channel:create", &invalid, "bad", &EndpointPolicy::Https)
        .is_err());
    assert!(c.channels.is_empty());
    c.apply(
        "channel:create",
        &args(),
        "create-one",
        &EndpointPolicy::Https,
    )
    .expect("supported create must work");
    assert_eq!(c.channels.len(), 1);
    assert_eq!(c.revisions.len(), 1);
    assert_eq!(
        c.revisions.values().next().unwrap().credential_ref,
        "11111111111111111111111111111111"
    );
    let bytes = serde_json::to_string(&c).unwrap();
    assert!(!bytes.contains("apiKey"));
    assert!(!bytes.contains("fake-secret"));
}

#[test]
fn channels_root_is_distinct_and_old_host_rejects_it() {
    use tinker_rust_foundation::formal_platform::{
        local_mock_profiles, FormalPlatform, HostEnvironment, TrustedRoot,
    };
    let path = std::env::temp_dir().canonicalize().unwrap().join(format!(
        "tinker-tauri-channels-preview-root-test-{}",
        std::process::id()
    ));
    let root = TrustedRoot::create_channels_temporary(&path)
        .expect("distinct credentialed root must open");
    assert!(TrustedRoot::open_temporary(&path).is_err());
    assert!(TrustedRoot::open_tools_temporary(&path).is_err());
    assert!(FormalPlatform::open(
        &root,
        &local_mock_profiles("http://127.0.0.1:1/v1/chat/completions").unwrap(),
        HostEnvironment::new("darwin", false, false).unwrap()
    )
    .is_err());
    std::fs::remove_dir_all(path).unwrap();
}
#[test]
fn endpoint_metadata_and_capacity_checks_are_fail_closed() {
    let p = EndpointPolicy::Https;
    for url in [
        "http://api.example.test",
        "https://user:password@api.example.test",
        "https://api.example.test?token=x",
        "https://api.example.test#key",
        "https://api.example.test/\npath",
        "https://127.0.0.1",
        "https://[::ffff:127.0.0.1]",
        "https://10.1.2.3",
    ] {
        assert!(p.normalize(url).is_err(), "{url}");
    }
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let qa = EndpointPolicy::owned_qa(&listener, "/v1").unwrap();
    let url = format!("http://{}/v1", listener.local_addr().unwrap());
    assert_eq!(qa.normalize(&url).unwrap(), url);
    assert!(qa.normalize("http://127.0.0.1:1/v1").is_err());
    assert!(qa.normalize("http://localhost/v1").is_err());
    let mut c = Catalog::empty("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into()).unwrap();
    for n in 0..16 {
        let mut a = args();
        a[0]["channel"]["id"] = json!(format!("c{n}"));
        c.apply("channel:create", &a, &format!("m{n}"), &p).unwrap();
    }
    let mut extra = args();
    extra[0]["channel"]["id"] = json!("extra");
    assert!(c.apply("channel:create", &extra, "extra", &p).is_err());
    for n in 16..128 {
        let mut update = args();
        update[0]["channel"]["id"] = json!("c0");
        update[0]["credential"] = json!("keep");
        c.apply("channel:update", &update, &format!("m{n}"), &p)
            .unwrap();
    }
    assert_eq!(c.revisions.len(), 128);
    let mut update = args();
    update[0]["channel"]["id"] = json!("c0");
    assert!(c.apply("channel:update", &update, "full", &p).is_err());
    assert_eq!(c.revisions.len(), 128);
}

#[test]
fn mixed_catalog_publishes_model_routes_and_keeps_legacy_routes_text_only() {
    let mut c = Catalog::empty("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into()).unwrap();
    let mut data = args();
    data[0]["channel"]["models"] = json!([
        {"modelId":"gpt-image-1","label":"Legacy title"},
        {"modelId":"image-alias","label":"Artwork","capability":"image","supportsImageEdits":true},
        {"modelId":"vectors","label":"Vectors","capability":"unsupported"},
        {"modelId":"dall-e-3","label":"Generate only","capability":"image","supportsImageEdits":true}
    ]);
    c.apply("channel:create", &data, "mix", &EndpointPolicy::Https)
        .unwrap();
    let models = &c.public_list()[0]["models"];
    assert_eq!(models[0]["capability"], "text");
    assert_eq!(models[1]["capability"], "image");
    assert_eq!(models[1]["supportsImageEdits"], true);
    assert_eq!(models[2]["capability"], "unsupported");
    assert_eq!(models[3]["supportsImageEdits"], false);
    assert!(c.image_revision("one", "dall-e-3", false).is_ok());
    assert_eq!(
        c.image_revision("one", "dall-e-3", true).err().unwrap().0,
        "modelCapabilityMismatch"
    );
    assert!(c.image_revision("one", "gpt-image-1", false).is_err());
}
