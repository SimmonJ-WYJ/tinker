//! 最多一个metadata-only验证线程；监督者不等待卡住的Security调用，也不回收其占位。
use crate::desktop_runtime::protocol::{DesktopError, Result};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, OnceLock,
    },
    time::{Duration, Instant},
};
struct Job {
    pid: i32,
    check: fn(i32) -> Result<()>,
    reply: mpsc::SyncSender<Result<()>>,
}
pub(crate) struct Gate {
    occupied: Arc<AtomicBool>,
    jobs: mpsc::SyncSender<Job>,
}
impl Gate {
    pub(crate) fn new() -> Arc<Self> {
        let occupied = Arc::new(AtomicBool::new(false));
        let busy = occupied.clone();
        let (jobs, incoming) = mpsc::sync_channel::<Job>(1);
        // 全局Gate仅初始化一次：固定一个metadata线程，不在超时后创建替代线程。
        // 任务只有PID/固定函数指针/有界结果通道；不拥有秘密、子进程或写管道。
        // 不保存JoinHandle，关闭不join卡住的Security调用。
        let _ = std::thread::Builder::new()
            .name("channels-code-validation".into())
            .spawn(move || {
                while let Ok(job) = incoming.recv() {
                    let _ = job.reply.send((job.check)(job.pid));
                    busy.store(false, Ordering::Release);
                }
            });
        Arc::new(Self { occupied, jobs })
    }
    pub(crate) fn verify(
        self: &Arc<Self>,
        pid: i32,
        deadline: Instant,
        cancelled: &dyn Fn() -> bool,
        check: fn(i32) -> Result<()>,
    ) -> Result<()> {
        if cancelled() {
            return Err(DesktopError("staleGeneration"));
        }
        if Instant::now() >= deadline {
            return Err(DesktopError("helperTimeout"));
        }
        self.occupied
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| DesktopError("helperBusy"))?;
        let (tx, rx) = mpsc::sync_channel(1);
        match self.jobs.try_send(Job {
            pid,
            check,
            reply: tx,
        }) {
            Ok(()) => {}
            Err(mpsc::TrySendError::Disconnected(_)) => {
                self.occupied.store(false, Ordering::Release);
                return Err(DesktopError("helperUnavailable"));
            }
            Err(mpsc::TrySendError::Full(_)) => return Err(DesktopError("helperBusy")),
        }
        loop {
            if cancelled() {
                return Err(DesktopError("staleGeneration"));
            }
            let remaining = deadline
                .checked_duration_since(Instant::now())
                .filter(|d| !d.is_zero())
                .ok_or(DesktopError("helperTimeout"))?;
            match rx.recv_timeout(remaining.min(Duration::from_millis(2))) {
                Ok(result) => {
                    if cancelled() {
                        return Err(DesktopError("staleGeneration"));
                    }
                    if Instant::now() >= deadline {
                        return Err(DesktopError("helperTimeout"));
                    }
                    return result;
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return Err(DesktopError("helperUnavailable"))
                }
            }
        }
    }
    #[cfg(test)]
    pub(crate) fn occupied(&self) -> bool {
        self.occupied.load(Ordering::Acquire)
    }
}
pub(super) fn validate(pid: i32, deadline: Instant, cancelled: &dyn Fn() -> bool) -> Result<()> {
    static GATE: OnceLock<Arc<Gate>> = OnceLock::new();
    #[cfg(target_os = "macos")]
    {
        GATE.get_or_init(Gate::new)
            .verify(pid, deadline, cancelled, super::auth_macos::same_code)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (pid, deadline, cancelled, &GATE);
        Err(DesktopError("helperUnauthorized"))
    }
}
