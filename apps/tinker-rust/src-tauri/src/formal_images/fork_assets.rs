//! 分叉只读取截点内已完成收据指向的 PNG 和实际使用过的参考原图。
use super::*;
use std::{collections::BTreeSet, fs};

impl ImageStore {
    pub(crate) fn fork_assets(
        &self,
        source: &str,
        target: &str,
        selected: &BTreeSet<String>,
    ) -> Result<()> {
        self.stage_fork(source, target, selected, None)
    }

    pub(crate) fn fork_revision_assets(
        &self,
        source: &str,
        target: &str,
        selected: &BTreeSet<String>,
        edit: &RevisionImageEdit,
    ) -> Result<()> {
        self.stage_fork(source, target, selected, Some(edit))
    }

    fn stage_fork(
        &self,
        source: &str,
        target: &str,
        selected: &BTreeSet<String>,
        revision: Option<&RevisionImageEdit>,
    ) -> Result<()> {
        if source == target {
            return Err(DesktopError("forkUnsupported"));
        }
        let from = self.session(source)?;
        let to = self.session(target)?;
        let _guard = self.guard()?;
        let images = SessionImages::open(&from, source)?;
        if let Some(edit) = revision {
            if images.revision_edit(source, &edit.request_id, edit.session_is_local)? != *edit {
                return Err(DesktopError("forkUnsupported"));
            }
        }
        let (history, mut imports) = images.into_history();
        let mut entries = Vec::new();
        let mut references = BTreeSet::new();
        if let Some(edit) = revision {
            references.insert(edit.input_id.clone());
        }
        for turn in history
            .into_iter()
            .take_while(|t| revision.is_none_or(|edit| t.request_id != edit.request_id))
            .filter(|t| selected.contains(&t.request_id))
        {
            let asset = turn
                .asset
                .as_ref()
                .filter(|_| turn.status == ImageStatus::Succeeded)
                .ok_or(DesktopError("forkUnsupported"))?;
            references.extend(turn.base_image_id.iter().cloned());
            // 包括早期无路由收据的图片。只保留展示归属；对分支中新提交的任务，旧图片总是历史。
            let route = ImageRoute {
                channel_id: asset.channel_id.clone(),
                model_id: asset.model.clone(),
                revision: revision::FORK_HISTORY_REVISION.into(),
                protocol: ImageProtocol::OpenaiImages,
                action: if turn.base_image_id.is_some() {
                    ImageAction::Edit
                } else {
                    ImageAction::Generate
                },
            };
            entries.push(routes::RoutedEntry {
                turn,
                route,
                retry_of: None,
                text_head: None,
                original: 0,
                derived: 0,
            });
        }
        if entries.len() != selected.len() {
            return Err(DesktopError("forkUnsupported"));
        }
        if entries.len() > LIMIT {
            return Err(DesktopError("imageLimit"));
        }
        imports.retain(|a| references.contains(&a.id));
        let images = SessionImages {
            original: vec![],
            derived: vec![],
            imports,
            routed: routes::RoutedReceipts {
                version: 1,
                entries,
            },
        };
        if revision.is_some_and(|edit| !images.sources().any(|(id, ..)| id == edit.input_id)) {
            return Err(DesktopError("forkUnsupported"));
        }
        let mut data = collect_fork(&from, images)?;
        data.remap_session(source, target)?;
        if to.try_exists()? {
            // 目录安装后、会话提交前若退出，必须逐一验证已落盘的索引和原图。
            let existing = collect_fork(&to, SessionImages::open(&to, target)?)?;
            crate::portable_project::same(&existing, &data)?;
            crate::formal_platform::store::sync_dir(&to)?;
            return crate::formal_platform::store::sync_dir(&self.0.dir);
        }
        if data.is_empty() {
            return Ok(());
        }
        let stage = to.with_extension("fork-stage");
        if stage.try_exists()? {
            crate::formal_platform::store::directory(&stage, true)?;
            fs::remove_dir_all(&stage)?;
        }
        Self::write_portable(&stage, target, &data)?;
        crate::portable_project::install_directory(&stage, &to)
    }
}

fn collect_fork(dir: &Path, images: SessionImages) -> Result<PortableImages> {
    // 压缩体积不足以约束解码成本。最多检验 64 百万像素，同时沿用可移植文件字节上限。
    assets(&images).try_fold(64_000_000u64, |remaining, (_, _, w, h)| {
        remaining
            .checked_sub(u64::from(w) * u64::from(h))
            .ok_or(DesktopError("imageStorageLimit"))
    })?;
    let mut budget = crate::portable_project::MAX_ARCHIVE_BYTES;
    ImageStore::collect_portable(dir, images, &mut budget)
}
