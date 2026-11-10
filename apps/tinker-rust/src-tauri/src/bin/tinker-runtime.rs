//! 可信宿主启动的JSONL进程。stdout仅协议，任何失败只输出固定stderr码。
use std::{
    fs::File,
    io::{self, BufRead, Read, Write},
    path::Path,
};
use tinker_rust_foundation::desktop_runtime::{
    protocol::{DesktopError, MAX_FRAME_BYTES},
    DesktopRuntime, TrustedProfile,
};
fn configuration(path: &Path) -> Result<Vec<TrustedProfile>, DesktopError> {
    let metadata = std::fs::symlink_metadata(path)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 256 * 1024 {
        return Err(DesktopError("invalidProfile"));
    }
    let mut bytes = Vec::new();
    File::open(path)?
        .take(256 * 1024 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > 256 * 1024 {
        return Err(DesktopError("invalidProfile"));
    }
    serde_json::from_slice(&bytes).map_err(|_| DesktopError("invalidProfile"))
}
fn run() -> Result<(), DesktopError> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.len() != 4 || args[0] != "--root" || args[2] != "--profiles-file" {
        return Err(DesktopError("invalidLaunch"));
    }
    let root = Path::new(&args[1]);
    if !root.is_absolute() {
        return Err(DesktopError("invalidLaunch"));
    }
    let profiles = configuration(Path::new(&args[3]))?;
    let runtime = DesktopRuntime::open(root, profiles)?;
    let stdin = io::stdin();
    let mut input = stdin.lock();
    let stdout = io::stdout();
    let mut output = stdout.lock();
    loop {
        // take在读取前截断预算，避免read_until先分配无限行。
        let mut frame = Vec::new();
        let size = (&mut input)
            .take(MAX_FRAME_BYTES as u64 + 2)
            .read_until(b'\n', &mut frame)?;
        if size == 0 {
            return Ok(());
        }
        if size > MAX_FRAME_BYTES + 1 {
            return Err(DesktopError("frameTooLarge"));
        }
        if frame.pop() != Some(b'\n') {
            return Err(DesktopError("truncatedFrame"));
        }
        if frame.len() > MAX_FRAME_BYTES {
            return Err(DesktopError("frameTooLarge"));
        }
        let value = serde_json::from_slice(&frame).map_err(|_| DesktopError("invalidEnvelope"))?;
        let reply = runtime.dispatch(value)?;
        let bytes = serde_json::to_vec(&reply).map_err(|_| DesktopError("transportError"))?;
        if bytes.len() > MAX_FRAME_BYTES {
            return Err(DesktopError("frameTooLarge"));
        }
        output.write_all(&bytes)?;
        output.write_all(b"\n")?;
        output.flush()?;
    }
}
fn main() {
    std::panic::set_hook(Box::new(|_| eprintln!("runtimePanicked")));
    if let Err(e) = run() {
        eprintln!("{}", e.0);
        std::process::exit(1);
    }
}
