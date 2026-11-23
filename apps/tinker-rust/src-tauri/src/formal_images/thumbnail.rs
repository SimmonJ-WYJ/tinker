//! 缩略图可安全重建；引用编辑和导出只能使用原图。
use super::*;
use crate::formal_platform::store::{directory, read_regular, regular};
use std::{fs::Metadata, io::ErrorKind};

const EDGE: u32 = 256;
pub(crate) const MAX_THUMBNAIL_BYTES: usize = 512 * 1024;
const TAG_BYTES: usize = 32;

fn cache_key(source_hash: &str, source: &Metadata) -> Sha256 {
    #[cfg(unix)]
    use std::os::unix::fs::MetadataExt;
    let mut key = Sha256::new();
    key.update(b"tinker-thumbnail-v1");
    key.update(source_hash.as_bytes());
    key.update(source.len().to_le_bytes());
    #[cfg(unix)]
    for value in [
        source.dev(),
        source.ino(),
        source.ctime() as u64,
        source.ctime_nsec() as u64,
        source.mtime() as u64,
        source.mtime_nsec() as u64,
    ] {
        key.update(value.to_le_bytes());
    }
    key
}
fn cache_checksum(mut key: Sha256, png: &[u8]) -> [u8; TAG_BYTES] {
    key.update(png);
    key.finalize().into()
}

impl ImageFile {
    pub(crate) fn read_thumbnail(&self) -> Result<Vec<u8>> {
        // 串行处理缓存未命中，限制解码峰值；任务仍可停止或受理。
        let _worker = self
            .store
            .0
            .thumbnail_worker
            .lock()
            .map_err(|_| DesktopError("storeIo"))?;
        directory(&self.dir, true)?;
        let source = self.dir.join(&self.filename);
        let key = cache_key(self.sha256(), &regular(&source, MAX_PNG)?);
        let name = format!("{}.thumbnail-v1", self.filename);
        let cache = self.dir.join(&name);
        match cache.symlink_metadata() {
            Ok(_) => {
                // 拒绝不安全的链接或所有者；截断或超限的私有缓存重新生成，避免读取其全部内容。
                if regular(&cache, usize::MAX)?.len() <= (MAX_THUMBNAIL_BYTES + TAG_BYTES) as u64 {
                    let bytes = read_regular(&cache, MAX_THUMBNAIL_BYTES + TAG_BYTES)?;
                    if let Some((tag, png)) = bytes.split_at_checked(TAG_BYTES) {
                        if tag == cache_checksum(key.clone(), png) && valid_cached_thumbnail(png) {
                            return Ok(png.to_vec());
                        }
                    }
                }
            }
            Err(e) if e.kind() == ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
        // 生成缩略图前核验已提交原图的摘要。
        let png = make_thumbnail(&self.read_bytes()?)?;
        let mut packet = Vec::with_capacity(TAG_BYTES + png.len());
        packet.extend_from_slice(&cache_checksum(key, &png));
        packet.extend_from_slice(&png);
        let guard = self.store.guard()?;
        let reserved = guard.reserved_bytes(&self.session);
        // 额度已满时仍可显示缩略图，跳过缓存。
        match disk::asset_budget(&self.dir, packet.len() + reserved) {
            Ok(()) => {
                match disk::atomic_write(&self.dir, &name, &packet, MAX_THUMBNAIL_BYTES + TAG_BYTES)
                {
                    Ok(()) | Err(DesktopError("storeIo" | "storageLimit")) => (),
                    Err(e) => return Err(e),
                }
            }
            Err(DesktopError("imageStorageLimit")) => (),
            Err(e) => return Err(e),
        }
        Ok(png)
    }
}

fn valid_cached_thumbnail(png: &[u8]) -> bool {
    let Some(header) = png.get(16..24) else {
        return false;
    };
    // 先限制缓存图片尺寸，再校验像素。
    header
        .chunks_exact(4)
        .all(|v| (1..=EDGE).contains(&u32::from_be_bytes([v[0], v[1], v[2], v[3]])))
        && dimensions(png).is_ok()
}

fn make_thumbnail(original: &[u8]) -> Result<Vec<u8>> {
    let invalid = DesktopError("corruptImage");
    let mut decoder = png::Decoder::new(original);
    decoder.set_limits(png::Limits {
        bytes: 48 * 1024 * 1024,
    });
    decoder.set_ignore_text_chunk(true);
    decoder.set_ignore_iccp_chunk(true);
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder.read_info().map_err(|_| invalid)?;
    let (width, height) = reader.info().size();
    validate_pixel_count(width, height)?;
    let mut frame = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut frame).map_err(|_| invalid)?;
    if info.width != width || info.height != height || info.bit_depth != png::BitDepth::Eight {
        return Err(invalid);
    }
    let longest = width.max(height);
    let dims = |length: u32| ((length * EDGE.min(longest) + longest / 2) / longest).max(1);
    let (w, h) = (dims(width), dims(height));
    // 按源图颜色通道缩放，保留灰度和透明度，避免额外分配整幅 RGBA。
    macro_rules! resize {
        ($color:ty) => {{
            let source =
                image::ImageBuffer::<$color, _>::from_raw(width, height, frame).ok_or(invalid)?;
            image::imageops::thumbnail(&source, w, h).into_raw()
        }};
    }
    let small = match info.color_type {
        png::ColorType::Rgb => resize!(image::Rgb<u8>),
        png::ColorType::Rgba => resize!(image::Rgba<u8>),
        png::ColorType::Grayscale => resize!(image::Luma<u8>),
        png::ColorType::GrayscaleAlpha => resize!(image::LumaA<u8>),
        png::ColorType::Indexed => return Err(invalid),
    };
    let mut png = Vec::new();
    let mut enc = png::Encoder::new(&mut png, w, h);
    enc.set_color(info.color_type);
    enc.set_depth(png::BitDepth::Eight);
    enc.write_header()
        .map_err(|_| invalid)?
        .write_image_data(&small)
        .map_err(|_| invalid)?;
    if png.len() > MAX_THUMBNAIL_BYTES {
        return Err(DesktopError("imageTooLarge"));
    }
    Ok(png)
}
