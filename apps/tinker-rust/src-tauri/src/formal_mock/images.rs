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
    match op {
        Operation::Generate if reference.is_none() => {
            let mut pixels = vec![0; WIDTH * HEIGHT * 3];
            for (index, pixel) in pixels.chunks_exact_mut(3).enumerate() {
                let (x, y) = (index % WIDTH, index / WIDTH);
                let band = ((x + y * 2) / 40) % 3;
                pixel.copy_from_slice(&color[band * 3..band * 3 + 3]);
            }
            crate::picked_image::encode_png(
                WIDTH as u32,
                HEIGHT as u32,
                png::ColorType::Rgb,
                &pixels,
            )
            .ok()
        }
        Operation::Edit => {
            let source = reference?;
            source["id"].as_str().filter(|id| !id.is_empty())?;
            let bytes = STANDARD.decode(source["b64_json"].as_str()?).ok()?;
            if bytes.len() > crate::formal_images::MAX_PNG {
                return None;
            }
            let mut decoder = png::Decoder::new(Cursor::new(bytes));
            decoder.set_ignore_text_chunk(true);
            decoder.set_ignore_iccp_chunk(true);
            decoder.set_limits(png::Limits {
                bytes: 32 * 1024 * 1024,
            });
            decoder.set_transformations(png::Transformations::normalize_to_color8());
            let mut reader = decoder.read_info().ok()?;
            let source = reader.info();
            crate::formal_images::validate_pixel_count(source.width, source.height).ok()?;
            if source.animation_control.is_some() {
                return None;
            }
            let mut pixels = vec![0; reader.output_buffer_size()];
            let info = reader.next_frame(&mut pixels).ok()?;
            reader.finish().ok()?;
            // 只改变颜色分量，保留灰度或 RGB 图像原有的透明度。
            let colors = match info.color_type {
                png::ColorType::Grayscale | png::ColorType::GrayscaleAlpha => 1,
                png::ColorType::Rgb | png::ColorType::Rgba => 3,
                png::ColorType::Indexed => return None,
            };
            for pixel in pixels.chunks_exact_mut(info.color_type.samples()) {
                for c in 0..colors {
                    pixel[c] = pixel[c].wrapping_add(color[c] / 2 + 32);
                }
            }
            crate::picked_image::encode_png(info.width, info.height, info.color_type, &pixels).ok()
        }
        _ => None,
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edits_imported_png_dimensions_and_preserves_alpha() {
        let mut source = Vec::new();
        {
            let mut enc = png::Encoder::new(&mut source, 2, 1);
            enc.set_color(png::ColorType::GrayscaleAlpha);
            enc.set_depth(png::BitDepth::Eight);
            enc.write_header()
                .unwrap()
                .write_image_data(&[40, 0, 90, 157])
                .unwrap();
        }
        let reference = json!({"id":"selected","b64_json":STANDARD.encode(&source)});
        let out = render(Operation::Edit, Some(&reference), "tint").unwrap();
        let mut reader = png::Decoder::new(out.as_slice()).read_info().unwrap();
        let mut buf = vec![0; reader.output_buffer_size()];
        let info = reader.next_frame(&mut buf).unwrap();
        assert_eq!((info.width, info.height), (2, 1));
        assert_eq!(info.color_type, png::ColorType::GrayscaleAlpha);
        assert_eq!((buf[1], buf[3]), (0, 157));
        assert_ne!(buf[0], 40);
    }
}
