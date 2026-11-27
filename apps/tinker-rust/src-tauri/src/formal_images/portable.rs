//! 仅随会话携带受收据索引管理的原图与版本；不枚举附件目录或导出缩略图缓存。
use super::*;
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PortableImages {
    original: Vec<ImageTurn>,
    derived: Vec<ImageTurn>,
    imports: Vec<ImportedImage>,
    routed: routes::RoutedReceipts,
    #[serde(deserialize_with = "read_pngs")]
    pngs: BTreeMap<String, String>,
}

// 在读入归档映射时拒绝重复键；覆盖同名项会掩盖损坏或歧义。
fn read_pngs<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<BTreeMap<String, String>, D::Error> {
    struct Entries;
    impl<'de> serde::de::Visitor<'de> for Entries {
        type Value = BTreeMap<String, String>;
        fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str("unique managed PNG entries")
        }
        fn visit_map<A: serde::de::MapAccess<'de>>(
            self,
            mut map: A,
        ) -> std::result::Result<Self::Value, A::Error> {
            let mut out = BTreeMap::new();
            while let Some(name) = map.next_key::<String>()? {
                let id = name
                    .strip_suffix(".png")
                    .and_then(|s| s.strip_prefix("img-").or_else(|| s.strip_prefix("ref-")));
                if out.len() >= 4 * LIMIT
                    || out.contains_key(&name)
                    || !id.is_some_and(|id| {
                        id.len() == 32
                            && id
                                .bytes()
                                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                    })
                {
                    return Err(serde::de::Error::custom("invalid managed PNG entry"));
                }
                let contents = map.next_value::<String>()?;
                if contents.len() > MAX_PNG.div_ceil(3) * 4 {
                    return Err(serde::de::Error::custom("managed PNG too large"));
                }
                out.insert(name, contents);
            }
            Ok(out)
        }
    }
    deserializer.deserialize_map(Entries)
}

impl PortableImages {
    // 目标会话号碰撞时，图片 ID 也必须按新会话重算。输入文件名始终由旧收据推导。
    pub(crate) fn remap_session(&mut self, old: &str, new: &str) -> Result<()> {
        id(old)?;
        id(new)?;
        let mut ids = BTreeMap::new();
        for a in &self.imports {
            let before = imports::reference_id(
                old,
                &a.display_name,
                &a.content_sha256,
                a.history_source.as_ref(),
            );
            let after = imports::reference_id(
                new,
                &a.display_name,
                &a.content_sha256,
                a.history_source.as_ref(),
            );
            if a.id != before
                || a.filename != format!("{before}.png")
                || ids.insert(before, after).is_some()
            {
                return Err(DesktopError("corruptImages"));
            }
        }
        for t in self
            .original
            .iter()
            .chain(&self.derived)
            .chain(self.routed.entries.iter().map(|e| &e.turn))
        {
            if let Some(a) = &t.asset {
                let before = image_id(old, &t.request_id);
                if a.id != before
                    || a.filename != format!("{before}.png")
                    || ids.insert(before, image_id(new, &t.request_id)).is_some()
                {
                    return Err(DesktopError("corruptImages"));
                }
            }
        }
        let mut pngs = BTreeMap::new();
        for (from, to) in &ids {
            let png = self
                .pngs
                .remove(&format!("{from}.png"))
                .ok_or(DesktopError("corruptImages"))?;
            if pngs.insert(format!("{to}.png"), png).is_some() {
                return Err(DesktopError("corruptImages"));
            }
        }
        if !self.pngs.is_empty() {
            return Err(DesktopError("corruptImages"));
        }
        self.pngs = pngs;
        let update = |value: &mut String| -> Result<()> {
            *value = ids.get(value).ok_or(DesktopError("corruptImages"))?.clone();
            Ok(())
        };
        for a in &mut self.imports {
            update(&mut a.id)?;
            a.filename = format!("{}.png", a.id);
        }
        for t in self
            .original
            .iter_mut()
            .chain(&mut self.derived)
            .chain(self.routed.entries.iter_mut().map(|e| &mut e.turn))
        {
            if let Some(id) = &mut t.base_image_id {
                update(id)?;
            }
            if let Some(a) = &mut t.asset {
                update(&mut a.id)?;
                a.filename = format!("{}.png", a.id);
                if let Some(id) = &mut a.base_image_id {
                    update(id)?;
                }
                for id in &mut a.reference_ids {
                    update(id)?;
                }
            }
        }
        Ok(())
    }

    pub(crate) fn image_count(&self) -> usize {
        self.pngs.len()
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.original.is_empty()
            && self.derived.is_empty()
            && self.imports.is_empty()
            && self.routed.entries.is_empty()
            && self.pngs.is_empty()
    }
}

