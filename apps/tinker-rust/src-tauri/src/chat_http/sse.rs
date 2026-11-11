//! 两种codec共用UTF8/SSE分帧与64KiB帧上限。
use super::{anthropic::Anthropic, openai::OpenAi, HttpProtocol};
use crate::run_types::RunError;
pub(super) struct Sse {
    line: Vec<u8>,
    data: String,
    event: String,
    frame_bytes: usize,
    skip_lf: bool,
    first_line_seen: bool,
    codec: Codec,
}
enum Codec {
    OpenAi(OpenAi),
    Anthropic(Anthropic),
}
impl Sse {
    pub(super) fn new(protocol: HttpProtocol) -> Self {
        Self {
            line: Vec::new(),
            data: String::new(),
            event: String::new(),
            frame_bytes: 0,
            skip_lf: false,
            first_line_seen: false,
            codec: match protocol {
                HttpProtocol::OpenaiChat => Codec::OpenAi(OpenAi::default()),
                HttpProtocol::AnthropicMessages => Codec::Anthropic(Anthropic::default()),
            },
        }
    }
    pub(super) fn complete(&self) -> bool {
        self.line.is_empty()
            && self.data.is_empty()
            && match &self.codec {
                Codec::OpenAi(c) => c.finished,
                Codec::Anthropic(c) => c.finished,
            }
    }
    pub(super) fn push(
        &mut self,
        byte: u8,
        emit: &mut dyn FnMut(&str) -> Result<(), RunError>,
    ) -> Result<bool, RunError> {
        if self.skip_lf {
            self.skip_lf = false;
            if byte == b'\n' {
                return Ok(false);
            }
        }
        self.frame_bytes += 1;
        if self.frame_bytes > 64 * 1024 {
            return Err(RunError::RunLimitExceeded);
        }
        if byte != b'\n' && byte != b'\r' {
            self.line.push(byte);
            return Ok(false);
        }
        self.skip_lf = byte == b'\r';
        let line = std::mem::take(&mut self.line);
        let line = std::str::from_utf8(&line).map_err(|_| RunError::HttpProtocol)?;
        let line = if !self.first_line_seen {
            self.first_line_seen = true;
            line.strip_prefix('\u{feff}').unwrap_or(line)
        } else {
            line
        };
        if line.is_empty() {
            self.frame_bytes = 0;
            let event = std::mem::take(&mut self.event);
            if self.data.is_empty() {
                return Ok(false);
            }
            let data = std::mem::take(&mut self.data);
            return match &mut self.codec {
                Codec::OpenAi(c) => c.frame(data.trim_end_matches('\n'), emit),
                Codec::Anthropic(c) => c.frame(&event, data.trim_end_matches('\n'), emit),
            };
        }
        if let Some(data) = line.strip_prefix("data:") {
            self.data.push_str(data.strip_prefix(' ').unwrap_or(data));
            self.data.push('\n');
        }
        if let Some(event) = line.strip_prefix("event:") {
            self.event = event.strip_prefix(' ').unwrap_or(event).to_owned();
        }
        Ok(false)
    }
}
