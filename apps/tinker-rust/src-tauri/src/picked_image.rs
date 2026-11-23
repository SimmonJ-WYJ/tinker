//! 用户通过原生对话框选择的图片须规范化为会话可持久化的 PNG。
use crate::desktop_runtime::protocol::{DesktopError, Result};

pub(crate) const MAX_PICKED_BYTES: usize = 8 * 1024 * 1024;

// Electron 备份预览保留原来的空间和像素上限。
pub(crate) const LEGACY_PNG_LIMIT: usize = 512 * 1024;
const LEGACY_PIXEL_LIMIT: u64 = 4_194_304;

pub(crate) fn normalize_picked(bytes: &[u8], extension: &str) -> Result<Vec<u8>> {
    normalize(bytes, extension, false)
}

pub(crate) fn normalize_legacy_preview(bytes: &[u8], extension: &str) -> Result<Vec<u8>> {
    normalize(bytes, extension, true)
}

pub(crate) fn validate_legacy_png(bytes: &[u8]) -> Result<()> {
    if bytes.len() > LEGACY_PNG_LIMIT {
        return Err(DesktopError("imageTooLarge"));
    }
    let mut decoder = png::Decoder::new(bytes);
    let info = decoder
        .read_header_info()
        .map_err(|_| DesktopError("invalidImageFile"))?;
    if u64::from(info.width) * u64::from(info.height) > LEGACY_PIXEL_LIMIT {
        return Err(DesktopError("imageTooLarge"));
    }
    crate::formal_images::dimensions(bytes)?;
    Ok(())
}

fn normalize(bytes: &[u8], extension: &str, legacy_preview: bool) -> Result<Vec<u8>> {
    use crate::formal_images::{dimensions, validate_pixel_count};
    use image::{codecs::jpeg::JpegDecoder, DynamicImage, ImageDecoder};
    use std::io::Cursor;

    let invalid = DesktopError("invalidImageFile");
    let too_large = DesktopError("imageTooLarge");
    if bytes.len() > MAX_PICKED_BYTES {
        return Err(too_large);
    }
    match extension.to_ascii_lowercase().as_str() {
        "png" => {
            if legacy_preview {
                validate_legacy_png(bytes)?;
            } else {
                dimensions(bytes).map_err(|e| if e == too_large { e } else { invalid })?;
            }
            return Ok(bytes.to_vec());
        }
        "jpg" | "jpeg" => {}
        _ => return Err(DesktopError("unsupportedImageFormat")),
    }
    if !bytes.starts_with(&[0xff, 0xd8]) || !bytes.ends_with(&[0xff, 0xd9]) {
        return Err(invalid);
    }
    let mut decoder = JpegDecoder::new(Cursor::new(bytes)).map_err(|_| invalid)?;
    let (width, height) = decoder.dimensions();
    validate_pixel_count(width, height)?;
    if legacy_preview && u64::from(width) * u64::from(height) > LEGACY_PIXEL_LIMIT {
        return Err(too_large);
    }
    let orientation = decoder.orientation().map_err(|_| invalid)?;
    let mut image = DynamicImage::from_decoder(decoder).map_err(|_| invalid)?;
    image.apply_orientation(orientation);
    let rgb = image.into_rgb8();

    if legacy_preview {
        encode_png_limited(
            rgb.width(),
            rgb.height(),
            png::ColorType::Rgb,
            rgb.as_raw(),
            LEGACY_PNG_LIMIT,
        )
    } else {
        encode_png(rgb.width(), rgb.height(), png::ColorType::Rgb, rgb.as_raw())
    }
}

pub(crate) fn encode_png(
    width: u32,
    height: u32,
    color: png::ColorType,
    pixels: &[u8],
) -> Result<Vec<u8>> {
    encode_png_limited(width, height, color, pixels, crate::formal_images::MAX_PNG)
}

