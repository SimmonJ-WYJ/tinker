use super::*;
use std::{
    io::{Read, Write},
    net::TcpListener,
    thread,
};
fn png() -> Vec<u8> {
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, 1, 1);
        encoder.set_color(png::ColorType::Rgb);
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(&[1, 2, 3]).unwrap();
    }
    bytes
}
#[test]
fn owned_routes_send_bound_keys_and_actual_png_multipart() {
    for (model, edit) in [
        ("gpt-image-1", false),
        ("gpt-image-1", true),
        ("dall-e-2", false),
        ("dall-e-2", true),
        ("dall-e-3", false),
        ("openai/dall-e-2", false),
        ("openai/dall-e-2", true),
        ("openai/dall-e-3", false),
    ] {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let policy = EndpointPolicy::owned_qa(&listener, "/v1").unwrap();
        let base = format!("http://{}/v1", listener.local_addr().unwrap());
        let image = if model == "gpt-image-1" && !edit {
            let mut pixels = vec![0; 1024 * 512 * 4];
            let mut seed = 19u32;
            for pixel in &mut pixels {
                seed ^= seed << 13;
                seed ^= seed >> 17;
                seed ^= seed << 5;
                *pixel = seed as u8;
            }
            let mut output = Vec::new();
            {
                let mut encoder = png::Encoder::new(&mut output, 1024, 512);
                encoder.set_color(png::ColorType::Rgba);
                encoder.set_compression(png::Compression::Fast);
                encoder
                    .write_header()
                    .unwrap()
                    .write_image_data(&pixels)
                    .unwrap();
            }
            assert!(output.len() > 512 * 1024);
            output
        } else {
            png()
        };
        let expected_png = image.clone();
        let expected_dimensions = if model == "gpt-image-1" && !edit {
            (1024, 512)
        } else {
            (1, 1)
        };
        let encoded = STANDARD.encode(&image);
        let server = thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut buf = [0; 4096];
            loop {
                let n = socket.read(&mut buf).unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&buf[..n]);
                if let Some(end) = bytes.windows(4).position(|v| v == b"\r\n\r\n") {
                    let h = String::from_utf8_lossy(&bytes[..end]);
                    let size = h
                        .lines()
                        .find_map(|v| {
                            v.to_lowercase()
                                .strip_prefix("content-length: ")
                                .map(|v| v.parse::<usize>().unwrap())
                        })
                        .unwrap();
                    if bytes.len() >= end + 4 + size {
                        break;
                    }
                }
            }
            let text = String::from_utf8_lossy(&bytes);
            assert!(text.contains("Bearer synthetic-key"));
            assert!(text.starts_with(if edit {
                "POST /v1/images/edits"
            } else {
                "POST /v1/images/generations"
            }));
            if edit {
                assert!(text.contains(
                    if model.strip_prefix("openai/").unwrap_or(model) == "dall-e-2" {
                        "name=\"image\""
                    } else {
                        "name=\"image[]\""
                    }
                ));
                assert!(bytes.windows(8).any(|w| w == b"\x89PNG\r\n\x1a\n"));
            } else {
                assert!(text.contains("\"n\":1"));
            }
            let legacy = matches!(
                model.strip_prefix("openai/").unwrap_or(model),
                "dall-e-2" | "dall-e-3"
            );
            let requested = text.contains("response_format") && text.contains("b64_json");
            if !legacy {
                assert!(!text.contains("response_format"));
            }
            let body = if legacy && !requested {
                serde_json::json!({"data":[{"url":"http://127.0.0.1:1/not-fetched"}]}).to_string()
            } else {
                serde_json::json!({"data":[{"b64_json":encoded}]}).to_string()
            };
            write!(
                socket,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .unwrap();
        });
        let p = CredentialedImageProvider::new(
            policy,
            base,
            model.into(),
            Arc::new(Secret::new(b"synthetic-key".to_vec()).unwrap()),
        );
        let (received_png, w, h) = p
            .request(
                "synthetic prompt",
                edit.then_some(("asset", image)),
                &AtomicBool::new(false),
            )
            .unwrap();
        assert_eq!((w, h), expected_dimensions);
        assert_eq!(received_png, expected_png);
        server.join().unwrap();
    }
}

