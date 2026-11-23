//! 仅 QA feature 和独立 QA 窗口使用。不从 renderer 接收文件名或路径。
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Choice {
    CancelOpen,
    CancelSave,
    Image,
    Invalid,
    Oversized,
    Destination,
}

static NEXT: Mutex<Option<Choice>> = Mutex::new(None);

pub(super) fn arm(value: &Value) -> Result<Value, String> {
    let choice = match value.as_str() {
        Some("cancel-open") => Choice::CancelOpen,
        Some("cancel-save") => Choice::CancelSave,
        Some("fixture") => Choice::Image,
        Some("invalid") => Choice::Invalid,
        Some("oversized") => Choice::Oversized,
        Some("destination") => Choice::Destination,
        _ => return Err("Unknown QA fixture choice".into()),
    };
    let mut pending = NEXT.lock().map_err(|_| "QA picker state unavailable")?;
    if pending.is_some() {
        return Err("Previous QA fixture choice was not consumed".into());
    }
    *pending = Some(choice);
    Ok(json!(true))
}

pub(super) fn consumed() -> Result<Value, String> {
    NEXT.lock()
        .map(|choice| json!(choice.is_none()))
        .map_err(|_| "QA picker state unavailable".into())
}

pub(super) fn selection(save: bool) -> Option<Option<PathBuf>> {
    let choice = NEXT.lock().ok()?.take()?;
    let root = super::directory().ok();
    let path = root.and_then(|root| {
        let leaf = match (choice, save) {
            (Choice::Image, false) => "qa-orchard.png",
            (Choice::Invalid, false) => "qa-invalid.png",
            (Choice::Oversized, false) => "qa-oversized.png",
            (Choice::Destination, true) => "qa-export.png",
            _ => return None,
        };
        let path = root.join(leaf);
        match path.symlink_metadata() {
            Err(e) if save && e.kind() == std::io::ErrorKind::NotFound => Some(path),
            Ok(m) if !save && m.is_file() && std::os::unix::fs::MetadataExt::nlink(&m) == 1 => {
                Some(path)
            }
            _ => None,
        }
    });
    Some(path)
}

// 文件夹选择器独立于图片选择器。QA 仅允许固定的合成 Electron 目录，拒绝链接。
static SESSION_FOLDER: Mutex<Option<bool>> = Mutex::new(None);

pub(super) fn arm_session_folder(value: &Value) -> Result<Value, String> {
    let pick = match value.as_str() {
        Some("fixture") => true,
        Some("cancel") => false,
        _ => return Err("Unknown QA folder choice".into()),
    };
    let mut next = SESSION_FOLDER
        .lock()
        .map_err(|_| "QA folder picker unavailable")?;
    if next.is_some() {
        return Err("Previous QA folder choice was not consumed".into());
    }
    *next = Some(pick);
    Ok(json!(true))
}

pub(super) fn session_folder() -> Option<Option<PathBuf>> {
    match SESSION_FOLDER.lock() {
        Err(_) => Some(None),
        Ok(mut pending) => match pending.take()? {
            false => Some(None),
            true => Some(super::directory().ok().and_then(|root| {
                let folder = root.join("qa-electron-copy");
                folder.symlink_metadata().ok()?.is_dir().then_some(folder)
            })),
        },
    }
}
