//! 原 chrome locale 菜单文案；关闭标签、刷新、退出都走正式 renderer 生命周期。
use serde_json::Value;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    Manager, Runtime,
};
fn text(locale: &Value, key: &str) -> String {
    key.split('.')
        .fold(locale, |v, k| &v[k])
        .as_str()
        .unwrap_or(key)
        .to_owned()
}
pub fn refresh<R: Runtime>(app: &tauri::AppHandle<R>, snapshot: &Value) {
    let source = if snapshot["settings"]["language"] == "zh" {
        include_str!("../../../electron/src/renderer/locales/zh/chrome.json")
    } else {
        include_str!("../../../electron/src/renderer/locales/en/chrome.json")
    };
    if let Ok(locale) = serde_json::from_str::<Value>(source) {
        let _ = install(app, &locale);
    }
}
fn install<R: Runtime>(app: &tauri::AppHandle<R>, locale: &Value) -> tauri::Result<()> {
    let quit = MenuItem::with_id(
        app,
        "formal-quit",
        text(locale, "menu.app.quit"),
        true,
        Some("CmdOrCtrl+Q"),
    )?;
    let close = MenuItem::with_id(
        app,
        "formal-close-tab",
        text(locale, "menu.file.closeTab"),
        true,
        Some("CmdOrCtrl+W"),
    )?;
    let reload = MenuItem::with_id(
        app,
        "formal-reload",
        text(locale, "menu.view.reload"),
        true,
        Some("CmdOrCtrl+R"),
    )?;
    let fullscreen = MenuItem::with_id(
        app,
        "formal-fullscreen",
        text(locale, "menu.view.fullscreen"),
        true,
        Some("Ctrl+Super+F"),
    )?;
    let app_menu = Submenu::with_items(app, "Tinker", true, &[&quit])?;
    let file = Submenu::with_items(app, text(locale, "menu.file.title"), true, &[&close])?;
    let edit = Submenu::with_items(
        app,
        text(locale, "menu.edit.title"),
        true,
        &[
            &PredefinedMenuItem::undo(app, Some(&text(locale, "menu.edit.undo")))?,
            &PredefinedMenuItem::redo(app, Some(&text(locale, "menu.edit.redo")))?,
            &PredefinedMenuItem::cut(app, Some(&text(locale, "menu.edit.cut")))?,
            &PredefinedMenuItem::copy(app, Some(&text(locale, "menu.edit.copy")))?,
            &PredefinedMenuItem::paste(app, Some(&text(locale, "menu.edit.paste")))?,
            &PredefinedMenuItem::select_all(app, Some(&text(locale, "menu.edit.selectAll")))?,
        ],
    )?;
    let view = Submenu::with_items(
        app,
        text(locale, "menu.view.title"),
        true,
        &[&reload, &fullscreen],
    )?;
    app.set_menu(Menu::with_items(app, &[&app_menu, &file, &edit, &view])?)?;
    Ok(())
}
pub fn event<R: Runtime>(app: &tauri::AppHandle<R>, event: tauri::menu::MenuEvent) {
    match event.id().as_ref() {
        "formal-quit" => crate::formal_commands::action(app, "close"),
        "formal-close-tab" => crate::formal_commands::action(app, "close-tab"),
        "formal-reload" => crate::formal_commands::action(app, "reload"),
        "formal-fullscreen" => {
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(value) = window.is_fullscreen() {
                    let _ = window.set_fullscreen(!value);
                }
            }
        }
        _ => {}
    }
}
