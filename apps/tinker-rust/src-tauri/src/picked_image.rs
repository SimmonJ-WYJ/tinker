//! 用户通过原生对话框选择的图片须规范化为会话可持久化的 PNG。
use crate::desktop_runtime::protocol::{DesktopError, Result};

pub(crate) const MAX_PICKED_BYTES: usize = 8 * 1024 * 1024;

pub(crate) fn normalize_picked(bytes: &[u8], extension: &str) -> Result<Vec<u8>> {
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
            dimensions(bytes).map_err(|e| if e == too_large { e } else { invalid })?;
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
    let orientation = decoder.orientation().map_err(|_| invalid)?;
    let mut image = DynamicImage::from_decoder(decoder).map_err(|_| invalid)?;
    image.apply_orientation(orientation);
    let rgb = image.into_rgb8();

    encode_png(rgb.width(), rgb.height(), png::ColorType::Rgb, rgb.as_raw())
}

pub(crate) fn encode_png(
    width: u32,
    height: u32,
    color: png::ColorType,
    pixels: &[u8],
) -> Result<Vec<u8>> {
    use crate::formal_images::MAX_PNG;
    use std::io::Cursor;
    // 对话图片统一使用 PNG；固定大小的缓冲区限制压缩输出，避免写入半张图片。
    let mut buffer = vec![0; MAX_PNG];
    let mut output = Cursor::new(buffer.as_mut_slice());
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
    let length = output.position() as usize;
    buffer.truncate(length);
    Ok(buffer)
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
    fn png_output_limit_returns_an_error_instead_of_partial_bytes() {
        let mut bits = 0x31415926_u32;
        let pixels: Vec<u8> = (0..512 * 512 * 3)
            .map(|_| {
                bits ^= bits << 13;
                bits ^= bits >> 17;
                bits ^= bits << 5;
                bits as u8
            })
            .collect();
        assert_eq!(
            encode_png(512, 512, png::ColorType::Rgb, &pixels)
                .unwrap_err()
                .0,
            "imageTooLarge"
        );
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
