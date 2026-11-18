//! 只拥有自己启动的子进程；有限私有管道、清环境、统一截止和kill/reap。
use crate::desktop_runtime::protocol::{DesktopError, Result};
use std::{
    io::{Read, Write},
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};
struct Owned(Child);
impl Drop for Owned {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
#[cfg(unix)]
fn nonblocking(fd: std::os::fd::RawFd) -> Result<()> {
    unsafe extern "C" {
        fn fcntl(fd: i32, cmd: i32, ...) -> i32;
    }
    #[cfg(target_os = "macos")]
    const NONBLOCK: i32 = 4;
    #[cfg(not(target_os = "macos"))]
    const NONBLOCK: i32 = 2048;
    let flags = unsafe { fcntl(fd, 3) };
    if flags < 0 || unsafe { fcntl(fd, 4, flags | NONBLOCK) } < 0 {
        return Err(DesktopError("helperUnavailable"));
    }
    Ok(())
}
pub(crate) fn run(
    mode: &'static str,
    input: &[u8],
    max: usize,
    cancelled: &impl Fn() -> bool,
) -> Result<Vec<u8>> {
    let mut command =
        Command::new(std::env::current_exe().map_err(|_| DesktopError("helperUnavailable"))?);
    command.args(["--tinker-channels-helper", mode]);
    run_command(command, input, max, cancelled)
}
fn run_command(
    command: Command,
    input: &[u8],
    max: usize,
    cancelled: &impl Fn() -> bool,
) -> Result<Vec<u8>> {
    run_owned(command, input, max, cancelled, None)
}
#[cfg(target_os = "macos")]
pub(super) fn vault(input: &[u8], cancelled: &impl Fn() -> bool) -> Result<Vec<u8>> {
    if !NATIVE_ROLE.load(std::sync::atomic::Ordering::Acquire) {
        return Err(DesktopError("helperUnauthorized"));
    }
    let mut command =
        Command::new(std::env::current_exe().map_err(|_| DesktopError("helperUnavailable"))?);
    command.args(["--tinker-channels-helper", "vault"]);
    run_owned(
        command,
        input,
        65536,
        cancelled,
        Some(super::catalog::random_reference()?),
    )
}
static NATIVE_ROLE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
pub(crate) fn enter_native_role() {
    NATIVE_ROLE.store(true, std::sync::atomic::Ordering::Release);
}
pub(crate) fn is_native_role() -> bool {
    NATIVE_ROLE.load(std::sync::atomic::Ordering::Acquire)
}
#[cfg(unix)]
fn run_owned(
    command: Command,
    input: &[u8],
    max: usize,
    cancelled: &impl Fn() -> bool,
    handshake: Option<String>,
) -> Result<Vec<u8>> {
    run_owned_with_validation(
        command,
        input,
        max,
        cancelled,
        handshake,
        &super::validation::validate,
    )
}
#[cfg(unix)]
fn run_owned_with_validation(
    mut command: Command,
    input: &[u8],
    max: usize,
    cancelled: &impl Fn() -> bool,
    handshake: Option<String>,
    validate: &impl Fn(i32, Instant, &dyn Fn() -> bool) -> Result<()>,
) -> Result<Vec<u8>> {
    use std::os::fd::AsRawFd;
    if input.len() > 65536 || max > 65536 {
        return Err(DesktopError("helperLimit"));
    }
    if cancelled() {
        return Err(DesktopError("staleGeneration"));
    }
    let deadline = Instant::now() + Duration::from_secs(2);
    let mut child = Owned(
        command
            .env_clear()
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| DesktopError("helperUnavailable"))?,
    );
    let writer = child
        .0
        .stdin
        .take()
        .ok_or(DesktopError("helperUnavailable"))?;
    let mut reader = child
        .0
        .stdout
        .take()
        .ok_or(DesktopError("helperUnavailable"))?;
    nonblocking(writer.as_raw_fd())?;
    nonblocking(reader.as_raw_fd())?;
    let hello = handshake.as_ref().map(|n| format!("{n}\n").into_bytes());
    let mut handshaken = hello.is_none();
    let mut received_hello = Vec::new();
    let mut offset = 0;
    let mut output = Vec::new();
    let mut writer = Some(writer);
    let mut eof = false;
    loop {
        if cancelled() {
            return Err(DesktopError("staleGeneration"));
        }
        if Instant::now() >= deadline {
            return Err(DesktopError("helperTimeout"));
        }
        let payload = if handshaken {
            input
        } else {
            hello.as_deref().ok_or(DesktopError("helperUnauthorized"))?
        };
        if let Some(w) = writer.as_mut() {
            if offset < payload.len() {
                match w.write(&payload[offset..]) {
                    Ok(n) => offset += n,
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                    Err(_) => return Err(DesktopError("helperUnavailable")),
                }
            }
            if offset == payload.len() && handshaken {
                writer = None;
            }
        }
        let mut buffer = [0u8; 1024];
        match reader.read(&mut buffer) {
            Ok(0) => eof = true,
            Ok(n) => {
                if !handshaken {
                    received_hello.extend_from_slice(&buffer[..n]);
                    let expected = hello.as_ref().ok_or(DesktopError("helperUnauthorized"))?;
                    if received_hello.len() > expected.len()
                        || !expected.starts_with(&received_hello)
                    {
                        return Err(DesktopError("helperUnauthorized"));
                    }
                    if received_hello == *expected {
                        validate(child.0.id() as i32, deadline, cancelled)?;
                        if cancelled() {
                            return Err(DesktopError("staleGeneration"));
                        }
                        if Instant::now() >= deadline {
                            return Err(DesktopError("helperTimeout"));
                        }
                        handshaken = true;
                        offset = 0;
                    }
                } else {
                    if output.len() + n > max {
                        return Err(DesktopError("helperLimit"));
                    }
                    output.extend_from_slice(&buffer[..n]);
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(_) => return Err(DesktopError("helperUnavailable")),
        }
        if let Some(status) = child
            .0
            .try_wait()
            .map_err(|_| DesktopError("helperUnavailable"))?
        {
            if !status.success() {
                return Err(DesktopError("helperUnavailable"));
            }
            if eof {
                return Ok(output);
            }
        }
        std::thread::sleep(Duration::from_millis(2));
    }
}
#[cfg(not(unix))]
fn run_owned(
    _command: Command,
    _input: &[u8],
    _max: usize,
    _cancelled: &impl Fn() -> bool,
    _handshake: Option<String>,
) -> Result<Vec<u8>> {
    Err(DesktopError("unsupportedPlatform"))
}
/// 必须在任何Tauri初始化前调用；无任意路径/程序/服务分派，未知模式直接退出。
pub fn dispatch() -> bool {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.first().is_none_or(|a| a != "--tinker-channels-helper") {
        return false;
    }
    let result = (|| {
        if args.len() != 2 {
            return Err(DesktopError("helperUnauthorized"));
        }
        if args[1] == "vault" {
            #[cfg(target_os = "macos")]
            {
                return super::vault_host::child();
            }
            #[cfg(not(target_os = "macos"))]
            {
                return Err(DesktopError("helperUnauthorized"));
            }
        }
        if args[1] != "resolve" {
            return Err(DesktopError("helperUnauthorized"));
        }
        let mut input = Vec::new();
        std::io::stdin()
            .take(65537)
            .read_to_end(&mut input)
            .map_err(|_| DesktopError("helperUnavailable"))?;
        if input.len() > 65536 {
            return Err(DesktopError("helperLimit"));
        }
        let output = super::resolver::child(&input)?;
        std::io::stdout()
            .write_all(&output)
            .map_err(|_| DesktopError("helperUnavailable"))
    })();
    std::process::exit(if result.is_ok() { 0 } else { 64 });
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore]
    fn owned_child_entry() {
        let mut b = Vec::new();
        std::io::stdin().read_to_end(&mut b).unwrap();
        match b.as_slice() {
            b"hang" => std::thread::sleep(Duration::from_secs(30)),
            b"flood" => {
                let _ = std::io::stdout().write_all(&vec![b'x'; 131072]);
            }
            b"exit" => std::process::exit(31),
            _ => {
                let _ = std::io::stdout().write_all(b"owned-ok");
            }
        }
    }
    fn fixture() -> Command {
        let mut c = Command::new(std::env::current_exe().unwrap());
        c.args([
            "--exact",
            "credentialed_channels::process::tests::owned_child_entry",
            "--ignored",
            "--nocapture",
        ]);
        c
    }
    #[test]
    fn owns_deadline_flood_wrong_exit_and_cancel() {
        let start = Instant::now();
        assert!(matches!(
            run_command(fixture(), b"hang", 65536, &|| false),
            Err(DesktopError("helperTimeout"))
        ));
        assert!(start.elapsed() < Duration::from_secs(3));
        assert!(matches!(
            run_command(fixture(), b"flood", 1024, &|| false),
            Err(DesktopError("helperLimit"))
        ));
        assert!(matches!(
            run_command(fixture(), b"exit", 65536, &|| false),
            Err(DesktopError("helperUnavailable"))
        ));
        let start = Instant::now();
        assert!(matches!(
            run_command(fixture(), b"hang", 65536, &|| start.elapsed()
                > Duration::from_millis(50)),
            Err(DesktopError("staleGeneration"))
        ));
        assert!(start.elapsed() < Duration::from_secs(1));
        assert!(
            String::from_utf8(run_command(fixture(), b"ok", 65536, &|| false).unwrap())
                .unwrap()
                .contains("owned-ok")
        );
    }
}

#[cfg(all(test, unix))]
#[path = "process_fixture.rs"]
pub(crate) mod fixture;
