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
pub(super) static SESSION_FOLDER: Mutex<Option<bool>> = Mutex::new(None);
pub(super) static PROJECT_FOLDER: Mutex<Option<bool>> = Mutex::new(None);

pub(super) fn arm_folder(state: &Mutex<Option<bool>>, value: &Value) -> Result<Value, String> {
    let pick = match value.as_str() {
        Some("fixture") => true,
        Some("cancel") => false,
        _ => return Err("Unknown QA folder choice".into()),
    };
    let mut next = state.lock().map_err(|_| "QA folder picker unavailable")?;
    if next.is_some() {
        return Err("Previous QA folder choice was not consumed".into());
    }
    *next = Some(pick);
    Ok(json!(true))
}

fn folder_selection(state: &Mutex<Option<bool>>, leaf: &str) -> Option<Option<PathBuf>> {
    match state.lock() {
        Err(_) => Some(None),
        Ok(mut pending) => match pending.take()? {
            false => Some(None),
            true => Some(super::directory().ok().and_then(|root| {
                let folder = root.join(leaf);
                folder.symlink_metadata().ok()?.is_dir().then_some(folder)
            })),
        },
    }
}

pub(super) fn session_folder() -> Option<Option<PathBuf>> {
    folder_selection(&SESSION_FOLDER, "qa-electron-copy")
}

pub(super) fn project_folder() -> Option<Option<PathBuf>> {
    folder_selection(&PROJECT_FOLDER, "qa-project-folder")
}

// 文档面板只用固定测试叶文件名；正式应用不能消费这组选择。
static DOCUMENT_CHOICE: Mutex<Option<Option<&'static str>>> = Mutex::new(None);
pub(super) fn arm_document(value: &Value) -> Result<Value, String> {
    let leaf = match value.as_str() {
        Some("cancel") => None,
        Some("fixture") => Some("qa-project-note.md"),
        Some("fixture-two") => Some("qa-project-other.txt"),
        Some("invalid") => Some("qa-project-invalid.txt"),
        Some("oversized") => Some("qa-project-oversized.txt"),
        Some("pdf") => Some("qa-project-scan.pdf"),
        Some("pdf-pages") => Some("qa-project-pages.pdf"),
        Some("pdf-encrypted") => Some("qa-project-protected.pdf"),
        Some("pdf-damaged") => Some("qa-project-damaged.pdf"),
        Some("pdf-limit") => Some("qa-project-long.pdf"),
        _ => return Err("Unknown QA document choice".into()),
    };
    let mut next = DOCUMENT_CHOICE
        .lock()
        .map_err(|_| "QA document picker unavailable")?;
    if next.is_some() {
        return Err("Previous QA document choice was not consumed".into());
    }
    *next = Some(leaf);
    Ok(json!(true))
}
pub(super) fn document_selection() -> Option<Option<PathBuf>> {
    let leaf = DOCUMENT_CHOICE.lock().ok()?.take()?;
    Some(leaf.and_then(|name| super::directory().ok().map(|root| root.join(name))))
}

pub(super) static BACKUP_FILE: Mutex<Option<bool>> = Mutex::new(None);
pub(super) fn backup_selection() -> Option<Option<PathBuf>> {
    let selected = BACKUP_FILE.lock().ok()?.take()?;
    Some(if selected {
        super::directory()
            .ok()
            .map(|dir| dir.join("qa-project.tinkerproject"))
    } else {
        None
    })
}
