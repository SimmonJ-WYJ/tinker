//! 仅持有宿主新建合成文件的能力；模型路径从不进入文件系统 API。
use crate::{formal_platform::TrustedRoot, run_types::RunError, tool_types::*};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
};
const FIXTURES: [(&str, &str); 2] = [
    (
        "notes/intro.txt",
        "This is a synthetic workspace. Unicode fixture: café — 你好.\n",
    ),
    (
        "notes/steps.txt",
        "1. List synthetic notes.\n2. Read the intro.\n3. Return the verified contents.\n",
    ),
];
static NEXT: AtomicU64 = AtomicU64::new(0);
pub struct SyntheticWorkspace {
    files: Vec<Mutex<File>>,
    revision: String,
}
impl SyntheticWorkspace {
    pub fn create(root: &TrustedRoot) -> Result<Self, RunError> {
        root.validate().map_err(|_| RunError::UnsafePath)?;
        let revision = format!(
            "synthetic-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        );
        let path = root.path().join(&revision);
        let mut dir = fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            dir.mode(0o700);
        }
        dir.create(&path)?;
        dir.create(path.join("notes"))?;
        let mut files = Vec::new();
        for (name, content) in FIXTURES {
            let mut options = OpenOptions::new();
            options.create_new(true).read(true).write(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options.open(path.join(name))?;
            file.write_all(content.as_bytes())?;
            file.sync_all()?;
            files.push(Mutex::new(file));
        }
        File::open(path.join("notes"))?.sync_all()?;
        File::open(&path)?.sync_all()?;
        File::open(root.path())?.sync_all()?;
        Ok(Self { files, revision })
    }
}
impl ToolExecutor for SyntheticWorkspace {
    fn workspace_revision(&self) -> &str {
        &self.revision
    }
    fn catalog(&self) -> Vec<ToolSpec> {
        vec![
            ToolSpec {
                name: ToolName::WorkspaceList,
                description: "List files in the synthetic notes directory.".into(),
            },
            ToolSpec {
                name: ToolName::WorkspaceRead,
                description: "Read a synthetic notes file.".into(),
            },
        ]
    }
    fn execute(&self, call: &ToolCall, cancelled: &AtomicBool) -> Result<ToolResult, RunError> {
        call.validate()?;
        if cancelled.load(Ordering::Acquire) {
            return Err(RunError::ToolFailed);
        }
        let content = match call.name {
            ToolName::WorkspaceList if call.arguments.path == "notes" => FIXTURES
                .iter()
                .map(|(p, _)| *p)
                .collect::<Vec<_>>()
                .join("\n"),
            ToolName::WorkspaceRead => {
                let index = FIXTURES
                    .iter()
                    .position(|(name, _)| *name == call.arguments.path)
                    .ok_or(RunError::ToolArguments)?;
                let mut file = self.files[index].lock().map_err(|_| RunError::ToolFailed)?;
                if !file.metadata()?.is_file()
                    || file.metadata()?.len() != FIXTURES[index].1.len() as u64
                {
                    return Err(RunError::ToolFailed);
                }
                file.seek(SeekFrom::Start(0))?;
                let mut bytes = Vec::new();
                (&mut *file)
                    .take(MAX_TOOL_RESULT_BYTES as u64 + 1)
                    .read_to_end(&mut bytes)?;
                if bytes != FIXTURES[index].1.as_bytes() {
                    return Err(RunError::ToolFailed);
                }
                FIXTURES[index].1.to_owned()
            }
            _ => return Err(RunError::ToolArguments),
        };
        let result = ToolResult {
            call_id: call.call_id.clone(),
            outcome: ToolOutcome::Succeeded,
            content,
        };
        result.validate()?;
        Ok(result)
    }
}
