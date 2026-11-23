//! 正式预览专属owned HTTP合成服务；不读取环境、凭据或外部文件。
pub(crate) mod discovery;
mod images;
mod tools;
use crate::{
    desktop_runtime::{
        protocol::{DesktopError, Result},
        TrustedProfile,
    },
    formal_platform::{local_mock_profiles, MOCK_KEY},
};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
const MAX_BODY: usize = 512 * 1024;
const MAX_CONNECTIONS: usize = 16;
const MAX_REQUESTS: usize = 256;
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestMetadata {
    pub model: String,
    pub effort: Option<String>,
    pub user_messages: usize,
    pub assistant_messages: usize,
    pub scenario: String,
}
pub struct OwnedMock {
    addr: SocketAddr,
    endpoint: String,
    tools: bool,
    stop: Arc<AtomicBool>,
    records: Arc<Mutex<Vec<RequestMetadata>>>,
    worker: Option<JoinHandle<()>>,
}
impl OwnedMock {
    pub fn start() -> Result<Self> {
        Self::start_mode(false)
    }
    pub fn start_tools() -> Result<Self> {
        Self::start_mode(true)
    }
    fn start_mode(tools: bool) -> Result<Self> {
        let listener =
            TcpListener::bind(("127.0.0.1", 0)).map_err(|_| DesktopError("mockUnavailable"))?;
        listener
            .set_nonblocking(true)
            .map_err(|_| DesktopError("mockUnavailable"))?;
        let addr = listener
            .local_addr()
            .map_err(|_| DesktopError("mockUnavailable"))?;
        let endpoint = format!("http://{addr}/v1/chat/completions");
        let stop = Arc::new(AtomicBool::new(false));
        let records = Arc::new(Mutex::new(Vec::new()));
        let stopped = stop.clone();
        let log = records.clone();
        let worker = thread::Builder::new()
            .name("formal-mock".into())
            .spawn(move || {
                let mut workers: Vec<JoinHandle<()>> = Vec::new();
                let mut accepted = 0;
                while !stopped.load(Ordering::Acquire) {
                    let mut i = 0;
                    while i < workers.len() {
                        if workers[i].is_finished() {
                            let _ = workers.swap_remove(i).join();
                        } else {
                            i += 1;
                        }
                    }
                    match listener.accept() {
                        Ok((stream, _)) => {
                            if workers.len() >= MAX_CONNECTIONS || accepted >= MAX_REQUESTS {
                                drop(stream);
                                continue;
                            }
                            accepted += 1;
                            let s = stopped.clone();
                            let r = log.clone();
                            match thread::Builder::new()
                                .name("formal-mock-http".into())
                                .spawn(move || {
                                    let _ = serve(stream, &s, &r, tools);
                                }) {
                                Ok(w) => workers.push(w),
                                Err(_) => break,
                            }
                        }
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                            thread::sleep(Duration::from_millis(5))
                        }
                        Err(_) => break,
                    }
                }
                for w in workers {
                    let _ = w.join();
                }
            })
            .map_err(|_| DesktopError("mockUnavailable"))?;
        Ok(Self {
            addr,
            endpoint,
            tools,
            stop,
            records,
            worker: Some(worker),
        })
    }
    /// 只有此owned listener才能将随机端口解释为稳定逻辑profile的传输位置。
    pub fn profiles(&self) -> Result<Vec<TrustedProfile>> {
        if self.tools {
            tools::profiles(&self.endpoint)
        } else {
            local_mock_profiles(&self.endpoint)
        }
    }
    pub fn image_addr(&self) -> SocketAddr {
        self.addr
    }
    pub fn records(&self) -> Vec<RequestMetadata> {
        self.records.lock().map(|v| v.clone()).unwrap_or_default()
    }
    pub fn shutdown(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(w) = self.worker.take() {
            let _ = w.join();
        }
    }
}
impl Drop for OwnedMock {
    fn drop(&mut self) {
        self.shutdown();
    }
}
fn serve(
    mut stream: TcpStream,
    stop: &AtomicBool,
    records: &Mutex<Vec<RequestMetadata>>,
    tools: bool,
) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_millis(100)))?;
    stream.set_write_timeout(Some(Duration::from_millis(100)))?;
    let deadline = Instant::now() + Duration::from_secs(8);
    let mut bytes = Vec::new();
    let mut buf = [0; 4096];
    let header_end = loop {
        if stop.load(Ordering::Acquire) || Instant::now() > deadline {
            return Ok(());
        }
        match stream.read(&mut buf) {
            Ok(0) => return Ok(()),
            Ok(n) => bytes.extend_from_slice(&buf[..n]),
            Err(e)
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                continue
            }
            Err(e) => return Err(e),
        }
        if let Some(i) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
            break i + 4;
        }
        if bytes.len() > 16 * 1024 {
            return Ok(());
        }
    };
    let headers = String::from_utf8_lossy(&bytes[..header_end]);
    let catalog = headers.starts_with("GET /v1/models HTTP/1.1\r\n");
    let image = if tools {
        None
    } else {
        images::operation(headers.lines().next().unwrap_or(""))
    };
    if image.is_none() && !catalog && !headers.starts_with("POST /v1/chat/completions HTTP/1.1\r\n")
    {
        return Ok(());
    }
    let mut length = None;
    let mut auth = false;
    let mut json_request = false;
    let mut browser_origin = false;
    for line in headers.lines().skip(1) {
        if let Some((k, v)) = line.split_once(':') {
            match k.to_ascii_lowercase().as_str() {
                "content-length" => {
                    if length.is_some() {
                        return Ok(());
                    }
                    length = v.trim().parse::<usize>().ok();
                }
                "authorization" => auth = v.trim() == format!("Bearer {MOCK_KEY}"),
                "transfer-encoding" => return Ok(()),
                "content-type" => json_request = v.trim().eq_ignore_ascii_case("application/json"),
                "origin" => browser_origin = true,
                _ => {}
            }
        }
    }
    if catalog {
        if !auth {
            return stream.write_all(
                b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            );
        }
        let ids = if tools {
            vec!["local-tools-mock"]
        } else {
            vec!["local-mock-a", "local-mock-b"]
        };
        let body =
            json!({"data":ids.iter().map(|id|json!({"id":id})).collect::<Vec<_>>()}).to_string();
        return write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body);
    }
    let max_body = if image.is_some() {
        images::MAX_BODY
    } else {
        MAX_BODY
    };
    let Some(length) = length.filter(|n| *n <= max_body) else {
        return Ok(());
    };
    let allowed = match image {
        Some(_) => json_request && !browser_origin,
        None => auth,
    };
    if !allowed {
        return Ok(());
    }
    while bytes.len() < header_end + length {
        if stop.load(Ordering::Acquire) || Instant::now() > deadline {
            return Ok(());
        }
        match stream.read(&mut buf) {
            Ok(0) => return Ok(()),
            Ok(n) => bytes.extend_from_slice(&buf[..n]),
            Err(e)
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                continue
            }
            Err(e) => return Err(e),
        }
        if bytes.len() > max_body + 16 * 1024 {
            return Ok(());
        }
    }
    let Ok(body) = serde_json::from_slice::<Value>(&bytes[header_end..header_end + length]) else {
        return Ok(());
    };
    if let Some(op) = image {
        return images::respond(&mut stream, op, &body, records, stop);
    }
    if tools {
        return tools::respond(&mut stream, &body, records);
    }
    let Some(model) = body["model"]
        .as_str()
        .filter(|m| matches!(*m, "local-mock-a" | "local-mock-b"))
    else {
        return Ok(());
    };
    let effort = match body.get("reasoning_effort") {
        None => None,
        Some(Value::String(value)) if matches!(value.as_str(), "low" | "medium" | "high") => {
            Some(value.clone())
        }
        _ => return Ok(()),
    };
    let Some(messages) = body["messages"].as_array() else {
        return Ok(());
    };
    let last = messages
        .last()
        .and_then(|v| v["content"].as_str())
        .unwrap_or("");
    let mut scenario = if last.starts_with("[task-stream]") {
        "task-stream"
    } else if last.starts_with("[task-retry]") {
        "task-retry-failed"
    } else if last.starts_with("[partial-error]") {
        "partial-error"
    } else if last.starts_with("[error]") {
        "error"
    } else if last.starts_with("[slow]") {
        "slow"
    } else if last.starts_with("[backlog]") {
        "backlog"
    } else {
        "normal"
    };
    let users = messages.iter().filter(|v| v["role"] == "user").count();
    let assistants = messages.iter().filter(|v| v["role"] == "assistant").count();
    if let Ok(mut log) = records.lock() {
        if scenario == "task-retry-failed" && log.iter().any(|r| r.scenario == "task-retry-failed")
        {
            scenario = "task-retry-completed";
        }
        if log.len() < MAX_REQUESTS {
            log.push(RequestMetadata {
                model: model.into(),
                effort,
                user_messages: users,
                assistant_messages: assistants,
                scenario: scenario.into(),
            });
        }
    }
    if scenario == "error" {
        stream.write_all(
            b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        )?;
        return Ok(());
    }
    stream.write_all(
        b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n",
    )?;
    let label = if model == "local-mock-a" { "A" } else { "B" };
    let opening = format!("Local Mock {label} · 上下文 {users}/{assistants} · ");
    let (chunks, cadence) = match scenario {
        "slow" => (300, 10),
        "backlog" => (300, 1),
        "task-stream" => (40, 400),
        _ => (4, 1),
    };
    let stream_deadline = if scenario == "task-stream" {
        Instant::now() + Duration::from_secs(25)
    } else {
        deadline
    };
    for i in 0..chunks {
        if stop.load(Ordering::Acquire) || Instant::now() > stream_deadline {
            return Ok(());
        }
        let text = match i {
            0 => opening.as_str(),
            1 => "你好 ",
            2 => "🌱",
            _ => "·",
        };
        write!(
            stream,
            "data: {}\n\n",
            json!({"choices":[{"index":0,"delta":{"content":text},"finish_reason":null}]})
        )?;
        stream.flush()?;
        if matches!(scenario, "partial-error" | "task-retry-failed") && i == 2 {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(cadence));
    }
    write!(
        stream,
        "data: {}\n\ndata: [DONE]\n\n",
        json!({"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]})
    )?;
    stream.flush()
}
