//! 仅QA feature持有的有限哨兵服务；重启精确重绑自己持久化的端口，冲突即失败。
use super::{
    catalog::EndpointPolicy,
    qa_observations::Observations,
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
    _servers: [QaServer; 2],
}
impl OwnedQa {
    pub(crate) fn start(root: &TrustedRoot) -> Result<Self> {
        let primary = QaServer::start(root, "qa-endpoint.json", "qa-observations.json", 1)?;
        let secondary = QaServer::start(
            root,
            "qa-secondary-endpoint.json",
            "qa-secondary-observations.json",
            2,
        )?;
        Ok(Self {
            policy: primary.policy.combine_owned(&secondary.policy)?,
            _servers: [primary, secondary],
        })
    }
    pub(crate) fn policy(&self) -> EndpointPolicy {
        self.policy.clone()
    }
}
struct QaServer {
    policy: EndpointPolicy,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}
impl QaServer {
    fn start(root: &TrustedRoot, binding: &str, evidence: &str, provider: u8) -> Result<Self> {
        root.validate_channels()?;
        let file = root.path().join(binding);
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
        let observations = Arc::new(Observations::open(root.path().join(evidence))?);
        let first_failure = Arc::new(AtomicBool::new(observations.already_failed_image_edit()?));
        let stop = Arc::new(AtomicBool::new(false));
        let token = stop.clone();
        let thread = std::thread::Builder::new()
            .name("channels-owned-qa".into())
            .spawn(move || {
                let mut handlers: Vec<JoinHandle<()>> = Vec::new();
                while !token.load(Ordering::Acquire) {
                    let mut i = 0;
                    while i < handlers.len() {
                        if handlers[i].is_finished() {
                            let handler = handlers.remove(i);
                            let _ = handler.join();
                        } else {
                            i += 1
                        }
                    }
                    match listener.accept() {
                        Ok((mut stream, _)) => {
                            if handlers.len() >= 4 {
                                continue;
                            }
                            let cancel = token.clone();
                            let observations = observations.clone();
                            let first_failure = first_failure.clone();
                            match std::thread::Builder::new()
                                .name("channels-qa-request".into())
                                .spawn(move || {
                                    let _ = serve(
                                        &mut stream,
                                        &cancel,
                                        &observations,
                                        provider,
                                        &first_failure,
                                    );
                                }) {
                                Ok(handler) => handlers.push(handler),
                                Err(_) => {
                                    token.store(true, Ordering::Release);
                                    break;
                                }
                            }
                        }
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                            std::thread::sleep(Duration::from_millis(5))
                        }
                        Err(_) => break,
                    }
                }
                token.store(true, Ordering::Release);
                for handler in handlers {
                    let _ = handler.join();
                }
            })
            .map_err(|_| DesktopError("hostUnavailable"))?;
        Ok(Self {
            policy,
            stop,
            thread: Some(thread),
        })
    }
}
impl Drop for QaServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}
// 合成主线的上下文正反对照；不保存用户消息，也不接受只有最后提示词的错误续聊。
fn has_upgrade_history(request: &serde_json::Value) -> bool {
    let Some(messages) = request["messages"].as_array() else {
        return false;
    };
    let historical = [
        ("user", "A green northern ridge."),
        ("assistant", "The ridge is green."),
        ("user", "The alpine larch colour is amber."),
        ("assistant", "Recorded the amber observation."),
    ];
    messages.len() == historical.len() + 1
        && historical
            .iter()
            .zip(messages)
            .all(|((role, text), message)| message["role"] == *role && message["content"] == *text)
        && messages.last().is_some_and(|m| {
            m["role"] == "user"
                && m["content"]
                    .as_str()
                    .is_some_and(|s| s.contains("[qa:upgrade-context]"))
        })
}

