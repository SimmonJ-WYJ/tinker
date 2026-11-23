//! 仅合成预览使用的图片提供方。编辑解码随请求发送的原图并逐像素着色。
use super::{RequestMetadata, MAX_REQUESTS};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    io::{self, Cursor, Write},
    net::TcpStream,
    sync::Mutex,
};

pub(super) const MAX_BODY: usize = 704 * 1024;
const WIDTH: usize = 192;
const HEIGHT: usize = 128;

#[derive(Clone, Copy)]
pub(super) enum Operation {
    Generate,
    Edit,
}
pub(super) fn operation(request_line: &str) -> Option<Operation> {
    match request_line {
        "POST /v1/images/generations HTTP/1.1" => Some(Operation::Generate),
        "POST /v1/images/edits HTTP/1.1" => Some(Operation::Edit),
        _ => None,
    }
}

fn render(op: Operation, reference: Option<&Value>, prompt: &str) -> Option<Vec<u8>> {
    let color = Sha256::digest(prompt.as_bytes());
    let mut pixels = vec![0; WIDTH * HEIGHT * 3];
    match op {
        Operation::Generate if reference.is_none() => {
            for (index, pixel) in pixels.chunks_exact_mut(3).enumerate() {
                let (x, y) = (index % WIDTH, index / WIDTH);
                let band = ((x + y * 2) / 40) % 3;
                pixel.copy_from_slice(&color[band * 3..band * 3 + 3]);
            }
        }
        Operation::Edit => {
            let source = reference?;
            source["id"].as_str().filter(|id| !id.is_empty())?;
            let bytes = STANDARD.decode(source["b64_json"].as_str()?).ok()?;
            let mut decoder = png::Decoder::new(Cursor::new(bytes));
            decoder.set_ignore_text_chunk(true);
            decoder.set_ignore_iccp_chunk(true);
            decoder.set_limits(png::Limits {
                bytes: 2 * 1024 * 1024,
            });
            let mut reader = decoder.read_info().ok()?;
            let info = reader.info();
            // 此提供方只编辑自身输出的 RGB 预览；分配上限固定。
            if info.width != WIDTH as u32
                || info.height != HEIGHT as u32
                || info.color_type != png::ColorType::Rgb
                || info.bit_depth != png::BitDepth::Eight
            {
                return None;
            }
            reader.next_frame(&mut pixels).ok()?;
            reader.finish().ok()?;
            for pixel in pixels.chunks_exact_mut(3) {
                for c in 0..3 {
                    pixel[c] = pixel[c].wrapping_add(color[c] / 2 + 32);
                }
            }
        }
        _ => return None,
    }
    let mut bytes = Vec::new();
    let mut encoder = png::Encoder::new(&mut bytes, WIDTH as u32, HEIGHT as u32);
    encoder.set_color(png::ColorType::Rgb);
    encoder.set_depth(png::BitDepth::Eight);
    {
        let mut writer = encoder.write_header().ok()?;
        writer.write_image_data(&pixels).ok()?;
        writer.finish().ok()?;
    }
    Some(bytes)
}

pub(super) fn respond(
    stream: &mut TcpStream,
    op: Operation,
    body: &Value,
    records: &Mutex<Vec<RequestMetadata>>,
) -> io::Result<()> {
    let invalid = b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
    let Some(prompt) = body["prompt"]
        .as_str()
        .filter(|p| !p.trim().is_empty() && p.len() <= 8192)
    else {
        return stream.write_all(invalid);
    };
    if body["model"] != "local-image" || body["n"] != 1 || body["response_format"] != "b64_json" {
        return stream.write_all(invalid);
    }
    let failed = prompt.contains("[image-error]");
    let bytes = if failed {
        None
    } else {
        let Some(bytes) = render(op, body.get("referenceImage"), prompt) else {
            return stream.write_all(invalid);
        };
        Some(bytes)
    };
    let scenario = match (op, failed) {
        (Operation::Generate, false) => "image-generate",
        (Operation::Edit, false) => "image-edit",
        (Operation::Generate, true) => "image-generate-failed",
        (Operation::Edit, true) => "image-edit-failed",
    };
    if let Ok(mut log) = records.lock() {
        if log.len() < MAX_REQUESTS {
            log.push(RequestMetadata {
                model: "local-image".into(),
                effort: None,
                user_messages: 0,
                assistant_messages: 0,
                scenario: scenario.into(),
            });
        }
    }
    if prompt.contains("[image-slow]") {
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
    let Some(bytes) = bytes else {
        return stream.write_all(
            b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        );
    };
    let payload = json!({"data":[{"b64_json":STANDARD.encode(bytes)}]}).to_string();
    write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{payload}",payload.len())
}