struct LimitedBuffer {
    bytes: Vec<u8>,
    limit: usize,
}
impl std::io::Write for LimitedBuffer {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let next = self
            .bytes
            .len()
            .checked_add(buf.len())
            .filter(|n| *n <= self.limit)
            .ok_or_else(|| std::io::Error::other("imageTooLarge"))?;
        if next > self.bytes.capacity() {
            let capacity = self
                .bytes
                .capacity()
                .saturating_mul(2)
                .max(next)
                .min(self.limit);
            self.bytes
                .try_reserve_exact(capacity - self.bytes.len())
                .map_err(std::io::Error::other)?;
        }
        self.bytes.extend_from_slice(buf);
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn encode_png_limited(
    width: u32,
    height: u32,
    color: png::ColorType,
    pixels: &[u8],
    limit: usize,
) -> Result<Vec<u8>> {
    let mut output = LimitedBuffer {
        bytes: Vec::new(),
        limit,
    };
    let mut encoder = png::Encoder::new(&mut output, width, height);
    encoder.set_color(color);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder
        .write_header()
        .map_err(|_| DesktopError("invalidImageFile"))?;
    writer
        .write_image_data(pixels)
        .map_err(|_| DesktopError("imageTooLarge"))?;
    writer.finish().map_err(|_| DesktopError("imageTooLarge"))?;
    Ok(output.bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{codecs::jpeg::JpegEncoder, ExtendedColorType};
    use std::io::Cursor;

    fn jpeg() -> Vec<u8> {
        let mut data = Vec::new();
        JpegEncoder::new(&mut data)
            .encode(&[255, 0, 0, 255, 0, 0], 2, 1, ExtendedColorType::Rgb8)
            .unwrap();
        data
    }
    #[test]
    fn jpeg_is_converted_to_a_valid_png_and_png_pixels_remain_unchanged() {
        let jpeg = jpeg();
        let png = normalize_picked(&jpeg, "JpEg").unwrap();
        let mut reader = png::Decoder::new(Cursor::new(&png)).read_info().unwrap();
        let mut pixels = vec![0; reader.output_buffer_size()];
        let info = reader.next_frame(&mut pixels).unwrap();
        assert_eq!((info.width, info.height), (2, 1));
        assert!(pixels[0] > 240 && pixels[1] < 16 && pixels[2] < 16);
        assert_eq!(normalize_picked(&png, "png").unwrap(), png);
    }

    #[test]
    fn jpeg_orientation_is_applied_to_pixels_without_exporting_exif() {
        // 构造一个仅含方向 6（顺时针旋转 90 度）的 EXIF 段。
        let exif = b"Exif\0\0II\x2a\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0\x06\0\0\0\0\0\0\0";
        let raw = jpeg();
        let mut oriented = vec![0xff, 0xd8, 0xff, 0xe1];
        oriented.extend(((exif.len() + 2) as u16).to_be_bytes());
        oriented.extend(exif);
        oriented.extend(&raw[2..]);
        let png = normalize_picked(&oriented, "jpg").unwrap();
        assert_eq!(crate::formal_images::dimensions(&png).unwrap(), (1, 2));
        assert!(!png.windows(4).any(|s| s == b"eXIf"));
    }

    #[test]
    fn native_png_can_exceed_the_backup_preview_limit() {
        let mut bits = 0x31415926_u32;
        let pixels: Vec<u8> = (0..512 * 512 * 3)
            .map(|_| {
                bits ^= bits << 13;
                bits ^= bits >> 17;
                bits ^= bits << 5;
                bits as u8
            })
            .collect();
        let png = encode_png(512, 512, png::ColorType::Rgb, &pixels).unwrap();
        assert!(png.len() > 512 * 1024);
        assert_eq!(normalize_picked(&png, "png").unwrap(), png);
        assert_eq!(
            normalize_legacy_preview(&png, "png").unwrap_err().0,
            "imageTooLarge"
        );
        assert_eq!(
            encode_png_limited(512, 512, png::ColorType::Rgb, &pixels, 512 * 1024)
                .unwrap_err()
                .0,
            "imageTooLarge"
        );
    }

    #[test]
    fn legacy_import_keeps_its_pixel_limit_on_a_small_compressed_png() {
        let pixels = vec![0; 2049 * 2048];
        let png = encode_png(2049, 2048, png::ColorType::Grayscale, &pixels).unwrap();
        assert!(png.len() < LEGACY_PNG_LIMIT);
        assert_eq!(normalize_picked(&png, "png").unwrap(), png);
        assert_eq!(validate_legacy_png(&png).unwrap_err().0, "imageTooLarge");
    }

    #[test]
    fn tiny_picked_image_does_not_hold_an_entire_asset_budget() {
        let png = encode_png(1, 1, png::ColorType::Rgb, &[1, 2, 3]).unwrap();
        assert!(png.capacity() < 4096);
    }

    #[test]
    fn rejects_wrong_format_truncated_and_oversize_selections() {
        let jpeg = jpeg();
        assert_eq!(
            normalize_picked(&jpeg, "heic").unwrap_err().0,
            "unsupportedImageFormat"
        );
        for (data, ext) in [
            (&jpeg[..], "png"),
            (&jpeg[..jpeg.len() - 4], "jpg"),
            (b"<svg/>".as_slice(), "jpeg"),
        ] {
            assert_eq!(
                normalize_picked(data, ext).unwrap_err().0,
                "invalidImageFile"
            );
        }
        assert_eq!(
            normalize_picked(&vec![0; MAX_PICKED_BYTES + 1], "jpeg")
                .unwrap_err()
                .0,
            "imageTooLarge"
        );
    }
}
