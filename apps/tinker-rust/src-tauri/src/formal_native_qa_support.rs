//! QA-only 原子证据、真实事件暂扣计数与自身 NSMenu 激活。
use crate::formal_agent::protocol::EventEnvelope;
use serde_json::{json, Value};
use std::{
    io::Write,
    path::Path,
    sync::{Mutex, OnceLock},
};
use tauri::Emitter;
#[derive(Default)]
struct Pump {
    hold: bool,
    queued: Vec<EventEnvelope>,
    observed: Vec<EventEnvelope>,
}
static PUMP: OnceLock<Mutex<Pump>> = OnceLock::new();
fn pump() -> &'static Mutex<Pump> {
    PUMP.get_or_init(|| Mutex::new(Pump::default()))
}
pub fn route(event: &EventEnvelope) -> bool {
    let mut p = pump().lock().expect("QA pump");
    if p.observed.len() == 1024 {
        p.observed.remove(0);
    }
    p.observed.push(event.clone());
    if p.hold && p.queued.len() < 1024 {
        p.queued.push(event.clone());
        false
    } else {
        true
    }
}
pub fn control(window: &tauri::WebviewWindow, action: &str) -> Result<Value, String> {
    let mut p = pump().lock().map_err(|e| e.to_string())?;
    match action {
        "hold" => {
            p.hold = true;
            p.queued.clear();
        }
        "release" => {
            p.hold = false;
            for event in p.queued.drain(..) {
                window
                    .emit("formal:event", event)
                    .map_err(|e| e.to_string())?;
            }
        }
        "pump-state" => {}
        "stale" => {
            let mut old = p
                .observed
                .iter()
                .find(|e| {
                    e.channel == "agent:stream:event"
                        && e.payload.to_string().contains("text_delta")
                })
                .cloned()
                .ok_or("no old delta")?;
            let newest = p.observed.last().ok_or("no current event")?;
            old.payload["payload"]["event"]["text"] = json!("QA_STALE_SHOULD_NEVER_APPEAR");
            // 使用真实历史 envelope 的generation/request，分别测试旧document与已完成run。
            let mut old_generation = newest.clone();
            old_generation.generation = old.generation.clone();
            old_generation.delivery_sequence = newest.delivery_sequence + 1;
            old_generation.payload["payload"]["event"]["text"] =
                json!("QA_STALE_GENERATION_SHOULD_NEVER_APPEAR");
            window
                .emit("formal:event", old_generation.clone())
                .map_err(|e| e.to_string())?;
            old.generation = newest.generation.clone();
            old.delivery_sequence = newest.delivery_sequence + 1;
            window
                .emit("formal:event", old.clone())
                .map_err(|e| e.to_string())?;
            return Ok(json!({"oldGeneration":old_generation,"oldRunCurrentGeneration":old}));
        }
        _ => return Err("unknown pump action".into()),
    }
    Ok(
        json!({"holding":p.hold,"queued":p.queued.len(),"queuedDeltas":p.queued.iter().filter(|e|e.payload.to_string().contains("text_delta")).count(),"events":p.observed.len(),"last":p.observed.last()}),
    )
}
pub fn publish(dir: &Path, sequence: u64, value: &Value) -> std::io::Result<()> {
    let temporary = dir.join(format!(".result-{sequence}.tmp"));
    let target = dir.join(format!("result-{sequence}.json"));
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)?;
    file.write_all(&serde_json::to_vec_pretty(value)?)?;
    file.sync_all()?;
    std::fs::rename(temporary, target)
}
pub fn menu_quit(window: &tauri::WebviewWindow) -> Result<Value, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    window.run_on_main_thread(move || {
        use objc2::MainThreadMarker;
        use objc2_app_kit::NSApplication;
        let result=(|| {
            let mtm=MainThreadMarker::new().ok_or("not main thread")?;
            let app=NSApplication::sharedApplication(mtm);
            let menu=app.mainMenu().ok_or("no native main menu")?;
            for item in menu.itemArray() {
                if let Some(submenu)=item.submenu() {
                    for (index,child) in submenu.itemArray().iter().enumerate() {
                        let title=child.title().to_string();
                        if title.starts_with("Quit") || title.starts_with("退出") {
                            if !child.isEnabled() {return Err("native Quit disabled".to_string());}
                            submenu.performActionForItemAtIndex(index as isize);
                            return Ok(json!({"nativeTitle":title,"index":index,"api":"NSMenu.performActionForItemAtIndex"}));
                        }
                    }
                }
            }
            Err("native Quit not found".to_string())
        })();
        let _=tx.send(result);
    }).map_err(|e|e.to_string())?;
    rx.recv_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn failed_publication_preserves_existing_receipt_and_reports_error() {
        let dir =
            std::env::temp_dir().join(format!("tinker-qa-publication-{}", std::process::id()));
        std::fs::create_dir(&dir).unwrap();
        publish(&dir, 1, &json!({"complete":true})).unwrap();
        std::fs::create_dir(dir.join(".result-1.tmp")).unwrap();
        assert!(publish(&dir, 1, &json!({"partial":false})).is_err());
        assert_eq!(
            serde_json::from_slice::<Value>(&std::fs::read(dir.join("result-1.json")).unwrap())
                .unwrap(),
            json!({"complete":true})
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
}
