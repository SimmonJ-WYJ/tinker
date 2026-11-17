//! 只供测试的owned私有管道服务；不执行Security或Keychain，记录PID和收到的字节数。
use super::*;
use crate::credentialed_channels::validation::Gate;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};
static NEXT: AtomicU64 = AtomicU64::new(0);
pub(crate) struct Fixture {
    path: PathBuf,
}
impl Fixture {
    pub(crate) fn new() -> Self {
        use std::os::unix::fs::DirBuilderExt;
        let path = std::env::temp_dir().join(format!(
            "tinker-owned-validation-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::DirBuilder::new()
            .mode(0o700)
            .create(&path)
            .unwrap();
        Self { path }
    }
    pub(crate) fn run(
        &self,
        gate: &Arc<Gate>,
        cancelled: &impl Fn() -> bool,
        check: fn(i32) -> Result<()>,
    ) -> Result<Vec<u8>> {
        let code = r#"import os,sys
root=sys.argv[1]
open(root+'/pid','w').write(str(os.getpid()))
nonce=sys.stdin.buffer.readline()
sys.stdout.buffer.write(nonce);sys.stdout.buffer.flush()
n=0
while True:
 b=os.read(0,1024)
 if not b: break
 n+=len(b)
 open(root+'/received-count','w').write(str(n))
sys.stdout.buffer.write(b'owned-ok');sys.stdout.buffer.flush()
"#;
        let mut command = Command::new("/usr/bin/python3");
        command.args(["-I", "-c", code]).arg(&self.path);
        super::run_owned_with_validation(
            command,
            b"finite-private-input",
            65536,
            cancelled,
            Some("a".repeat(32)),
            &|pid, deadline, cancel| gate.verify(pid, deadline, cancel, check),
        )
    }
    pub(crate) fn assert_reaped_without_input(&self) {
        let pid: i32 = std::fs::read_to_string(self.path.join("pid"))
            .unwrap()
            .parse()
            .unwrap();
        unsafe extern "C" {
            fn kill(pid: i32, signal: i32) -> i32;
            fn waitpid(pid: i32, status: *mut i32, options: i32) -> i32;
        }
        assert_eq!(
            unsafe { kill(pid, 0) },
            -1,
            "owned child must no longer be alive"
        );
        let mut status = 0;
        assert_eq!(
            unsafe { waitpid(pid, &mut status, 1) },
            -1,
            "owned child must already be reaped"
        );
        assert!(
            !self.path.join("received-count").exists(),
            "validation failure must send no private input"
        );
    }
}
fn delayed(_: i32) -> Result<()> {
    std::thread::sleep(Duration::from_millis(3500));
    Ok(())
}
#[test]
fn review_stalled_validation_must_not_escape_owned_deadline() {
    let f = Fixture::new();
    let started = Instant::now();
    assert!(matches!(
        f.run(&Gate::new(), &|| false, delayed),
        Err(DesktopError("helperTimeout"))
    ));
    f.assert_reaped_without_input();
    assert!(
        started.elapsed() < Duration::from_secs(3),
        "metadata validator must not block supervisor deadline"
    );
}

static RELEASE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static CALLS: AtomicU64 = AtomicU64::new(0);
fn held(_: i32) -> Result<()> {
    CALLS.fetch_add(1, Ordering::SeqCst);
    while !RELEASE.load(Ordering::Acquire) {
        std::thread::sleep(Duration::from_millis(2));
    }
    Ok(())
}
fn valid(_: i32) -> Result<()> {
    Ok(())
}
struct ReleaseOnDrop;
impl Drop for ReleaseOnDrop {
    fn drop(&mut self) {
        RELEASE.store(true, Ordering::Release);
    }
}
#[test]
fn review_cancelled_validator_keeps_cap_and_late_result_cannot_authorize() {
    RELEASE.store(false, Ordering::Release);
    CALLS.store(0, Ordering::Release);
    let _release = ReleaseOnDrop;
    let gate = Gate::new();
    let f = Fixture::new();
    let started = Instant::now();
    assert!(matches!(
        f.run(
            &gate,
            &|| started.elapsed() > Duration::from_millis(200),
            held
        ),
        Err(DesktopError("staleGeneration"))
    ));
    assert!(started.elapsed() < Duration::from_secs(1));
    f.assert_reaped_without_input();
    assert!(gate.occupied());
    for _ in 0..5 {
        let before = Instant::now();
        assert!(matches!(
            gate.verify(1, Instant::now() + Duration::from_secs(2), &|| false, held),
            Err(DesktopError("helperBusy"))
        ));
        assert!(before.elapsed() < Duration::from_millis(100));
    }
    assert_eq!(CALLS.load(Ordering::Acquire), 1);
    RELEASE.store(true, Ordering::Release);
    let deadline = Instant::now() + Duration::from_secs(1);
    while gate.occupied() {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(2));
    }
    f.assert_reaped_without_input();
    assert_eq!(
        Fixture::new().run(&gate, &|| false, valid).unwrap(),
        b"owned-ok"
    );
}