fn assets(images: &SessionImages) -> impl Iterator<Item = (&str, &str, u32, u32)> {
    images
        .turns()
        .filter_map(|t| t.asset.as_ref())
        .map(|a| {
            (
                a.filename.as_str(),
                a.content_sha256.as_str(),
                a.width,
                a.height,
            )
        })
        .chain(images.imports.iter().map(|a| {
            (
                a.filename.as_str(),
                a.content_sha256.as_str(),
                a.width,
                a.height,
            )
        }))
}

impl ImageStore {
    pub(crate) fn export_portable(
        &self,
        session: &str,
        remaining: &mut usize,
    ) -> Result<PortableImages> {
        let dir = self.session(session)?;
        let active = self.guard()?;
        if active.requests.iter().any(|(s, _)| s == session) {
            return Err(DesktopError("backupTaskActive"));
        }
        let images = SessionImages::open(&dir, session)?;
        Self::collect_portable(&dir, images, remaining)
    }

    fn collect_portable(
        dir: &Path,
        images: SessionImages,
        remaining: &mut usize,
    ) -> Result<PortableImages> {
        let mut pngs = BTreeMap::new();
        for (name, hash, width, height) in assets(&images) {
            let bytes = disk::png(dir, name, hash)?;
            let encoded =
                base64::encoded_len(bytes.len(), true).ok_or(DesktopError("storageLimit"))?;
            *remaining = remaining
                .checked_sub(encoded)
                .ok_or(DesktopError("storageLimit"))?;
            if dimensions(&bytes)? != (width, height) {
                return Err(DesktopError("corruptImages"));
            }
            pngs.insert(name.to_owned(), STANDARD.encode(bytes));
        }
        Ok(PortableImages {
            original: images.original,
            derived: images.derived,
            imports: images.imports,
            routed: images.routed,
            pngs,
        })
    }

    // 先在仅供当前恢复使用的临时会话目录重建并验证索引，再按验证得到的文件名还原原图。
    pub(crate) fn stage_portable(&self, session: &str, data: &PortableImages) -> Result<()> {
        let dir = self.session(session)?;
        let _guard = self.guard()?;
        Self::write_portable(&dir, session, data)
    }

    fn write_portable(dir: &Path, session: &str, data: &PortableImages) -> Result<()> {
        if data.routed.version != 1 {
            return Err(DesktopError("unsupportedVersion"));
        }
        if data.is_empty() {
            return Ok(());
        }
        if [
            data.original.len(),
            data.derived.len(),
            data.imports.len(),
            data.routed.entries.len(),
        ]
        .into_iter()
        .any(|n| n > LIMIT)
            || data.pngs.len() > 4 * LIMIT
        {
            return Err(DesktopError("imageLimit"));
        }
        match dir.symlink_metadata() {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Ok(_) => return Err(DesktopError("storeChanged")),
            Err(e) => return Err(e.into()),
        }
        disk::private_dir(dir)?;
        if !data.original.is_empty() {
            disk::save_turns(dir, &data.original, false)?;
        }
        if !data.derived.is_empty() {
            disk::save_turns(dir, &data.derived, true)?;
        }
        if !data.imports.is_empty() {
            let index =
                serde_json::to_vec(&serde_json::json!({"version":1,"imports":data.imports}))
                    .map_err(|_| DesktopError("storeIo"))?;
            disk::write_index(dir, "imports.json", &index)?;
        }
        if !data.routed.entries.is_empty() {
            data.routed.save(dir)?;
        }
        let images = SessionImages::open(dir, session)?;
        if assets(&images).count() != data.pngs.len() {
            return Err(DesktopError("corruptImages"));
        }
        let mut total = 0u64;
        for (name, hash, width, height) in assets(&images) {
            let encoded = data.pngs.get(name).ok_or(DesktopError("corruptImages"))?;
            if encoded.len() > MAX_PNG.div_ceil(3) * 4 {
                return Err(DesktopError("imageStorageLimit"));
            }
            let bytes = STANDARD
                .decode(encoded)
                .map_err(|_| DesktopError("corruptImages"))?;
            total += bytes.len() as u64;
            if total > disk::SESSION_ASSET_BYTES {
                return Err(DesktopError("imageStorageLimit"));
            }
            if digest(&bytes) != hash || dimensions(&bytes)? != (width, height) {
                return Err(DesktopError("corruptImages"));
            }
            disk::put(dir, name, &bytes)?;
        }
        Ok(())
    }
}

#[path = "fork_assets.rs"]
mod fork_assets;
