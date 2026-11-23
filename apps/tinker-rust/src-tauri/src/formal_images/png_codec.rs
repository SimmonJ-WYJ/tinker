//! 文件/像素/内存及chunk预算独立；逐行解码可取消，安全供应商PNG不改写。
use super::{validate_pixel_count, MAX_PNG};
use crate::desktop_runtime::protocol::{DesktopError, Result};
use std::{
    io::{Cursor, Read},
    sync::atomic::{AtomicBool, Ordering},
};
fn check(token: Option<&AtomicBool>) -> Result<()> {
    if token.is_some_and(|t| t.load(Ordering::Acquire)) {
        Err(DesktopError("imageInterrupted"))
    } else {
        Ok(())
    }
}
struct Cancellable<'a> {
    cursor: Cursor<&'a [u8]>,
    token: Option<&'a AtomicBool>,
}
impl Read for Cancellable<'_> {
    fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
        if self.token.is_some_and(|t| t.load(Ordering::Acquire)) {
            return Err(std::io::Error::other("imageInterrupted"));
        }
        let size = out.len().min(8192);
        self.cursor.read(&mut out[..size])
    }
}
pub(super) fn secret_present(
    bytes: impl Iterator<Item = u8>,
    key: &[u8],
    token: Option<&AtomicBool>,
) -> Result<bool> {
    if key.is_empty() {
        return Ok(false);
    }
    let mut table = vec![0; key.len()];
    let mut j = 0;
    for i in 1..key.len() {
        while j > 0 && key[i] != key[j] {
            j = table[j - 1];
        }
        if key[i] == key[j] {
            j += 1;
        }
        table[i] = j;
    }
    let mut j = 0;
    for (i, byte) in bytes.enumerate() {
        if i % 8192 == 0 {
            check(token)?;
        }
        while j > 0 && byte != key[j] {
            j = table[j - 1];
        }
        if byte == key[j] {
            j += 1;
        }
        if j == key.len() {
            return Ok(true);
        }
    }
    Ok(false)
}
pub(super) fn validate(
    bytes: &[u8],
    token: Option<&AtomicBool>,
    key: Option<&[u8]>,
    strict: bool,
) -> Result<(u32, u32)> {
    check(token)?;
    let invalid = DesktopError("invalidImageResponse");
    if bytes.len() > MAX_PNG {
        return Err(DesktopError("imageTooLarge"));
    }
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err(invalid);
    }
    let mut offset = 8usize;
    let mut count = 0;
    let mut ended = false;
    while offset < bytes.len() {
        check(token)?;
        count += 1;
        if count > 16384 || bytes.len() - offset < 12 {
            return Err(invalid);
        }
        let length =
            u32::from_be_bytes(bytes[offset..offset + 4].try_into().map_err(|_| invalid)?) as usize;
        let end = offset
            .checked_add(12)
            .and_then(|n| n.checked_add(length))
            .filter(|&n| n <= bytes.len())
            .ok_or(invalid)?;
        let kind = &bytes[offset + 4..offset + 8];
        if strict
            && !matches!(
                kind,
                b"IHDR"
                    | b"PLTE"
                    | b"tRNS"
                    | b"IDAT"
                    | b"IEND"
                    | b"sRGB"
                    | b"gAMA"
                    | b"cHRM"
                    | b"pHYs"
            )
        {
            return Err(invalid);
        }
        if kind == b"IEND" {
            if length != 0 || end != bytes.len() {
                return Err(invalid);
            }
            ended = true;
        }
        offset = end;
    }
    if !ended {
        return Err(invalid);
    }
    if let Some(key) = key {
        if secret_present(bytes.iter().copied(), key, token)? {
            return Err(invalid);
        }
    }
    let decode_error = |_| {
        if token.is_some_and(|t| t.load(Ordering::Acquire)) {
            DesktopError("imageInterrupted")
        } else {
            invalid
        }
    };
    let mut decoder = png::Decoder::new(Cancellable {
        cursor: Cursor::new(bytes),
        token,
    });
    decoder.set_limits(png::Limits {
        bytes: 72 * 1024 * 1024,
    });
    decoder.set_ignore_text_chunk(true);
    decoder.set_ignore_iccp_chunk(true);
    decoder.set_transformations(png::Transformations::EXPAND);
    let mut reader = decoder.read_info().map_err(decode_error)?;
    let (w, h) = (reader.info().width, reader.info().height);
    validate_pixel_count(w, h)?;
    if reader.info().animation_control.is_some() || w == 0 || h == 0 {
        return Err(invalid);
    }
    let size = reader.output_buffer_size();
    if size > 64 * 1024 * 1024 {
        return Err(DesktopError("imageTooLarge"));
    }
    // 本地图片仅做完整性检查，消耗解码行即可，无需额外保留整幅像素。
    let mut pixels = key.map(|_| vec![0; size]);
    let stride = reader.output_line_size(w);
    let (color, depth) = reader.output_color_type();
    if reader.info().interlaced {
        let bits = color.samples() as u8 * depth as u8;
        while let Some(row) = reader.next_interlaced_row().map_err(decode_error)? {
            check(token)?;
            let png::InterlaceInfo::Adam7(info) = row.interlace() else {
                return Err(invalid);
            };
            if let Some(frame) = &mut pixels {
                png::expand_interlaced_row(frame, stride, row.data(), info, bits);
            }
        }
    } else {
        let mut rows = 0;
        while let Some(row) = reader.next_row().map_err(decode_error)? {
            check(token)?;
            if row.data().len() != stride || rows >= h as usize {
                return Err(invalid);
            }
            if let Some(frame) = &mut pixels {
                frame[rows * stride..(rows + 1) * stride].copy_from_slice(row.data());
            }
            rows += 1;
        }
        if rows != h as usize {
            return Err(invalid);
        }
    }
    reader.finish().map_err(decode_error)?;
    check(token)?;
    if let (Some(pixels), Some(key)) = (pixels, key) {
        if secret_present(pixels.iter().copied(), key, token)?
            || (depth == png::BitDepth::Sixteen
                && secret_present(pixels.iter().step_by(2).copied(), key, token)?)
        {
            return Err(invalid);
        }
    }
    Ok((w, h))
}