// 仅供本机 QA：在 HTTP 边界确认选段、角色和后续轮次，不记录消息正文。
fn document_probe(request: &serde_json::Value, last: &str) -> Result<Option<&'static str>> {
    let pdf = last.contains("[qa:pdf-selection]") || last.contains("[qa:pdf-followup]");
    let selected = last.contains("[qa:document-selection]") || last.contains("[qa:pdf-selection]");
    let followup = last.contains("[qa:document-followup]") || last.contains("[qa:pdf-followup]");
    if !selected && !followup {
        return Ok(None);
    }
    let invalid = DesktopError("qaDocumentScopeMismatch");
    let wire = request.to_string();
    if [
        "QA_UNSELECTED_TOP_87",
        "QA_UNSELECTED_BOTTOM_76",
        "QA_OTHER_PROJECT_65",
        "QA_PDF_PAGE_ONE_18",
        "QA_PDF_PAGE_THREE_19",
        "QA_PDF_UNSELECTED_TOP_87",
        "QA_PDF_UNSELECTED_BOTTOM_76",
        "%PDF-",
        "JVBERi0",
    ]
    .iter()
    .any(|token| wire.contains(token))
    {
        return Err(invalid);
    }
    let message = request["messages"]
        .as_array()
        .and_then(|m| m.last())
        .ok_or(invalid)?;
    if message["role"] != "user" || message["content"] != last {
        return Err(invalid);
    }
    let marker = if pdf {
        "QA_PDF_SELECTED_CEDAR_42"
    } else {
        "QA_SELECTED_CEDAR_42"
    };
    if followup {
        return if !selected
            && !wire.contains("untrusted_document_excerpt")
            && !wire.contains("QA_SELECTED_CEDAR_42")
            && !wire.contains("QA_PDF_SELECTED_CEDAR_42")
        {
            Ok(Some(if pdf {
                "No PDF excerpt replayed. "
            } else {
                "No document excerpt replayed. "
            }))
        } else {
            Err(invalid)
        };
    }
    let start = last.find('{').ok_or(invalid)?;
    let excerpt: serde_json::Value = serde_json::from_str(&last[start..]).map_err(|_| invalid)?;
    if excerpt["type"] != "untrusted_document_excerpt"
        || excerpt["startLine"] != 2
        || excerpt["endLine"] != 2
        || (pdf && (excerpt["page"] != 2 || excerpt["filename"] != "qa-project-pages.pdf"))
        || excerpt["text"] != marker
        || wire.matches(marker).count() != 1
    {
        return Err(invalid);
    }
    Ok(Some(if pdf {
        "Selected PDF page and line verified. "
    } else {
        "Selected project lines verified. "
    }))
}

