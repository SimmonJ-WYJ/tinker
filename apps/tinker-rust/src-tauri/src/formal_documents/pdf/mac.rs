use super::{DesktopError, Result};
use crate::formal_documents::{MAX_DOCUMENT_BYTES, MAX_PDF_BYTES, MAX_PDF_PAGES};
use std::{
    io::{Read, Write},
    os::unix::process::ExitStatusExt,
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};

const WORKER: &str = "--tinker-extract-pdf-pages";
const DEADLINE: Duration = Duration::from_secs(8);
const MAX_FOOTPRINT: u64 = 384 * 1024 * 1024;
const MAX_OUTPUT: usize = MAX_DOCUMENT_BYTES + MAX_PDF_PAGES * 4;
const UNAVAILABLE: DesktopError = DesktopError("pdfParserUnavailable");
const INVALID: DesktopError = DesktopError("invalidPdf");

unsafe extern "C" {
    fn tinker_pdf_pages(bytes: *const u8, len: usize, pages: usize, text: usize) -> i32;
}

/// 仅在专用子进程入口消费管道；宿主的其它入口继续正常初始化。
pub fn dispatch_worker() {
    if std::env::args_os().nth(1).is_some_and(|arg| arg == WORKER) {
        if std::env::args_os().len() != 2 {
            std::process::exit(4);
        }
        std::process::exit(worker());
    }
}

fn worker() -> i32 {
    // 限制单次解析的 CPU 时间。宿主另行监测物理内存和真实经过的时间。
    let cpu = libc::rlimit {
        rlim_cur: 5,
        rlim_max: 6,
    };
    if unsafe { libc::setrlimit(libc::RLIMIT_CPU, &cpu) } != 0 {
        return 4;
    }
    let mut input = Vec::new();
    if std::io::stdin()
        .take(MAX_PDF_BYTES as u64 + 1)
        .read_to_end(&mut input)
        .is_err()
    {
        return 4;
    }
    if input.len() > MAX_PDF_BYTES {
        return 3;
    }
    if !valid_envelope(&input) {
        return 1;
    }
    // 仅传在本调用内有效的不可变内存；框架写入有界页长及 UTF-8 正文。
    unsafe {
        tinker_pdf_pages(
            input.as_ptr(),
            input.len(),
            MAX_PDF_PAGES,
            MAX_DOCUMENT_BYTES,
        )
    }
}

// PDFKit 会尝试重建截断的 PDF。拒绝缺少尾部索引或索引明显无效的文件。
fn valid_envelope(input: &[u8]) -> bool {
    if !input.starts_with(b"%PDF-") {
        return false;
    }
    let Some(body) = input.trim_ascii_end().strip_suffix(b"%%EOF") else {
        return false;
    };
    let suffix = &body[body.len().saturating_sub(128)..];
    let Some(start) = suffix.windows(9).rposition(|s| s == b"startxref") else {
        return false;
    };
    let number = suffix[start + 9..].trim_ascii();
    if number.is_empty() || !number.iter().all(u8::is_ascii_digit) {
        return false;
    }
    let offset = std::str::from_utf8(number)
        .ok()
        .and_then(|s| s.parse::<usize>().ok());
    offset
        .and_then(|offset| body.get(offset..))
        .is_some_and(|xref| {
            xref.strip_prefix(b"xref")
                .is_some_and(|rest| rest.first().is_some_and(u8::is_ascii_whitespace))
                || xref_stream(xref)
        })
}

// PDF 1.5 的交叉引用流以间接对象头开头；偏移指向普通编号对象也不算有效索引。
fn xref_stream(input: &[u8]) -> bool {
    fn after_number(bytes: &[u8]) -> Option<&[u8]> {
        let end = bytes.iter().position(|b| !b.is_ascii_digit())?;
        (end > 0 && bytes[end].is_ascii_whitespace()).then(|| bytes[end..].trim_ascii_start())
    }
    let Some(dict) = after_number(input)
        .and_then(after_number)
        .and_then(|bytes| bytes.strip_prefix(b"obj"))
        .and_then(|bytes| bytes.trim_ascii_start().strip_prefix(b"<<"))
    else {
        return false;
    };
    let Some(end) = dict.windows(6).position(|b| b == b"stream") else {
        return false;
    };
    let header = &dict[..end];
    header.windows(5).enumerate().any(|(i, key)| {
        key == b"/Type"
            && header[i + 5..]
                .trim_ascii_start()
                .strip_prefix(b"/XRef")
                .is_some_and(|rest| {
                    rest.first()
                        .is_some_and(|b| b.is_ascii_whitespace() || b"/><[]%".contains(b))
                })
    })
}

