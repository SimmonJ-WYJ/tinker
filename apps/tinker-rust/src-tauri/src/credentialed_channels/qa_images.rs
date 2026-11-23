//! 受限的原生窗口验收图片服务。仅接受已知模型、合成 PNG 及有限操作标记。
use crate::desktop_runtime::protocol::{DesktopError, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{
    io::Write,
    net::TcpStream,
    sync::atomic::{AtomicBool, Ordering},
};

const MODEL: &str = "gpt-image-1";
pub(super) fn route(line: &str) -> Option<bool> {
    match line {
        "POST /v1/images/generations HTTP/1.1" => Some(false),
        "POST /v1/images/edits HTTP/1.1" => Some(true),
        _ => None,
    }
}
fn fixture(provider: u8, edited: bool) -> Result<Vec<u8>> {
    let (w, h) = (192, 128);
    let mut rgb = Vec::with_capacity(w * h * 3);
    for y in 0..h {
        for x in 0..w {
            let band = ((x + y) / 16 % 2) as u8;
            let palette = if provider == 1 {
                [36, 86, 132]
            } else {
                [160, 68, 34]
            };
            rgb.extend(palette.map(|v: u8| v.wrapping_add(36 * band + u8::from(edited) * 53)));
        }
    }
    crate::picked_image::encode_png(w as u32, h as u32, png::ColorType::Rgb, &rgb)
}
fn edit_prompt<'a>(headers: &str, body: &'a [u8]) -> Option<&'a str> {
    let boundary = headers
        .lines()
        .filter_map(|l| l.split_once(':'))
        .find(|(k, _)| k.eq_ignore_ascii_case("content-type"))?
        .1
        .split(';')
        .map(str::trim)
        .find_map(|v| v.strip_prefix("boundary="))?
        .trim_matches('"');
    if boundary.is_empty() || boundary.len() > 70 {
        return None;
    }
    let marker = format!("--{boundary}");
    let mut remaining = body.strip_prefix(marker.as_bytes())?;
    let mut model = None;
    let mut prompt = None;
    let mut image = None;
    while let Some(part) = remaining.strip_prefix(b"\r\n") {
        let end = part.windows(4).position(|v| v == b"\r\n\r\n")?;
        let header = std::str::from_utf8(&part[..end]).ok()?;
        let data = &part[end + 4..];
        let next = data
            .windows(marker.len())
            .position(|b| b == marker.as_bytes())?;
        let value = data[..next].strip_suffix(b"\r\n")?;
        if header.contains("name=\"model\"") {
            model = Some(value);
        }
        if header.contains("name=\"prompt\"") {
            prompt = std::str::from_utf8(value).ok();
        }
        if header.contains("name=\"image[]\"") {
            image = Some(value);
        }
        remaining = &data[next + marker.len()..];
    }
    if !remaining.starts_with(b"--") || model != Some(MODEL.as_bytes()) {
        return None;
    }
    let png = image?;
    let prompt = prompt.filter(|v| !v.trim().is_empty())?;
    // 此跨渠道验收指令必须真的携带第一个监听器的原始生成图。
    if prompt.contains(crate::qa_large_image::MARKER) {
        return (png == crate::qa_large_image::png(false)).then_some(prompt);
    }
    if prompt.contains("[qa:image-retry]") {
        return fixture(1, false).is_ok_and(|v| v == png).then_some(prompt);
    }
    let known = (1..=2).any(|p| {
        [false, true]
            .iter()
            .any(|e| fixture(p, *e).is_ok_and(|v| v == png))
    });
    if known {
        Some(prompt)
    } else {
        None
    }
}
pub(super) fn respond(
    s: &mut TcpStream,
    edit: bool,
    provider: u8,
    headers: &str,
    body: &[u8],
    first_failure: &AtomicBool,
) -> Result<&'static str> {
    let json: Value;
    let prompt = if edit {
        edit_prompt(headers, body)
    } else {
        json = serde_json::from_slice(body).unwrap_or(Value::Null);
        (json["model"] == MODEL)
            .then(|| json["prompt"].as_str())
            .flatten()
            .filter(|s| !s.trim().is_empty())
    };
    let Some(prompt) = prompt else {
        s.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")?;
        return Ok("image-invalid");
    };
    if edit && prompt.contains("[qa:image-retry]") && !first_failure.swap(true, Ordering::AcqRel) {
        s.write_all(b"HTTP/1.1 503 Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")?;
        return Ok("image-edit-failed");
    }
    let image = if prompt.contains(crate::qa_large_image::MARKER) {
        STANDARD.encode(crate::qa_large_image::png(edit))
    } else {
        STANDARD.encode(fixture(provider, edit)?)
    };
    let data = serde_json::to_vec(&json!({"data":[{"b64_json":image}]}))
        .map_err(|_| DesktopError("qaRequestInvalid"))?;
    write!(s,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",data.len())?;
    s.write_all(&data)?;
    Ok(if edit {
        "image-edited"
    } else {
        "image-generated"
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_model_rejects_unrelated_input_and_keeps_providers_visibly_distinct() {
        let first = fixture(1, false).unwrap();
        let second = fixture(2, false).unwrap();
        assert_ne!(first, second);
        assert_ne!(first, fixture(1, true).unwrap());
        let build = |image: &[u8], model: &str, text: &str| {
            let mut body = format!("--bound\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\n{model}\r\n--bound\r\nContent-Disposition: form-data; name=\"prompt\"\r\n\r\n{text}\r\n--bound\r\nContent-Disposition: form-data; name=\"image[]\"; filename=\"reference.png\"\r\nContent-Type: image/png\r\n\r\n").into_bytes();
            body.extend_from_slice(image);
            body.extend_from_slice(b"\r\n--bound--\r\n");
            body
        };
        let headers = "Content-Type: multipart/form-data; boundary=bound";
        assert_eq!(
            edit_prompt(headers, &build(&first, MODEL, "change color")),
            Some("change color")
        );
        assert_eq!(
            edit_prompt(headers, &build(&second, MODEL, "change color")),
            Some("change color")
        );
        assert_eq!(
            edit_prompt(headers, &build(&first, MODEL, "[qa:image-retry]")),
            Some("[qa:image-retry]")
        );
        assert!(edit_prompt(headers, &build(&second, MODEL, "[qa:image-retry]")).is_none());
        assert!(edit_prompt(headers, &build(b"other", MODEL, "change color")).is_none());
        assert!(edit_prompt(headers, &build(&first, "wrong-model", "change color")).is_none());
    }
}
