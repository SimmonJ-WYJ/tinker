//! 固定实验目录中的只读历史服务，不扫描 Electron 数据，不接受前端文件路径。
use crate::{
    sdk_history::{read_sdk_history, SDKHistoryPage},
    session_history::{HistoryError, HistoryOptions},
};
use std::{
    fs::{self, File},
    io::BufReader,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, TryLockError},
};

pub const HISTORY_DIRECTORY: &str = "history-v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HistoryReadError {
    NotFound,
    UnsafePath,
    Unavailable,
    Busy,
    InvalidOptions,
    Corrupt,
    InvalidMessage,
    TooLarge,
}
impl HistoryReadError {
    pub fn code(self) -> &'static str {
        match self {
            Self::NotFound => "historyNotFound",
            Self::UnsafePath => "historyUnsafePath",
            Self::Unavailable => "historyUnavailable",
            Self::Busy => "historyBusy",
            Self::InvalidOptions => "historyInvalidOptions",
            Self::Corrupt => "historyCorrupt",
            Self::InvalidMessage => "historyInvalidMessage",
            Self::TooLarge => "historyTooLarge",
        }
    }
}
impl From<HistoryError> for HistoryReadError {
    fn from(error: HistoryError) -> Self {
        match error {
            HistoryError::InvalidOptions => Self::InvalidOptions,
            HistoryError::Io { .. } => Self::Unavailable,
            HistoryError::LineTooLarge { .. } => Self::TooLarge,
            HistoryError::Corrupt { .. } => Self::Corrupt,
            HistoryError::InvalidMessage { .. } => Self::InvalidMessage,
        }
    }
}
fn io_error(error: std::io::Error) -> HistoryReadError {
    if error.kind() == std::io::ErrorKind::NotFound {
        HistoryReadError::NotFound
    } else {
        HistoryReadError::Unavailable
    }
}

#[derive(Clone)]
pub struct HistoryLibrary {
    root: PathBuf,
    gate: Arc<Mutex<()>>,
}
impl HistoryLibrary {
    /// 根路径只能由桌面主进程构造。本函数不会创建目录或写入历史。
    pub fn new(root: impl AsRef<Path>) -> Self {
        Self {
            root: root.as_ref().into(),
            gate: Arc::new(Mutex::new(())),
        }
    }
    pub fn read(
        &self,
        session_id: &str,
        options: HistoryOptions,
    ) -> Result<SDKHistoryPage, HistoryReadError> {
        if session_id.is_empty()
            || session_id.len() > 64
            || !session_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
        {
            return Err(HistoryReadError::InvalidOptions);
        }
        let _guard = self.gate.try_lock().map_err(|error| match error {
            TryLockError::WouldBlock => HistoryReadError::Busy,
            TryLockError::Poisoned(_) => HistoryReadError::Unavailable,
        })?;
        let root_meta = fs::symlink_metadata(&self.root).map_err(io_error)?;
        if !root_meta.is_dir() || root_meta.file_type().is_symlink() {
            return Err(HistoryReadError::UnsafePath);
        }
        let root = self.root.canonicalize().map_err(io_error)?;
        let path = root.join(format!("{session_id}.jsonl"));
        let meta = fs::symlink_metadata(&path).map_err(io_error)?;
        if !meta.is_file() || meta.file_type().is_symlink() {
            return Err(HistoryReadError::UnsafePath);
        }
        if path.canonicalize().map_err(io_error)?.parent() != Some(root.as_path()) {
            return Err(HistoryReadError::UnsafePath);
        }
        let file = File::open(path).map_err(io_error)?;
        read_sdk_history(BufReader::new(file), options).map_err(Into::into)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn concurrent_reads_fail_without_waiting_or_expanding_decode_memory() {
        let library = HistoryLibrary::new("fixture-directory-not-opened");
        let _held = library.gate.lock().unwrap();
        assert_eq!(
            library
                .clone()
                .read("fixture", HistoryOptions::default())
                .unwrap_err(),
            HistoryReadError::Busy
        );
    }
}