struct Owned(Child);
impl Drop for Owned {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

pub(crate) fn extract_pages(input: &[u8]) -> Result<Vec<String>> {
    if input.len() > MAX_PDF_BYTES {
        return Err(DesktopError("documentTooLarge"));
    }
    if !valid_envelope(input) {
        return Err(INVALID);
    }
    let mut command = Command::new(std::env::current_exe().map_err(|_| UNAVAILABLE)?);
    command.env_clear();
    #[cfg(not(test))]
    command.arg(WORKER);
    #[cfg(test)]
    configure_test_worker(&mut command);
    let mut child = Owned(
        command
            .current_dir("/")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| UNAVAILABLE)?,
    );
    let mut stdin = child.0.stdin.take().ok_or(UNAVAILABLE)?;
    let stdout = child.0.stdout.take().ok_or(UNAVAILABLE)?;
    let output = std::thread::scope(|scope| -> Result<Vec<u8>> {
        let writer = scope.spawn(move || stdin.write_all(input));
        let reader = scope.spawn(move || {
            let mut output = Vec::new();
            stdout
                .take(MAX_OUTPUT as u64 + 1)
                .read_to_end(&mut output)?;
            Ok::<_, std::io::Error>(output)
        });
        // 所有退出路径先终止并回收子进程，再等待管道线程，避免挂死。
        let status = monitor(&mut child);
        drop(child);
        let status = status?;
        let code = match (status.code(), status.signal()) {
            (Some(0), _) => None,
            (Some(1), _) => Some(INVALID),
            (Some(2), _) => Some(DesktopError("pdfEncrypted")),
            (Some(3), _) => Some(DesktopError("documentTooLarge")),
            (_, Some(libc::SIGXCPU)) => Some(DesktopError("pdfParseTimeout")),
            _ => Some(UNAVAILABLE),
        };
        if let Some(error) = code {
            return Err(error);
        }
        writer
            .join()
            .map_err(|_| UNAVAILABLE)?
            .map_err(|_| UNAVAILABLE)?;
        reader
            .join()
            .map_err(|_| UNAVAILABLE)?
            .map_err(|_| UNAVAILABLE)
    })?;
    decode(&output)
}

fn monitor(child: &mut Owned) -> Result<std::process::ExitStatus> {
    let deadline = Instant::now() + DEADLINE;
    loop {
        if let Some(status) = child.0.try_wait().map_err(|_| UNAVAILABLE)? {
            return Ok(status);
        }
        if Instant::now() >= deadline {
            return Err(DesktopError("pdfParseTimeout"));
        }
        let mut usage = std::mem::MaybeUninit::<libc::rusage_info_v0>::uninit();
        // libproc 写满 v0 结构后返回 0。子进程可能刚好退出，由下一次 wait 回收。
        let sampled = unsafe {
            libc::proc_pid_rusage(
                child.0.id() as i32,
                libc::RUSAGE_INFO_V0,
                usage.as_mut_ptr().cast(),
            )
        };
        if sampled == 0 && unsafe { usage.assume_init().ri_phys_footprint } > MAX_FOOTPRINT {
            return Err(DesktopError("documentTooLarge"));
        }
        if sampled != 0 && std::io::Error::last_os_error().raw_os_error() != Some(libc::ESRCH) {
            return Err(UNAVAILABLE);
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn decode(mut input: &[u8]) -> Result<Vec<String>> {
    if input.len() > MAX_OUTPUT {
        return Err(DesktopError("documentTooLarge"));
    }
    let mut pages = Vec::new();
    let mut remaining = MAX_DOCUMENT_BYTES;
    while !input.is_empty() {
        let (prefix, rest) = input.split_at_checked(4).ok_or(INVALID)?;
        let len = u32::from_be_bytes(prefix.try_into().map_err(|_| INVALID)?) as usize;
        if len > remaining || pages.len() == MAX_PDF_PAGES {
            return Err(DesktopError("documentTooLarge"));
        }
        let (text, tail) = rest.split_at_checked(len).ok_or(INVALID)?;
        pages.push(std::str::from_utf8(text).map_err(|_| INVALID)?.to_owned());
        remaining -= len;
        input = tail;
    }
    if pages.is_empty() {
        return Err(INVALID);
    }
    if pages.iter().all(|s| s.trim().is_empty()) {
        return Err(DesktopError("pdfNoText"));
    }
    Ok(pages)
}

#[cfg(test)]
fn configure_test_worker(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    // libtest 自身在 stdout 打印标题；只在测试进程将专用管道保存在 fd 9。
    command.env("TINKER_PDF_UNIT_PIPE", "1");
    command.args([
        "--exact",
        "formal_documents::pdf::mac::pdf_worker_entry",
        "--ignored",
        "--nocapture",
    ]);
    unsafe {
        command.pre_exec(|| {
            if libc::dup2(1, 9) < 0 || libc::dup2(2, 1) < 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
}

#[cfg(test)]
#[test]
#[ignore = "Only runs as the PDF worker child with private pipes"]
fn pdf_worker_entry() {
    if std::env::var_os("TINKER_PDF_UNIT_PIPE").as_deref() != Some(std::ffi::OsStr::new("1")) {
        return;
    }
    assert!(unsafe { libc::dup2(9, 1) } >= 0);
    std::process::exit(worker());
}
