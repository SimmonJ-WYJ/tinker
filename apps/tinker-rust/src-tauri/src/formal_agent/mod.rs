//! 常驻适配actor只调同一个Arc<DesktopRuntime>；不持有第二套执行或journal。
mod actor;
mod channels;
mod delivery;
pub mod projection;
pub mod protocol;
use crate::{
    desktop_runtime::{
        protocol::{DesktopError, Result},
        DesktopRuntime,
    },
    formal_platform::{FormalPlatform, HostEnvironment, TrustedRoot},
};
use protocol::{Command, EventEnvelope};
use serde_json::Value;
use std::{
    sync::{
        mpsc::{self, Receiver, SyncSender, TryRecvError},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::Duration,
};
pub const COMMAND_CAPACITY: usize = 64;
pub const EVENT_CAPACITY: usize = 256;
pub const RESTORE_TIMEOUT: Duration = Duration::from_secs(5);
pub struct PendingReply {
    rx: Receiver<Result<Value>>,
}
impl PendingReply {
    /// 在Tauri spawn_blocking任务中等待；绝不能在UI线程调用。
    pub fn wait(self, timeout: Duration) -> Result<Value> {
        self.rx
            .recv_timeout(timeout)
            .map_err(|_| DesktopError("transportTimeout"))?
    }
    pub fn try_result(&self) -> Option<Result<Value>> {
        match self.rx.try_recv() {
            Ok(r) => Some(r),
            Err(TryRecvError::Empty) => None,
            Err(TryRecvError::Disconnected) => Some(Err(DesktopError("hostClosed"))),
        }
    }
}
type Reply = SyncSender<Result<Value>>;
enum Message {
    Call(Command, Reply),
    Environment(HostEnvironment, Reply),
    Shutdown(Reply),
}
pub struct FormalAgentHost {
    tx: SyncSender<Message>,
    events: Mutex<Receiver<EventEnvelope>>,
    worker: Option<JoinHandle<()>>,
}
impl FormalAgentHost {
    pub fn new(
        runtime: Arc<DesktopRuntime>,
        platform: FormalPlatform,
        root: TrustedRoot,
    ) -> Result<Self> {
        let (tx, rx) = mpsc::sync_channel(COMMAND_CAPACITY);
        let (out, events) = mpsc::sync_channel(EVENT_CAPACITY);
        let worker = thread::Builder::new()
            .name("formal-agent".into())
            .spawn(move || actor::Actor::new(runtime, platform, root, out).run(rx))
            .map_err(|_| DesktopError("hostUnavailable"))?;
        Ok(Self {
            tx,
            events: Mutex::new(events),
            worker: Some(worker),
        })
    }
    pub fn command(&self, window: &str, value: Value) -> Result<PendingReply> {
        if window != "main" {
            return Err(DesktopError("invalidWindow"));
        }
        if serde_json::to_vec(&value)
            .map_err(|_| DesktopError("invalidEnvelope"))?
            .len()
            > 128 * 1024
        {
            return Err(DesktopError("frameTooLarge"));
        }
        let command: Command =
            serde_json::from_value(value).map_err(|_| DesktopError("invalidEnvelope"))?;
        let (tx, rx) = mpsc::sync_channel(1);
        self.tx
            .try_send(Message::Call(command, tx))
            .map_err(|e| match e {
                mpsc::TrySendError::Full(_) => DesktopError("hostBusy"),
                mpsc::TrySendError::Disconnected(_) => DesktopError("hostClosed"),
            })?;
        Ok(PendingReply { rx })
    }
    /// 原生窗口环境只能从可信宿主更新，不在renderer命令allowlist中。
    pub fn set_host_environment(&self, environment: HostEnvironment) -> Result<PendingReply> {
        let (tx, rx) = mpsc::sync_channel(1);
        self.tx
            .try_send(Message::Environment(environment, tx))
            .map_err(|_| DesktopError("hostUnavailable"))?;
        Ok(PendingReply { rx })
    }
    pub fn next_event(&self, timeout: Duration) -> Option<EventEnvelope> {
        self.events.lock().ok()?.recv_timeout(timeout).ok()
    }
    /// 必须在后台退出任务调用；先durable cancel，再回收actor，最后释放runtime写锁。
    pub fn shutdown(&mut self) -> Result<()> {
        if let Some(worker) = self.worker.take() {
            let (tx, rx) = mpsc::sync_channel(1);
            let sent = self.tx.send(Message::Shutdown(tx)).is_ok();
            let outcome = if sent {
                rx.recv_timeout(Duration::from_secs(10))
                    .map_err(|_| DesktopError("transportTimeout"))
                    .and_then(|result| result)
            } else {
                Ok(Value::Null)
            };
            worker.join().map_err(|_| DesktopError("hostUnavailable"))?;
            outcome?;
        }
        Ok(())
    }
}
impl Drop for FormalAgentHost {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shutdown_propagates_actor_durable_cancel_failure_after_join() {
        let (tx, rx) = mpsc::sync_channel(1);
        let (_out, events) = mpsc::sync_channel(1);
        let worker = thread::spawn(move || {
            if let Message::Shutdown(reply) = rx.recv().unwrap() {
                reply.send(Err(DesktopError("storeIo"))).unwrap();
            } else {
                panic!("预期shutdown请求");
            }
        });
        let mut host = FormalAgentHost {
            tx,
            events: Mutex::new(events),
            worker: Some(worker),
        };
        assert_eq!(host.shutdown().unwrap_err().0, "storeIo");
        assert!(host.worker.is_none());
    }
}
