//! 仅QA feature持有的有限哨兵服务；重启精确重绑自己持久化的端口，冲突即失败。
use super::{
    catalog::EndpointPolicy,
    vault_fake::{QA_SECRET_ONE, QA_SECRET_TWO},
};
use crate::{
    desktop_runtime::protocol::{DesktopError, Result},
    formal_platform::{store, TrustedRoot},
};
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Binding {
    version: u32,
    port: u16,
}
pub(crate) struct OwnedQa {
    policy: EndpointPolicy,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}
impl OwnedQa {
    pub(crate) fn start(root: &TrustedRoot) -> Result<Self> {
        root.validate_channels()?;
        let file = root.path().join("qa-endpoint.json");
        let saved = if file.try_exists()? {
            let b: Binding = serde_json::from_slice(&store::read_regular(&file, 1024)?)
                .map_err(|_| DesktopError("invalidEndpoint"))?;
            if b.version != 1 || b.port == 0 {
                return Err(DesktopError("invalidEndpoint"));
            }
            Some(b)
        } else {
            None
        };
        let listener = TcpListener::bind(("127.0.0.1", saved.as_ref().map_or(0, |b| b.port)))
            .map_err(|_| DesktopError("qaEndpointUnavailable"))?;
        let policy = EndpointPolicy::owned_qa(&listener, "/v1")?;
        if saved.is_none() {
            store::write_new(
                &file,
                &serde_json::to_vec(&Binding {
                    version: 1,
                    port: listener.local_addr()?.port(),
                })
                .map_err(|_| DesktopError("storeIo"))?,
            )?;
            store::sync_dir(root.path())?;
        }
        listener.set_nonblocking(true)?;
        let stop = Arc::new(AtomicBool::new(false));
        let token = stop.clone();
        let thread = std::thread::Builder::new()
            .name("channels-owned-qa".into())
            .spawn(move || {
                while !token.load(Ordering::Acquire) {
                    match listener.accept() {
                        Ok((mut s, _)) => {
                            let _ = serve(&mut s, &token);
                        }
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                            std::thread::sleep(Duration::from_millis(5))
                        }
                        Err(_) => break,
                    }
                }
            })
            .map_err(|_| DesktopError("hostUnavailable"))?;
        Ok(Self {
            policy,
            stop,
            thread: Some(thread),
        })
    }
    pub(crate) fn policy(&self) -> EndpointPolicy {
        self.policy.clone()
    }
}
impl Drop for OwnedQa {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}
fn serve(s: &mut TcpStream, cancel: &AtomicBool) -> Result<()> {
    s.set_nonblocking(true)?;
    let deadline = Instant::now() + Duration::from_secs(2);
    let mut bytes = Vec::new();
    let mut buffer = [0u8; 4096];
    loop {
        if cancel.load(Ordering::Acquire) || Instant::now() > deadline {
            return Err(DesktopError("qaRequestTimeout"));
        }
        match s.read(&mut buffer) {
            Ok(0) => return Err(DesktopError("qaRequestInvalid")),
            Ok(n) => bytes.extend_from_slice(&buffer[..n]),
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(2));
                continue;
            }
            Err(_) => return Err(DesktopError("qaRequestInvalid")),
        }
        if bytes.len() > 4 * 1024 * 1024 {
            return Err(DesktopError("qaRequestInvalid"));
        }
        if let Some(end) = bytes.windows(4).position(|p| p == b"\r\n\r\n") {
            let headers =
                std::str::from_utf8(&bytes[..end]).map_err(|_| DesktopError("qaRequestInvalid"))?;
            let length = headers
                .lines()
                .find_map(|s| {
                    s.to_ascii_lowercase()
                        .strip_prefix("content-length:")
                        .map(|v| v.trim().parse::<usize>())
                })
                .transpose()
                .map_err(|_| DesktopError("qaRequestInvalid"))?
                .unwrap_or(0);
            if bytes.len() < end + 4 + length {
                continue;
            }
            let authorized = headers.lines().any(|line| {
                let lower = line.to_ascii_lowercase();
                [QA_SECRET_ONE, QA_SECRET_TWO].iter().any(|key| {
                    lower == format!("authorization: bearer {key}")
                        || lower == format!("x-api-key: {key}")
                })
            });
            s.set_nonblocking(false)?;
            s.set_write_timeout(Some(Duration::from_secs(1)))?;
            if !authorized {
                s.write_all(
                    b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )?;
                return Ok(());
            }
            if headers.starts_with("GET /v1/models ") {
                let body = r#"{"data":[{"id":"owned-text","display_name":"Owned Text"}]}"#;
                write!(s,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len())?;
                return Ok(());
            }
            let anthropic = headers.starts_with("POST /v1/messages ");
            if !anthropic && !headers.starts_with("POST /v1/chat/completions ") {
                return Err(DesktopError("qaRequestInvalid"));
            }
            let request: serde_json::Value =
                serde_json::from_slice(&bytes[end + 4..end + 4 + length])
                    .map_err(|_| DesktopError("qaRequestInvalid"))?;
            let last = request["messages"]
                .as_array()
                .and_then(|a| a.last())
                .and_then(|m| m["content"].as_str())
                .unwrap_or("");
            if last.contains("[qa:failure]") {
                s.write_all(
                    b"HTTP/1.1 503 Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )?;
                return Ok(());
            }
            s.write_all(
                b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n",
            )?;
            if anthropic {
                s.write_all(b"event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"type\":\"message\",\"role\":\"assistant\",\"content\":[],\"stop_reason\":null}}\n\nevent: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n")?;
            }
            for text in ["Owned QA ", "streamed text ", "completed."] {
                if cancel.load(Ordering::Acquire) {
                    return Ok(());
                }
                let value = if anthropic {
                    serde_json::json!({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":text}})
                } else {
                    serde_json::json!({"choices":[{"delta":{"content":text},"finish_reason":null}]})
                };
                if anthropic {
                    s.write_all(b"event: content_block_delta\n")?;
                }
                write!(s, "data: {value}\n\n")?;
                s.flush()?;
                let wait = Instant::now()
                    + Duration::from_millis(if last.contains("[qa:slow]") {
                        1500
                    } else {
                        100
                    });
                while Instant::now() < wait && !cancel.load(Ordering::Acquire) {
                    std::thread::sleep(Duration::from_millis(5));
                }
            }
            if anthropic {
                s.write_all(b"event: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":0}\n\nevent: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"}}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n")?;
            } else {
                s.write_all(b"data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")?;
            }
            return Ok(());
        }
    }
}