// 只剥离不参与像素的辅助块；IDAT/调色/位深与受支持色彩信息保持原字节。
// 被剥离的压缩文本/ICC从不解压，CRC仍对原始所有块验证。
pub(super) fn prepare(
    mut bytes: Vec<u8>,
    token: &AtomicBool,
    key: &[u8],
) -> Result<(Vec<u8>, u32, u32)> {
    let invalid = DesktopError("invalidImageResponse");
    check(Some(token))?;
    if bytes.len() > MAX_PNG {
        return Err(DesktopError("imageTooLarge"));
    }
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err(invalid);
    }
    if secret_present(bytes.iter().copied(), key, Some(token))? {
        return Err(invalid);
    }
    let mut table = [0u32; 256];
    for (i, value) in table.iter_mut().enumerate() {
        let mut crc = i as u32;
        for _ in 0..8 {
            crc = if crc & 1 != 0 {
                0xedb88320 ^ (crc >> 1)
            } else {
                crc >> 1
            };
        }
        *value = crc;
    }
    let mut written = 8;
    let mut offset = 8;
    let mut count = 0;
    while offset < bytes.len() {
        check(Some(token))?;
        count += 1;
        if count > 16384 || bytes.len() - offset < 12 {
            return Err(invalid);
        }
        let len =
            u32::from_be_bytes(bytes[offset..offset + 4].try_into().map_err(|_| invalid)?) as usize;
        let end = offset
            .checked_add(12)
            .and_then(|v| v.checked_add(len))
            .filter(|&n| n <= bytes.len())
            .ok_or(invalid)?;
        let kind = &bytes[offset + 4..offset + 8];
        if !kind.iter().all(u8::is_ascii_alphabetic) || !kind[2].is_ascii_uppercase() {
            return Err(invalid);
        }
        let mut crc = !0u32;
        for (i, &byte) in bytes[offset + 4..end - 4].iter().enumerate() {
            if i % 8192 == 0 {
                check(Some(token))?;
            }
            crc = table[((crc ^ u32::from(byte)) & 255) as usize] ^ (crc >> 8);
        }
        if !crc != u32::from_be_bytes(bytes[end - 4..end].try_into().map_err(|_| invalid)?) {
            return Err(invalid);
        }
        if matches!(kind, b"acTL" | b"fcTL" | b"fdAT") {
            return Err(invalid);
        }
        let keep = matches!(
            kind,
            b"IHDR" | b"PLTE" | b"tRNS" | b"IDAT" | b"IEND" | b"sRGB" | b"gAMA" | b"cHRM" | b"pHYs"
        );
        if !keep && !kind[0].is_ascii_lowercase() {
            return Err(invalid);
        }
        if kind == b"IEND" && (len != 0 || end != bytes.len()) {
            return Err(invalid);
        }
        if keep {
            if written != offset {
                bytes.copy_within(offset..end, written);
            }
            written += end - offset;
        }
        offset = end;
    }
    bytes.truncate(written);
    let (w, h) = validate(&bytes, Some(token), Some(key), true)?;
    Ok((bytes, w, h))
}
