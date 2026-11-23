//! 缩略图的首次解码在独立工作线程中串行执行，让宿主可继续处理取消和 IPC。
use super::{actor::Actor, Reply};
use crate::{
    desktop_runtime::protocol::{id, DesktopError, Result},
    formal_images::{ImageFile, MAX_THUMBNAIL_BYTES},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use std::{
    collections::VecDeque,
    thread::{self, JoinHandle},
};

struct Read {
    session: String,
    filename: String,
    sha256: String,
    replies: Vec<Reply>,
}
impl Read {
    fn matches(&self, sid: &str, name: &str, sha: &str) -> bool {
        self.session == sid && self.filename == name && self.sha256 == sha
    }
    fn settle(&mut self, result: Result<Value>) {
        for reply in self.replies.drain(..) {
            let _ = reply.send(result.clone());
        }
    }
}

#[derive(Default)]
pub(super) struct ThumbnailReads {
    queued: VecDeque<Read>,
    active: Option<(Read, JoinHandle<Result<String>>)>,
}
impl ThumbnailReads {
    pub(super) fn cancel(&mut self, reason: &'static str) {
        if let Some((read, _)) = &mut self.active {
            read.settle(Err(DesktopError(reason)));
        }
        for mut read in self.queued.drain(..) {
            read.settle(Err(DesktopError(reason)));
        }
    }
}
impl Drop for ThumbnailReads {
    fn drop(&mut self) {
        self.cancel("hostClosed");
        if let Some((_, worker)) = self.active.take() {
            let _ = worker.join();
        }
    }
}
impl Actor {
    pub(super) fn view_file(&self, sid: &str, filename: &str) -> Result<ImageFile> {
        id(sid)?;
        self.root.validate()?;
        self.session(sid)?;
        self.images
            .as_ref()
            .ok_or(DesktopError("unsupported"))?
            .store
            .attachment(sid, filename)
    }

    pub(super) fn queue_thumbnail(
        &mut self,
        args: &[Value],
        reply: &Reply,
    ) -> Result<Option<Value>> {
        if args.len() != 2 {
            return Err(DesktopError("invalidParams"));
        }
        let sid = args[0].as_str().ok_or(DesktopError("invalidParams"))?;
        let filename = args[1].as_str().ok_or(DesktopError("invalidParams"))?;
        let source = self.view_file(sid, filename)?;
        let reads = &mut self
            .images
            .as_mut()
            .expect("resolved image host")
            .thumbnails;
        let duplicate = reads
            .active
            .iter_mut()
            .map(|(r, _)| r)
            .chain(reads.queued.iter_mut())
            .find(|r| !r.replies.is_empty() && r.matches(sid, filename, source.sha256()));
        if let Some(old) = duplicate {
            if old.replies.len() >= 16 {
                return Err(DesktopError("hostBusy"));
            }
            old.replies.push(reply.clone());
        } else {
            if reads.queued.len() >= 32 {
                return Err(DesktopError("hostBusy"));
            }
            reads.queued.push_back(Read {
                session: sid.into(),
                filename: filename.into(),
                sha256: source.sha256().into(),
                replies: vec![reply.clone()],
            });
        }
        Ok(None)
    }

    fn thumbnail_source(&self, r: &Read) -> Result<ImageFile> {
        let handle = self.view_file(&r.session, &r.filename)?;
        if handle.sha256() != r.sha256 {
            return Err(DesktopError("imageSourceChanged"));
        }
        Ok(handle)
    }

    pub(super) fn poll_thumbnail(&mut self) {
        let Some(workflow) = self.images.as_mut() else {
            return;
        };
        if let Some((_, worker)) = &workflow.thumbnails.active {
            if !worker.is_finished() {
                return;
            }
        }
        if let Some((mut read, worker)) = workflow.thumbnails.active.take() {
            let value = worker
                .join()
                .unwrap_or(Err(DesktopError("hostUnavailable")));
            if !read.replies.is_empty() {
                let result = self
                    .thumbnail_source(&read)
                    .and(value)
                    .map(|data| json!({"value":data}));
                read.settle(result);
            }
        }
        let mut read = match self
            .images
            .as_mut()
            .and_then(|v| v.thumbnails.queued.pop_front())
        {
            Some(read) => read,
            None => return,
        };
        let started = self.thumbnail_source(&read).and_then(|file| {
            thread::Builder::new()
                .name("native-image-thumbnail".into())
                .spawn(move || {
                    let png = file.read_thumbnail()?;
                    if png.len() > MAX_THUMBNAIL_BYTES {
                        return Err(DesktopError("imageTooLarge"));
                    }
                    Ok(STANDARD.encode(png))
                })
                .map_err(|_| DesktopError("hostUnavailable"))
        });
        match started {
            Ok(worker) => {
                self.images
                    .as_mut()
                    .expect("thumbnail host")
                    .thumbnails
                    .active = Some((read, worker))
            }
            Err(error) => read.settle(Err(error)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn reload_releases_active_and_queued_readers_before_decode_finishes() {
        let (finish, release) = mpsc::channel();
        let worker = thread::spawn(move || {
            release
                .recv_timeout(std::time::Duration::from_secs(2))
                .unwrap();
            Ok(String::new())
        });
        let mut reads = ThumbnailReads::default();
        let mut receivers = Vec::new();
        for n in 0..2 {
            let (reply, pending) = mpsc::sync_channel(1);
            reads.queued.push_back(Read {
                session: "session".into(),
                filename: format!("asset-{n}"),
                sha256: "digest".into(),
                replies: vec![reply],
            });
            receivers.push(pending);
        }
        reads.active = Some((reads.queued.pop_front().unwrap(), worker));
        reads.cancel("staleGeneration");
        for pending in receivers {
            assert_eq!(
                pending.try_recv().unwrap().unwrap_err().0,
                "staleGeneration"
            );
        }
        assert!(reads.queued.is_empty());
        assert!(reads.active.as_ref().unwrap().0.replies.is_empty());
        finish.send(()).unwrap();
    }
}
