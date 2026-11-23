//! 两个隔离原生 QA 的确定性纹理图；尺寸、工作量和字节由本地固定参数决定。
use std::sync::OnceLock;

pub(crate) const MARKER: &str = "[qa:large-image]";
pub(crate) fn png(edited: bool) -> &'static [u8] {
    static SOURCE: OnceLock<Vec<u8>> = OnceLock::new();
    static RESULT: OnceLock<Vec<u8>> = OnceLock::new();
    (if edited { &RESULT } else { &SOURCE }).get_or_init(|| {
        let (w, h) = (1536usize, 1024usize);
        let mut noise = 0x72ac_1045u32;
        let mut rgb = Vec::with_capacity(w * h * 3);
        for y in 0..h {
            for x in 0..w {
                noise ^= noise << 13;
                noise ^= noise >> 17;
                noise ^= noise << 5;
                let stripe = ((x / 96 + y / 128) % 2) as u8 * 38;
                let r = 22 + (noise as u8 & 31) + stripe;
                let g = 65 + ((noise >> 8) as u8 & 31) + stripe;
                let b = 143 + ((noise >> 16) as u8 & 15) + stripe;
                rgb.extend(if edited { [b, g, r] } else { [r, g, b] });
            }
        }
        let mut output = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut output, w as u32, h as u32);
            encoder.set_color(png::ColorType::Rgb);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().expect("固定 QA PNG 头");
            writer.write_image_data(&rgb).expect("固定 QA PNG 像素");
            writer.finish().expect("固定 QA PNG 结束");
        }
        output
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fixture_exercises_multi_megabyte_originals_and_is_stable() {
        assert!((1024 * 1024..4 * 1024 * 1024).contains(&png(false).len()));
        assert_ne!(png(false), png(true));
        assert_eq!(&png(false)[16..24], &[0, 0, 6, 0, 0, 0, 4, 0]);
    }
}
