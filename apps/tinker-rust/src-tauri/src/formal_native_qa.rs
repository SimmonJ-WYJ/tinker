//! 仅独立 QA feature：本进程 WKWebView 的有界验收驱动，不提供 IPC 控制命令。
use block2::RcBlock;
use objc2::runtime::AnyObject;
use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
use objc2_foundation::{NSDictionary, NSError, NSString};
use objc2_web_kit::WKWebView;
use serde_json::{json, Value};
use std::os::unix::fs::PermissionsExt;
use std::{
    path::PathBuf,
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};
use tauri::Manager;

fn directory() -> Result<PathBuf, String> {
    let path = PathBuf::from(
        std::env::var_os("TINKER_NATIVE_QA_DIR").ok_or("QA evidence directory required")?,
    );
    let canonical = path.canonicalize().map_err(|e| e.to_string())?;
    if canonical != path
        || !canonical.starts_with("/private/tmp")
        || canonical
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|p| p.to_str())
            != Some("native-qa")
        || !canonical
            .parent()
            .and_then(|p| p.parent())
            .and_then(|p| p.file_name())
            .and_then(|p| p.to_str())
            .is_some_and(|p| p.starts_with("tinker-tauri-checks-"))
    {
        return Err("QA directory outside owned evidence root".into());
    }
    let metadata = canonical.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_dir() || metadata.permissions().mode() & 0o077 != 0 {
        return Err("QA directory must be private (0700)".into());
    }
    Ok(canonical)
}
fn evaluate(window: &tauri::WebviewWindow, script: String) -> Result<Value, String> {
    let (tx, rx) = mpsc::channel();
    window
        .with_webview(move |view| unsafe {
            let webview = &*(view.inner() as *const WKWebView);
            // 仅接受本函数包裹的 JSON.stringify 返回值，成功值必为 NSString。
            let callback = RcBlock::new(move |value: *mut AnyObject, error: *mut NSError| {
                let result = if !error.is_null() {
                    Err(format!("{:?}", &*error))
                } else if value.is_null() {
                    Ok(Value::Null)
                } else {
                    serde_json::from_str::<Value>(&(*(value as *const NSString)).to_string())
                        .map_err(|e| e.to_string())
                };
                let _ = tx.send(result);
            });
            webview.evaluateJavaScript_completionHandler(
                &NSString::from_str(&format!("JSON.stringify((()=>{{{script}}})())")),
                Some(&callback),
            );
        })
        .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(15))
        .map_err(|e| e.to_string())?
}
// 只对本进程的 QA 窗口请求激活；AppKit 可能拒绝或延后，调用者还需读取实际状态。
fn foreground(window: &tauri::WebviewWindow, activate: bool) -> Result<Value, String> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSWindow};

    let (tx, rx) = mpsc::channel();
    window
        .with_webview(move |view| {
            let result = (|| {
                let mtm = MainThreadMarker::new().ok_or("QA requires the main thread")?;
                let app = NSApplication::sharedApplication(mtm);
                // Tauri 在此主线程回调内拥有并保活该 NSWindow。
                let owned = unsafe { view.ns_window().cast::<NSWindow>().as_ref() }
                    .ok_or("QA window unavailable")?;
                if activate {
                    if objc2::available!(macos = 14.0) {
                        app.activate();
                    } else {
                        #[allow(deprecated)]
                        app.activateIgnoringOtherApps(true);
                    }
                    owned.makeKeyAndOrderFront(None);
                }
                Ok(json!({"active": app.isActive(), "key": owned.isKeyWindow(), "visible": owned.isVisible()}))
            })();
            let _ = tx.send(result);
        })
        .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(15))
        .map_err(|e| e.to_string())?
}
fn snapshot(window: &tauri::WebviewWindow, path: PathBuf) -> Result<Value, String> {
    let (tx, rx) = mpsc::channel();
    window
        .with_webview(move |view| unsafe {
            let webview = &*(view.inner() as *const WKWebView);
            let callback = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
                let result = (|| {
                    if !error.is_null() || image.is_null() {
                        return Err("WK snapshot failed".to_string());
                    }
                    let tiff = (&*image).TIFFRepresentation().ok_or("missing TIFF")?;
                    let rep = NSBitmapImageRep::imageRepWithData(&tiff).ok_or("missing bitmap")?;
                    let png = rep
                        .representationUsingType_properties(
                            NSBitmapImageFileType::PNG,
                            &NSDictionary::new(),
                        )
                        .ok_or("missing PNG")?;
                    std::fs::write(&path, png.as_bytes_unchecked()).map_err(|e| e.to_string())?;
                    Ok(json!({"png":path}))
                })();
                let _ = tx.send(result);
            });
            webview.takeSnapshotWithConfiguration_completionHandler(None, &callback);
        })
        .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(15))
        .map_err(|e| e.to_string())?
}
#[path = "formal_native_qa_picker.rs"]
mod picker;
#[path = "formal_native_qa_support.rs"]
mod support;

