use super::*;
fn make_png(w: u32, h: u32, noise: bool) -> Vec<u8> {
    let mut pixels = vec![0; (w as usize) * (h as usize) * 4];
    let mut seed = 19u32;
    if noise {
        for p in &mut pixels {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            *p = seed as u8;
        }
    }
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, w, h);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_compression(png::Compression::Fast);
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(&pixels).unwrap();
    }
    bytes
}
#[test]
fn png_larger_than_old_limit_is_accepted_unchanged() {
    let bytes = make_png(1024, 512, true);
    assert!(bytes.len() > 512 * 1024 && bytes.len() < 8 * 1024 * 1024);
    assert_eq!(dimensions(&bytes).unwrap(), (1024, 512));
}
#[test]
fn six_megapixel_rgba_is_bounded_but_supported() {
    let bytes = make_png(3072, 2048, false);
    assert_eq!(dimensions(&bytes).unwrap(), (3072, 2048));
}
#[test]
fn malformed_and_size_limits_are_rejected() {
    let bytes = make_png(2, 2, false);
    assert!(dimensions(&bytes[..bytes.len() - 1]).is_err());
    let mut corrupt = bytes.clone();
    corrupt[45] ^= 1;
    assert!(dimensions(&corrupt).is_err());
    assert!(dimensions(&vec![0; 8 * 1024 * 1024 + 1]).is_err());
    assert!(validate_pixel_count(4097, 1).is_err());
    assert!(validate_pixel_count(4096, 4096).is_err());
}

#[test]
fn legacy_metadata_stays_readable_but_new_provider_admission_rejects_it() {
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, 1, 1);
        encoder.set_color(png::ColorType::Rgb);
        encoder
            .add_text_chunk("note".into(), "synthetic-secret".into())
            .unwrap();
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(&[1, 2, 3]).unwrap();
    }
    assert_eq!(dimensions(&bytes).unwrap(), (1, 1));
    assert!(vendor_dimensions(&bytes, &AtomicBool::new(false), b"synthetic-secret").is_err());
}
#[test]
fn vendor_validation_accepts_color_variants_and_preserves_bytes() {
    for (color, depth, pixels) in [
        (png::ColorType::Grayscale, png::BitDepth::One, vec![0]),
        (png::ColorType::Rgb, png::BitDepth::Sixteen, vec![0; 6]),
        (png::ColorType::Rgba, png::BitDepth::Sixteen, vec![0; 8]),
        (png::ColorType::Indexed, png::BitDepth::Eight, vec![0]),
    ] {
        let mut bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut bytes, 1, 1);
            encoder.set_color(color);
            encoder.set_depth(depth);
            if color == png::ColorType::Indexed {
                encoder.set_palette(vec![1, 2, 3]);
                encoder.set_trns(vec![255]);
            }
            let mut writer = encoder.write_header().unwrap();
            writer.write_image_data(&pixels).unwrap();
        }
        let original = bytes.clone();
        assert_eq!(
            vendor_dimensions(&bytes, &AtomicBool::new(false), b"synthetic-secret").unwrap(),
            (1, 1)
        );
        assert_eq!(bytes, original);
    }
}
#[test]
fn vendor_validation_honors_cancel_and_decoded_pixel_secret() {
    let bytes = make_png(3, 1, false);
    let token = AtomicBool::new(true);
    assert_eq!(
        vendor_dimensions(&bytes, &token, b"synthetic-secret")
            .unwrap_err()
            .0,
        "imageInterrupted"
    );
    let mut image = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut image, 4, 1);
        encoder.set_color(png::ColorType::Rgb);
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(b"secret-bytes").unwrap();
    }
    assert!(vendor_dimensions(&image, &AtomicBool::new(false), b"secret-bytes").is_err());
}

#[test]
fn small_and_large_metadata_is_removed_without_reencoding_idat() {
    for (w, h, noise) in [(2, 2, false), (1024, 512, true)] {
        let original = make_png(w, h, noise);
        let payload = b"note\0synthetic-metadata-marker";
        let mut chunk = Vec::new();
        chunk.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        chunk.extend_from_slice(b"tEXt");
        chunk.extend_from_slice(payload);
        let mut crc = !0u32;
        for &b in &chunk[4..] {
            crc ^= u32::from(b);
            for _ in 0..8 {
                crc = if crc & 1 != 0 {
                    (crc >> 1) ^ 0xedb88320
                } else {
                    crc >> 1
                };
            }
        }
        chunk.extend_from_slice(&(!crc).to_be_bytes());
        let mut with_metadata = original[..original.len() - 12].to_vec();
        with_metadata.extend_from_slice(&chunk);
        with_metadata.extend_from_slice(&original[original.len() - 12..]);
        let (clean, cw, ch) = vendor_png(
            with_metadata.clone(),
            &AtomicBool::new(false),
            b"bound-secret",
        )
        .unwrap();
        assert_eq!((cw, ch), (w, h));
        assert_eq!(clean, original);
        assert!(vendor_png(
            with_metadata.clone(),
            &AtomicBool::new(false),
            b"synthetic-metadata-marker"
        )
        .is_err());
        let at = with_metadata.len() - 16;
        with_metadata[at] ^= 1;
        assert!(vendor_png(
            with_metadata.clone(),
            &AtomicBool::new(false),
            b"bound-secret"
        )
        .is_err());
    }
}
