//! 正式窗口唯一 IPC 边界；阻塞等待与 owned mock join 全部离开 UI 线程。
use crate::{formal_host::FormalHost, formal_platform::HostEnvironment};
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::Duration;
use tauri::{Manager, Runtime, WebviewWindow};
#[derive(Clone)]
pub struct FormalState {
    pub host: Arc<Mutex<Option<FormalHost>>>,
    pub approved_close: Arc<AtomicBool>,
    generation: Arc<AtomicU64>,
    environment_sequence: Arc<AtomicU64>,
    pub snapshots: Arc<Mutex<Option<std::sync::mpsc::SyncSender<Value>>>>,
}
#[derive(Debug, Serialize)]
pub struct WireError {
    pub code: &'static str,
}
impl From<crate::desktop_runtime::protocol::DesktopError> for WireError {
    fn from(error: crate::desktop_runtime::protocol::DesktopError) -> Self {
        Self { code: error.0 }
    }
}
impl FormalState {
    pub fn new(host: FormalHost) -> Self {
        Self {
            host: Arc::new(Mutex::new(Some(host))),
            approved_close: Arc::new(AtomicBool::new(false)),
            generation: Arc::new(AtomicU64::new(0)),
            environment_sequence: Arc::new(AtomicU64::new(0)),
            snapshots: Arc::new(Mutex::new(None)),
        }
    }
    pub fn environment(
        &self,
        environment: HostEnvironment,
    ) -> Result<(crate::formal_agent::PendingReply, u64), WireError> {
        // 与 bootstrap 同一 enqueue 锁，水位表示该 bootstrap 必然已纳入的系统事实。
        let guard = self.host.lock().map_err(|_| WireError {
            code: "hostUnavailable",
        })?;
        let pending = guard
            .as_ref()
            .ok_or(WireError { code: "hostClosed" })?
            .set_host_environment(environment)?;
        let sequence = self.environment_sequence.fetch_add(1, Ordering::SeqCst) + 1;
        Ok((pending, sequence))
    }
}
pub fn local_origin(url: &tauri::Url) -> bool {
    url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && ((url.scheme() == "tauri" && url.host_str() == Some("localhost"))
            || (url.scheme() == "http" && url.host_str() == Some("tauri.localhost")))
}

fn guard<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), WireError> {
    if window.label() != "main" || !window.url().is_ok_and(|url| local_origin(&url)) {
        return Err(WireError {
            code: "invalidWindow",
        });
    }
    Ok(())
}
#[tauri::command]
pub async fn formal_request<R: Runtime>(
    window: WebviewWindow<R>,
    state: tauri::State<'_, FormalState>,
    request: Value,
) -> Result<Value, WireError> {
    guard(&window)?;
    let shared = state.inner().clone();
    let bootstrap = request["command"] == "bootstrap";
    let close = request["command"] == "closeReady";
    let result = tauri::async_runtime::spawn_blocking(move || {
        let (pending, environment_sequence) = {
            let guard = shared.host.lock().map_err(|_| WireError {
                code: "hostUnavailable",
            })?;
            let pending = guard
                .as_ref()
                .ok_or(WireError { code: "hostClosed" })?
                .command("main", request)?;
            (pending, shared.environment_sequence.load(Ordering::SeqCst))
        };
        let mut result = pending
            .wait(Duration::from_secs(130))
            .map_err(WireError::from)?;
        if bootstrap {
            let generation = result["generation"]
                .as_str()
                .and_then(|value| value.strip_prefix("document-"))
                .and_then(|value| value.parse::<u64>().ok())
                .ok_or(WireError {
                    code: "invalidReply",
                })?;
            shared.generation.fetch_max(generation, Ordering::SeqCst);
            result["environmentSequence"] = json!(environment_sequence);
        }
        if close {
            let mut host = shared
                .host
                .lock()
                .map_err(|_| WireError {
                    code: "hostUnavailable",
                })?
                .take()
                .ok_or(WireError { code: "hostClosed" })?;
            host.shutdown().map_err(WireError::from)?;
            shared.approved_close.store(true, Ordering::SeqCst);
        }
        Ok::<Value, WireError>(result)
    })
    .await
    .map_err(|_| WireError {
        code: "hostUnavailable",
    })??;
    if let Some(snapshot) = result.get(if bootstrap {
        "platformSnapshot"
    } else {
        "snapshot"
    }) {
        if let Some(sender) = state
            .snapshots
            .lock()
            .map_err(|_| WireError {
                code: "hostUnavailable",
            })?
            .as_ref()
        {
            let _ = sender.try_send(snapshot.clone());
        }
    }
    if close {
        window.close().map_err(|_| WireError {
            code: "windowUnavailable",
        })?;
        window.app_handle().exit(0);
    }
    Ok(result)
}
#[tauri::command]
pub fn formal_window<R: Runtime>(
    window: WebviewWindow<R>,
    state: tauri::State<'_, FormalState>,
    generation: String,
    action: String,
) -> Result<(), WireError> {
    guard(&window)?;
    if generation != format!("document-{}", state.generation.load(Ordering::SeqCst)) {
        return Err(WireError {
            code: "staleGeneration",
        });
    }
    match action.as_str() {
        "drag" => window.start_dragging().map_err(|_| WireError {
            code: "windowUnavailable",
        }),
        _ => Err(WireError {
            code: "unsupported",
        }),
    }
}
pub fn action<R: Runtime>(app: &tauri::AppHandle<R>, name: &str) {
    use tauri::Emitter;
    let _ = app.emit_to(
        "main",
        "formal:event",
        json!({"kind":"action","action":name}),
    );
}