fn serve(
    s: &mut TcpStream,
    cancel: &AtomicBool,
    observations: &Observations,
    provider: u8,
    first_failure: &AtomicBool,
) -> Result<()> {
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
            let key_version = [QA_SECRET_ONE, QA_SECRET_TWO]
                .iter()
                .position(|key| {
                    headers.lines().any(|line| {
                        let Some((name, value)) = line.split_once(':') else {
                            return false;
                        };
                        (name.eq_ignore_ascii_case("authorization")
                            && value.trim() == format!("Bearer {key}"))
                            || (name.eq_ignore_ascii_case("x-api-key") && value.trim() == *key)
                    })
                })
                .map(|i| i as u8 + 1);
            s.set_nonblocking(false)?;
            s.set_write_timeout(Some(Duration::from_secs(1)))?;
            let method = if headers.starts_with("GET ") {
                "GET"
            } else if headers.starts_with("POST ") {
                "POST"
            } else {
                return Err(DesktopError("qaRequestInvalid"));
            };
            let sequence = observations.begin(method, key_version.unwrap_or(0))?;
            let mut evidence = RequestEvidence {
                observations,
                sequence,
                key_version: key_version.unwrap_or(0),
                method,
                phase: "cancelled",
            };
            let Some(_key_version) = key_version else {
                evidence.phase = "unauthorized";
                s.write_all(
                    b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )?;
                return Ok(());
            };
            if headers.starts_with("GET /v1/models ") {
                let body = r#"{"data":[{"id":"owned-text","display_name":"Owned Text"},{"id":"gpt-image-1","display_name":"Owned Image","output_modalities":["image"],"supported_endpoints":["/v1/images/generations","/v1/images/edits"]}]}"#;
                write!(s,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len())?;
                evidence.phase = "completed";
                return Ok(());
            }
            if let Some(edit) = qa_images::route(headers.lines().next().unwrap_or("")) {
                evidence.phase = qa_images::respond(
                    s,
                    edit,
                    provider,
                    headers,
                    &bytes[end + 4..end + 4 + length],
                    first_failure,
                )?;
                return Ok(());
            }
            let anthropic = headers.starts_with("POST /v1/messages ");
            if !anthropic && !headers.starts_with("POST /v1/chat/completions ") {
                return Err(DesktopError("qaRequestInvalid"));
            }
            let request: serde_json::Value =
                serde_json::from_slice(&bytes[end + 4..end + 4 + length])
                    .map_err(|_| DesktopError("qaRequestInvalid"))?;
            if request.get("model").is_some_and(|m| m != "owned-text") {
                evidence.phase = "text-invalid";
                s.write_all(
                    b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )?;
                return Ok(());
            }
            let last = request["messages"]
                .as_array()
                .and_then(|a| a.last())
                .and_then(|m| m["content"].as_str())
                .unwrap_or("");
            let rehearsal = last.contains("[qa:upgrade-context]");
            // 只匹配本机合成样例。普通续问不得包含 PDF 摘录、图片、编辑提示或截点后的文字。
            let media_follow = last == "[qa:media-fork] Continue the project in text.";
            if media_follow
                && request["messages"]
                    != serde_json::json!([
                        {"role":"user","content":"Explain the highlighted PDF line. [qa:pdf-selection]"},
                        {"role":"assistant","content":"Selected PDF page and line verified. streamed text completed."},
                        {"role":"user","content":"Bookmark this project checkpoint."},
                        {"role":"assistant","content":"Owned QA streamed text completed."},
                        {"role":"user","content":last}
                    ])
            {
                evidence.phase = "text-invalid";
                s.write_all(b"HTTP/1.1 422 Unprocessable Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")?;
                return Ok(());
            }
            let document = document_probe(&request, last);
            let fork = last == "[qa:fork-context] Continue the forked orchard note.";
            let expected_fork = serde_json::json!([
                {"role":"user","content":"First orchard note."},
                {"role":"assistant","content":"Owned QA streamed text completed."},
                {"role":"user","content":last},
            ]);
            if document.is_err()
                || (rehearsal && !has_upgrade_history(&request))
                || (fork && request["messages"] != expected_fork)
            {
                evidence.phase = "text-invalid";
                s.write_all(b"HTTP/1.1 422 Unprocessable Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")?;
                return Ok(());
            }
            if last.contains("[qa:failure]") {
                evidence.phase = "completed";
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
            let held = last.contains("[qa:hold]");
            let partial = last.contains("[qa:partial]");
            let first = if let Some(reply) = document? {
                reply.into()
            } else if media_follow {
                "Project fork context verified. ".into()
            } else if fork {
                "Fork prefix verified. ".into()
            } else if rehearsal {
                "Imported alpine context verified. ".into()
            } else if held || partial {
                "Owned QA visible streaming segment. ".repeat(6)
            } else {
                "Owned QA ".into()
            };
            for (index, text) in [first.as_str(), "streamed text ", "completed."]
                .into_iter()
                .enumerate()
            {
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
                let millis = if index == 0 && held {
                    60_000
                } else if index == 0 && partial {
                    2000
                } else if last.contains("[qa:slow]") {
                    1500
                } else {
                    100
                };
                if !wait_connected(s, cancel, Duration::from_millis(millis))? {
                    return Ok(());
                }
                if index == 0 && partial {
                    evidence.phase = "partial";
                    return Ok(());
                }
            }
            if anthropic {
                s.write_all(b"event: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":0}\n\nevent: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"}}\n\nevent: message_stop\ndata: {\"type\":\"message_stop\"}\n\n")?;
            } else {
                s.write_all(b"data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")?;
            }
            evidence.phase = "completed";
            return Ok(());
        }
    }
}

struct RequestEvidence<'a> {
    observations: &'a Observations,
    sequence: u64,
    key_version: u8,
    method: &'static str,
    phase: &'static str,
}
impl Drop for RequestEvidence<'_> {
    fn drop(&mut self) {
        let _ = self
            .observations
            .finish(self.sequence, self.method, self.key_version, self.phase);
    }
}
fn wait_connected(s: &mut TcpStream, cancel: &AtomicBool, duration: Duration) -> Result<bool> {
    s.set_nonblocking(true)?;
    let deadline = Instant::now() + duration;
    let mut heartbeat = Instant::now() + Duration::from_secs(1);
    let mut buffer = [0u8; 1];
    while Instant::now() < deadline {
        if cancel.load(Ordering::Acquire) {
            return Ok(false);
        }
        match s.peek(&mut buffer) {
            Ok(0) => return Ok(false),
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(_) => return Ok(false),
            Ok(_) => {}
        }
        if Instant::now() >= heartbeat {
            s.write_all(b": owned qa hold\n\n")?;
            s.flush()?;
            heartbeat = Instant::now() + Duration::from_secs(1);
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    s.set_nonblocking(false)?;
    Ok(true)
}

#[cfg(test)]
#[path = "qa_tests.rs"]
mod tests;

#[path = "qa_images.rs"]
mod qa_images;
