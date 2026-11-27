//! 面板附着于发起请求的窗口。只让阻塞工作线程等待结果，主线程继续处理 Tauri 事件。
use crate::desktop_runtime::protocol::{DesktopError, Result};
use block2::RcBlock;
use objc2::{rc::Retained, MainThreadMarker};
use objc2_app_kit::{NSModalResponseCancel, NSModalResponseOK, NSOpenPanel, NSSavePanel, NSWindow};
use objc2_foundation::{NSArray, NSString};
use std::{path::PathBuf, sync::mpsc};
use tauri::{Runtime, WebviewWindow};

pub(super) enum Panel {
    Open(&'static [&'static str]),
    Save {
        name: String,
        extension: &'static str,
    },
    Folder,
}

impl Panel {
    #[allow(deprecated)]
    fn build(self, mtm: MainThreadMarker) -> Retained<NSSavePanel> {
        match self {
            Self::Save { name, extension } => {
                let p = NSSavePanel::savePanel(mtm);
                p.setAllowedFileTypes(Some(&NSArray::from_retained_slice(&[NSString::from_str(
                    extension,
                )])));
                p.setAllowsOtherFileTypes(false);
                // AppKit 会补上受限扩展名；保留名称中间已有的点。
                let stem = std::path::Path::new(&name)
                    .file_stem()
                    .and_then(|s| s.to_str());
                p.setNameFieldStringValue(&NSString::from_str(stem.unwrap_or(&name)));
                p
            }
            open => {
                let p = NSOpenPanel::openPanel(mtm);
                p.setAllowsMultipleSelection(false);
                p.setResolvesAliases(false);
                let folder = matches!(open, Self::Folder);
                p.setCanChooseFiles(!folder);
                p.setCanChooseDirectories(folder);
                if let Self::Open(exts) = open {
                    let allowed = exts
                        .iter()
                        .map(|ext| NSString::from_str(ext))
                        .collect::<Vec<_>>();
                    p.setAllowedFileTypes(Some(&NSArray::from_retained_slice(&allowed)));
                    p.setAllowsOtherFileTypes(false);
                } else {
                    p.setCanCreateDirectories(false);
                    p.setShowsHiddenFiles(true);
                }
                p.into_super()
            }
        }
    }
}

pub(super) fn choose<R: Runtime, T: Send + 'static>(
    window: &WebviewWindow<R>,
    kind: Panel,
    selected: impl Fn(PathBuf) -> Result<T> + Send + 'static,
) -> Result<Option<T>> {
    let (tx, rx) = mpsc::channel();
    window
        .with_webview(move |view| {
            // Tauri 在此主线程回调中持有并保活发起选择的 NSWindow。
            let owner = unsafe { view.ns_window().cast::<NSWindow>().as_ref() };
            let (Some(owner), Some(mtm)) = (owner, MainThreadMarker::new()) else {
                let _ = tx.send(Err(DesktopError("windowUnavailable")));
                return;
            };
            if owner.attachedSheet().is_some() {
                let _ = tx.send(Err(DesktopError("imageDialogBusy")));
                return;
            }
            let invalid_url = match &kind {
                Panel::Folder => "invalidImportFolder",
                _ => "imageFileUnavailable",
            };
            let panel = kind.build(mtm);
            let source = panel.clone();
            let completion = RcBlock::new(move |response| {
                let result = match response {
                    code if code == NSModalResponseOK => source
                        .URL()
                        .and_then(|url| url.to_file_path())
                        .ok_or(DesktopError(invalid_url))
                        .and_then(&selected)
                        .map(Some),
                    code if code == NSModalResponseCancel => Ok(None),
                    _ => Err(DesktopError("windowUnavailable")),
                };
                let _ = tx.send(result);
            });
            panel.beginSheetModalForWindow_completionHandler(owner, &completion);
        })
        .map_err(|_| DesktopError("windowUnavailable"))?;
    rx.recv().map_err(|_| DesktopError("windowUnavailable"))?
}