/// 仅这两个有固定 QA 身份的入口可以消费硬编码的临时选择。
pub(crate) fn accepts_fixture_panels(identifier: &str) -> bool {
    matches!(
        identifier,
        "com.tinker.formal-native-qa" | "com.tinker.channels-native-qa"
    ) && directory().is_ok()
}

/// 仅供受独立 QA 身份限制的宿主调用。
pub(crate) fn image_panel_selection(save: bool) -> Option<Option<PathBuf>> {
    picker::selection(save)
}
pub(crate) fn document_panel_selection() -> Option<Option<PathBuf>> {
    picker::document_selection()
}
pub(crate) fn session_folder_selection() -> Option<Option<PathBuf>> {
    picker::session_folder()
}
pub(crate) fn project_folder_selection() -> Option<Option<PathBuf>> {
    picker::project_folder()
}
pub fn hooks() -> crate::formal_launch::LaunchProbe {
    crate::formal_launch::LaunchProbe {
        initialization_script: include_str!("formal_native_qa_early.js"),
        route_event: support::route,
        ready: start,
    }
}
pub fn start(window: tauri::WebviewWindow) {
    let dir = directory().expect("QA root must be owned temporary evidence directory");
    let _ = window.show();
    let _ = window.set_focus();
    thread::spawn(move || {
        let start = Instant::now();
        let mut last = 0;
        while start.elapsed() < Duration::from_secs(1800) && last < 256 {
            thread::sleep(Duration::from_millis(100));
            if !std::fs::symlink_metadata(dir.join("command.json"))
                .is_ok_and(|m| m.is_file() && m.len() <= 65536)
            {
                continue;
            }
            let Ok(bytes) = std::fs::read(dir.join("command.json")) else {
                continue;
            };
            let Ok(command) = serde_json::from_slice::<Value>(&bytes) else {
                continue;
            };
            let sequence = command["sequence"].as_u64().unwrap_or(0);
            if sequence <= last || sequence > 256 {
                continue;
            }
            last = sequence;
            let result = match command["action"].as_str().unwrap_or("") {
                "hold" | "release" | "pump-state" | "stale" => {
                    support::control(&window, command["action"].as_str().unwrap())
                }
                "type-owned-key"
                    if window.app_handle().config().identifier
                        == "com.tinker.channels-native-qa" =>
                {
                    use crate::credentialed_channels::vault_fake::{QA_SECRET_ONE, QA_SECRET_TWO};
                    match command["slot"].as_u64() {
                        Some(slot @ (1 | 2)) => {
                            let key = if slot == 1 {
                                QA_SECRET_ONE
                            } else {
                                QA_SECRET_TWO
                            };
                            evaluate(&window, format!("const i=document.querySelector('input[type=password]');if(!i||i.disabled)return false;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'{key}');i.dispatchEvent(new Event('input',{{bubbles:true}}));return true;"))
                        }
                        _ => Err("unknown owned slot".into()),
                    }
                }
                "activate-owned-window" => foreground(&window, true),
                "foreground-state" => foreground(&window, false),
                "image-picker-consumed" => picker::consumed(),
                "arm-document-picker" => picker::arm_document(&command["choice"]),
                "arm-image-picker" => picker::arm(&command["choice"]),
                "arm-session-folder" => {
                    picker::arm_folder(&picker::SESSION_FOLDER, &command["choice"])
                }
                "arm-project-folder" => {
                    picker::arm_folder(&picker::PROJECT_FOLDER, &command["choice"])
                }
                "menu-quit" => support::menu_quit(&window),
                "eval" => evaluate(&window, command["script"].as_str().unwrap_or("").into()),
                "snapshot" => snapshot(&window, dir.join(format!("snapshot-{sequence}.png"))),
                "records" => Ok(json!(window
                    .state::<crate::formal_commands::FormalState>()
                    .host
                    .lock()
                    .expect("QA host")
                    .as_ref()
                    .map(|host| host.mock_records()))),
                "fullscreen" => window
                    .set_fullscreen(command["value"].as_bool().unwrap_or(false))
                    .map(|_| json!(true))
                    .map_err(|e| e.to_string()),
                "focus" => window
                    .set_focus()
                    .map(|_| json!(true))
                    .map_err(|e| e.to_string()),
                "window" => Ok(
                    json!({"fullscreen":window.is_fullscreen().ok(),"visible":window.is_visible().ok()}),
                ),
                "reload" => {
                    crate::formal_commands::action(window.app_handle(), "reload");
                    Ok(json!(true))
                }
                "close" => window
                    .close()
                    .map(|_| json!(true))
                    .map_err(|e| e.to_string()),
                _ => Err("unknown QA action".into()),
            };
            let output = json!({"sequence":sequence,"result":result.as_ref().ok(),"error":result.err(),"pid":std::process::id()});
            if let Err(error) = support::publish(&dir, sequence, &output) {
                eprintln!("QA result publication failed at sequence {sequence}: {error}");
                break;
            }
        }
    });
}