#[test]
fn errors_have_only_fixed_codes_and_reflection_is_rejected() {
    for (status, expected) in [
        (401, "channelUnauthorized"),
        (402, "channelPaymentRequired"),
        (403, "channelForbidden"),
        (429, "channelRateLimited"),
        (503, "imageProviderFailed"),
        (408, "channelTimeout"),
        (504, "channelTimeout"),
        (302, "imageProviderFailed"),
        (200, "invalidImageResponse"),
    ] {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let policy = EndpointPolicy::owned_qa(&listener, "/v1").unwrap();
        let base = format!("http://{}/v1", listener.local_addr().unwrap());
        let server = thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut request = [0; 8192];
            assert!(socket.read(&mut request).unwrap() > 0);
            let body = "synthetic-key private-error-body";
            let _=write!(socket,"HTTP/1.1 {status} Synthetic\r\nLocation: http://127.0.0.1:1/never\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());
        });
        let provider = CredentialedImageProvider::new(
            policy,
            base,
            "synthetic-model".into(),
            Arc::new(Secret::new(b"synthetic-key".to_vec()).unwrap()),
        );
        assert_eq!(
            provider
                .request("synthetic prompt", None, &AtomicBool::new(false))
                .unwrap_err()
                .0,
            expected
        );
        server.join().unwrap();
    }
}
#[test]
fn cancellation_while_waiting_headers_or_body_releases_connection() {
    for (body, cancel) in [(false, true), (true, true), (false, false), (true, false)] {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let policy = EndpointPolicy::owned_qa(&listener, "/v1").unwrap();
        let base = format!("http://{}/v1", listener.local_addr().unwrap());
        let (ready, received) = std::sync::mpsc::channel();
        let server = thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut buf = [0; 8192];
            loop {
                let n = socket.read(&mut buf).unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&buf[..n]);
                if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    let h = String::from_utf8_lossy(&bytes[..end]);
                    let length = h
                        .lines()
                        .find_map(|line| {
                            line.to_lowercase()
                                .strip_prefix("content-length: ")
                                .map(|v| v.parse::<usize>().unwrap())
                        })
                        .unwrap();
                    if bytes.len() >= end + 4 + length {
                        break;
                    }
                }
            }
            if body {
                socket
                    .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 9999\r\n\r\n{\"data\":")
                    .unwrap();
            }
            ready.send(()).unwrap();
            match socket.read(&mut buf) {
                Ok(0) => (),
                Err(e)
                    if matches!(
                        e.kind(),
                        std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::BrokenPipe
                    ) => {}
                other => panic!("未释放图片连接: {other:?}"),
            }
        });
        let token = Arc::new(AtomicBool::new(false));
        let active = token.clone();
        let worker = thread::spawn(move || {
            let mut provider = CredentialedImageProvider::new(
                policy,
                base,
                "synthetic-model".into(),
                Arc::new(Secret::new(b"synthetic-key".to_vec()).unwrap()),
            );
            if !cancel {
                provider.timeout = Duration::from_millis(80);
            }
            provider.request("synthetic prompt", None, &active)
        });
        received.recv_timeout(Duration::from_secs(2)).unwrap();
        if cancel {
            token.store(true, Ordering::Release);
        }
        let start = std::time::Instant::now();
        assert_eq!(
            worker.join().unwrap().unwrap_err().0,
            if cancel {
                "imageInterrupted"
            } else {
                "channelTimeout"
            }
        );
        assert!(start.elapsed() < Duration::from_millis(500));
        server.join().unwrap();
    }
}

#[test]
fn returned_pixels_cannot_reflect_key_and_result_urls_are_not_fetched() {
    let mut reflected = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut reflected, 5, 1);
        encoder.set_color(png::ColorType::Rgb);
        let mut writer = encoder.write_header().unwrap();
        let mut pixel = b"synthetic-key".to_vec();
        pixel.resize(15, 0);
        writer.write_image_data(&pixel).unwrap();
    }
    for body in [
        serde_json::json!({"data":[{"b64_json":STANDARD.encode(reflected)}]}).to_string(),
        serde_json::json!({"data":[{"url":"http://127.0.0.1:1/never-fetch"}]}).to_string(),
    ] {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let policy = EndpointPolicy::owned_qa(&listener, "/v1").unwrap();
        let base = format!("http://{}/v1", listener.local_addr().unwrap());
        let server = thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut request = [0; 8192];
            assert!(socket.read(&mut request).unwrap() > 0);
            let _ = write!(
                socket,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
        });
        let p = CredentialedImageProvider::new(
            policy,
            base,
            "synthetic-model".into(),
            Arc::new(Secret::new(b"synthetic-key".to_vec()).unwrap()),
        );
        assert_eq!(
            p.request("synthetic prompt", None, &AtomicBool::new(false))
                .unwrap_err()
                .0,
            "invalidImageResponse"
        );
        server.join().unwrap();
    }
}

#[test]
fn dalle_three_edits_are_rejected_before_network() {
    for model in ["dall-e-3", "openai/dall-e-3"] {
        let p = CredentialedImageProvider::new(
            EndpointPolicy::Https,
            "not-a-network-endpoint".into(),
            model.into(),
            Arc::new(Secret::new(b"synthetic-key".to_vec()).unwrap()),
        );
        assert_eq!(
            p.request(
                "synthetic prompt",
                Some(("image", png())),
                &AtomicBool::new(false)
            )
            .unwrap_err()
            .0,
            "modelCapabilityMismatch"
        );
    }
}

#[test]
fn oversized_response_length_is_rejected_without_reading_body() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let policy = EndpointPolicy::owned_qa(&listener, "/v1").unwrap();
    let base = format!("http://{}/v1", listener.local_addr().unwrap());
    let server = thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        let mut buf = [0; 8192];
        assert!(socket.read(&mut buf).unwrap() > 0);
        write!(
            socket,
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            MAX_RESPONSE + 1
        )
        .unwrap();
    });
    let p = CredentialedImageProvider::new(
        policy,
        base,
        "synthetic-model".into(),
        Arc::new(Secret::new(b"synthetic-key".to_vec()).unwrap()),
    );
    assert_eq!(
        p.request("synthetic prompt", None, &AtomicBool::new(false))
            .unwrap_err()
            .0,
        "imageTooLarge"
    );
    server.join().unwrap();
}
