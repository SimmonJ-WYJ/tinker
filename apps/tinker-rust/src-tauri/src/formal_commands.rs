//! 正式窗口唯一 IPC 边界；阻塞等待与 owned mock join 全部离开 UI 线程。
#[cfg(all(target_os = "macos", feature = "formal-preview"))]
pub(crate) mod image_disk;
#[cfg(all(target_os = "macos", feature = "formal-preview"))]
mod image_panel;
#[cfg(all(target_os = "macos", feature = "formal-preview"))]
mod session_panel;
use crate::{formal_host::FormalHost, formal_platform::HostEnvironment};
use serde::{Deserialize, Serialize};
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
    #[cfg(all(target_os = "macos", feature = "formal-preview"))]
    picker_open: Arc<AtomicBool>,
    pub approved_close: Arc<AtomicBool>,
    close: Arc<Mutex<Option<CloseReceipt>>>,
    generation: Arc<AtomicU64>,
    environment_sequence: Arc<AtomicU64>,
    pub snapshots: Arc<Mutex<Option<std::sync::mpsc::SyncSender<Value>>>>,
}
#[derive(Debug, Clone, Serialize)]
pub struct WireError {
    pub code: &'static str,
}
// 窄的二阶段窗口提交：字段/代际/token/revision 必须与已完成 drain 完全一致。
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CloseRequest {
    command: String,
    generation: String,
    close_token: String,
    committed_revision: u64,
}
impl CloseRequest {
    fn matches(&self, other: &Self) -> bool {
        self.generation == other.generation
            && self.close_token == other.close_token
            && self.committed_revision == other.committed_revision
    }
}
struct CloseReceipt {
    request: CloseRequest,
    outcome: Option<Result<Value, WireError>>,
}
impl From<crate::desktop_runtime::protocol::DesktopError> for WireError {
    fn from(error: crate::desktop_runtime::protocol::DesktopError) -> Self {
        Self { code: error.0 }
    }
}
#[cfg(all(target_os = "macos", feature = "formal-preview"))]
struct OpenFileDialog(Arc<AtomicBool>);
#[cfg(all(target_os = "macos", feature = "formal-preview"))]
impl Drop for OpenFileDialog {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

impl FormalState {
    #[cfg(all(target_os = "macos", feature = "formal-preview"))]
    fn acquire_file_dialog(&self) -> Result<OpenFileDialog, WireError> {
        self.picker_open
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| WireError {
                code: "imageDialogBusy",
            })?;
        Ok(OpenFileDialog(self.picker_open.clone()))
    }
    pub fn new(host: FormalHost) -> Self {
        Self {
            host: Arc::new(Mutex::new(Some(host))),
            #[cfg(all(target_os = "macos", feature = "formal-preview"))]
            picker_open: Arc::new(AtomicBool::new(false)),
            approved_close: Arc::new(AtomicBool::new(false)),
            close: Arc::new(Mutex::new(None)),
            generation: Arc::new(AtomicU64::new(0)),
            environment_sequence: Arc::new(AtomicU64::new(0)),
            snapshots: Arc::new(Mutex::new(None)),
        }
    }
    fn close_request(&self, request: Value) -> Result<CloseRequest, WireError> {
        let request: CloseRequest = serde_json::from_value(request).map_err(|_| WireError {
            code: "invalidEnvelope",
        })?;
        if !matches!(request.command.as_str(), "closeReady" | "closeWindow") {
            return Err(WireError {
                code: "invalidEnvelope",
            });
        }
        if request.generation != format!("document-{}", self.generation.load(Ordering::SeqCst)) {
            return Err(WireError {
                code: "staleGeneration",
            });
        }
        Ok(request)
    }
    fn authorize_close(&self, request: Value) -> Result<(), WireError> {
        let request = self.close_request(request)?;
        let guard = self.close.lock().map_err(|_| WireError {
            code: "hostUnavailable",
        })?;
        let receipt = guard
            .as_ref()
            .filter(|receipt| receipt.request.matches(&request))
            .ok_or(WireError {
                code: "invalidCloseToken",
            })?;
        match &receipt.outcome {
            Some(Ok(_)) => {
                self.approved_close.store(true, Ordering::SeqCst);
                Ok(())
            }
            Some(Err(error)) => Err(error.clone()),
            None => Err(WireError {
                code: "closePending",
            }),
        }
    }
    fn drain(&self, request: Value) -> Result<Value, WireError> {
        let identity = self.close_request(request.clone())?;
        {
            let mut guard = self.close.lock().map_err(|_| WireError {
                code: "hostUnavailable",
            })?;
            if let Some(receipt) = guard.as_ref() {
                if !receipt.request.matches(&identity) {
                    return Err(WireError {
                        code: "invalidCloseToken",
                    });
                }
                return receipt.outcome.clone().unwrap_or(Err(WireError {
                    code: "closePending",
                }));
            }
            *guard = Some(CloseReceipt {
                request: identity.clone(),
                outcome: None,
            });
        }
        let result = (|| {
            let pending = self
                .host
                .lock()
                .map_err(|_| WireError {
                    code: "hostUnavailable",
                })?
                .as_ref()
                .ok_or(WireError { code: "hostClosed" })?
                .command("main", request)?;
            // actor 一旦 drain 就不可撤销。接收端保留到终态，JS deadline 只放弃本次等待。
            let result = pending.wait_final().map_err(WireError::from);
            // 准备期拒绝保留 host 以便 abort；closeFailed 则表示 actor 已不可逆退出。
            if let Err(error) = &result {
                if error.code != "closeFailed" {
                    return Err(error.clone());
                }
            }
            let mut host = self
                .host
                .lock()
                .map_err(|_| WireError {
                    code: "hostUnavailable",
                })?
                .take()
                .ok_or(WireError { code: "hostClosed" })?;
            host.shutdown().map_err(WireError::from)?;
            result
        })();
        let mut guard = self.close.lock().map_err(|_| WireError {
            code: "hostUnavailable",
        })?;
        // 已获 actor abort 确认的旧事务，不得被迟到失败回包重新建立。
        if let Some(receipt) = guard
            .as_mut()
            .filter(|receipt| receipt.request.matches(&identity))
        {
            receipt.outcome = Some(result.clone());
        }
        result
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
    #[cfg(all(target_os = "macos", feature = "formal-preview"))]
    if request["command"] == "importElectronSessions" {
        return session_panel::run(window, state.inner().clone(), request).await;
    }
    #[cfg(all(target_os = "macos", feature = "formal-preview"))]
    if matches!(
        request["command"].as_str(),
        Some("pickImageFile" | "saveImageFile")
    ) {
        return image_panel::run(window, state.inner().clone(), request).await;
    }
    if request["command"] == "closeWindow" {
        state.authorize_close(request)?;
        window.close().map_err(|_| WireError {
            code: "windowUnavailable",
        })?;
        window.app_handle().exit(0);
        return Ok(json!({"closed":true}));
    }
    let shared = state.inner().clone();
    let bootstrap = request["command"] == "bootstrap";
    let close = request["command"] == "closeReady";
    let abort = request["command"] == "abortClose";
    let aborted_request = request.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        if close {
            return shared.drain(request);
        }
        if bootstrap
            && shared
                .close
                .lock()
                .map_err(|_| WireError {
                    code: "hostUnavailable",
                })?
                .is_some()
        {
            return Err(WireError { code: "closing" });
        }
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
        if abort {
            let mut guard = shared.close.lock().map_err(|_| WireError {
                code: "hostUnavailable",
            })?;
            if guard.as_ref().is_some_and(|receipt| {
                aborted_request["generation"] == receipt.request.generation
                    && aborted_request["closeToken"] == receipt.request.close_token
            }) {
                *guard = None;
            }
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

#[cfg(test)]
mod tests {
    use super::*;
    fn pending_state() -> FormalState {
        FormalState {
            host: Arc::new(Mutex::new(None)),
            #[cfg(all(target_os = "macos", feature = "formal-preview"))]
            picker_open: Arc::new(AtomicBool::new(false)),
            approved_close: Arc::new(AtomicBool::new(false)),
            generation: Arc::new(AtomicU64::new(1)),
            environment_sequence: Arc::new(AtomicU64::new(0)),
            snapshots: Arc::new(Mutex::new(None)),
            close: Arc::new(Mutex::new(Some(CloseReceipt {
                request: CloseRequest {
                    command: "closeReady".into(),
                    generation: "document-1".into(),
                    close_token: "token-1".into(),
                    committed_revision: 3,
                },
                outcome: None,
            }))),
        }
    }
    fn close_request(command: &str) -> Value {
        json!({"command":command,"generation":"document-1","closeToken":"token-1","committedRevision":3})
    }
    #[test]
    fn late_drain_receipt_requires_a_new_exact_window_authorization() {
        let state = pending_state();
        assert_eq!(
            state.drain(close_request("closeReady")).unwrap_err().code,
            "closePending"
        );
        assert_eq!(
            state
                .authorize_close(close_request("closeWindow"))
                .unwrap_err()
                .code,
            "closePending"
        );
        // 故障注入：renderer 等待已结束，后台 drain 此时才完成。
        state.close.lock().unwrap().as_mut().unwrap().outcome = Some(Ok(json!({"closed":true})));
        assert!(!state.approved_close.load(Ordering::SeqCst));
        assert_eq!(
            state.drain(close_request("closeReady")).unwrap()["closed"],
            true
        );
        let mut wrong_revision = close_request("closeWindow");
        wrong_revision["committedRevision"] = json!(2);
        assert_eq!(
            state.authorize_close(wrong_revision).unwrap_err().code,
            "invalidCloseToken"
        );
        assert!(!state.approved_close.load(Ordering::SeqCst));
        state.authorize_close(close_request("closeWindow")).unwrap();
        assert!(state.approved_close.load(Ordering::SeqCst));
    }
    #[test]
    fn failed_drain_receipt_never_authorizes_window_close_or_repeats_cleanup() {
        let state = pending_state();
        state.close.lock().unwrap().as_mut().unwrap().outcome =
            Some(Err(WireError { code: "storeIo" }));
        assert_eq!(
            state.drain(close_request("closeReady")).unwrap_err().code,
            "storeIo"
        );
        assert_eq!(
            state
                .authorize_close(close_request("closeWindow"))
                .unwrap_err()
                .code,
            "storeIo"
        );
        assert!(!state.approved_close.load(Ordering::SeqCst));
    }
}
