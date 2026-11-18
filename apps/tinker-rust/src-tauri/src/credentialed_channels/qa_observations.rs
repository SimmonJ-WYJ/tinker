//! QA独占根内的有界脱敏计数；不保存请求头、正文、密钥或提示词。
use crate::{
    desktop_runtime::protocol::{DesktopError, Result},
    formal_platform::store,
};
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Mutex};
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Counts {
    get_count: u64,
    post_count: u64,
    key_one_gets: u64,
    key_two_gets: u64,
    key_one_posts: u64,
    key_two_posts: u64,
    #[serde(default)]
    unauthorized_requests: u64,
    active_handlers: u64,
    partial_disconnects: u64,
    cancelled: u64,
    completed: u64,
    events: Vec<Event>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Event {
    sequence: u64,
    method: String,
    key_version: u8,
    phase: String,
}
pub(super) struct Observations {
    path: PathBuf,
    inner: Mutex<Counts>,
}
impl Observations {
    pub fn open(path: PathBuf) -> Result<Self> {
        let mut counts: Counts = if path.try_exists()? {
            serde_json::from_slice(&store::read_regular(&path, 64 * 1024)?)
                .map_err(|_| DesktopError("qaEvidenceInvalid"))?
        } else {
            Counts::default()
        };
        if counts.events.len() > 256
            || counts.events.iter().any(|e| {
                !["GET", "POST"].contains(&e.method.as_str())
                    || ![0, 1, 2].contains(&e.key_version)
                    || ![
                        "accepted",
                        "completed",
                        "cancelled",
                        "partial",
                        "unauthorized",
                    ]
                    .contains(&e.phase.as_str())
            })
        {
            return Err(DesktopError("qaEvidenceInvalid"));
        }
        counts.active_handlers = 0;
        let value = Self {
            path,
            inner: Mutex::new(counts),
        };
        value.update(|_| {})?;
        Ok(value)
    }
    fn update(&self, f: impl FnOnce(&mut Counts)) -> Result<()> {
        let mut counts = self
            .inner
            .lock()
            .map_err(|_| DesktopError("qaEvidenceInvalid"))?;
        f(&mut counts);
        let bytes = serde_json::to_vec(&*counts).map_err(|_| DesktopError("qaEvidenceInvalid"))?;
        let pending = self.path.with_extension("pending");
        store::write_new(&pending, &bytes)?;
        std::fs::rename(&pending, &self.path)?;
        store::sync_dir(self.path.parent().ok_or(DesktopError("invalidRoot"))?)?;
        Ok(())
    }
    pub fn begin(&self, method: &str, key_version: u8) -> Result<u64> {
        let mut sequence = 0;
        self.update(|c| {
            if method == "GET" {
                c.get_count += 1;
                if key_version == 1 {
                    c.key_one_gets += 1
                } else if key_version == 2 {
                    c.key_two_gets += 1
                }
            } else {
                c.post_count += 1;
                if key_version == 1 {
                    c.key_one_posts += 1
                } else if key_version == 2 {
                    c.key_two_posts += 1
                }
            }
            c.active_handlers += 1;
            sequence = c.get_count + c.post_count;
            event(c, sequence, method, key_version, "accepted");
        })?;
        Ok(sequence)
    }
    pub fn finish(&self, sequence: u64, method: &str, key_version: u8, phase: &str) -> Result<()> {
        self.update(|c| {
            c.active_handlers = c.active_handlers.saturating_sub(1);
            match phase {
                "unauthorized" => c.unauthorized_requests += 1,
                "partial" => c.partial_disconnects += 1,
                "cancelled" => c.cancelled += 1,
                _ => c.completed += 1,
            };
            event(c, sequence, method, key_version, phase)
        })
    }
}
fn event(c: &mut Counts, sequence: u64, method: &str, key_version: u8, phase: &str) {
    if c.events.len() == 256 {
        c.events.remove(0);
    }
    c.events.push(Event {
        sequence,
        method: method.into(),
        key_version,
        phase: phase.into(),
    });
}
