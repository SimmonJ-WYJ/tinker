//! 单次执行的可验证迁移契约，不执行模型、工具或真实后台任务。
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RunStatus {
    Queued,
    Running,
    WaitingInput,
    Completed,
    Failed,
    Cancelled,
    Interrupted,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunEvent {
    Start,
    WaitForInput,
    Continue,
    Complete,
    Fail,
    Cancel,
    Interrupt,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LifecycleError {
    InvalidRunId,
    UnsupportedVersion,
    RunMismatch,
    InvalidTransition,
}
impl std::fmt::Display for LifecycleError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}
impl std::error::Error for LifecycleError {}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", try_from = "RunSnapshot")]
pub struct RunState {
    schema_version: u32,
    run_id: String,
    status: RunStatus,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RunSnapshot {
    schema_version: u32,
    run_id: String,
    status: RunStatus,
}

impl TryFrom<RunSnapshot> for RunState {
    type Error = LifecycleError;
    fn try_from(value: RunSnapshot) -> Result<Self, Self::Error> {
        if value.schema_version != 1 {
            return Err(LifecycleError::UnsupportedVersion);
        }
        let mut state = Self::queued(&value.run_id)?;
        state.status = value.status;
        Ok(state)
    }
}

impl RunState {
    pub fn queued(run_id: &str) -> Result<Self, LifecycleError> {
        if run_id.is_empty()
            || run_id.len() > 128
            || !run_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        {
            return Err(LifecycleError::InvalidRunId);
        }
        Ok(Self {
            schema_version: 1,
            run_id: run_id.into(),
            status: RunStatus::Queued,
        })
    }
    pub fn status(&self) -> RunStatus {
        self.status
    }
    pub fn run_id(&self) -> &str {
        &self.run_id
    }
    pub fn apply(&mut self, run_id: &str, event: RunEvent) -> Result<(), LifecycleError> {
        if run_id != self.run_id {
            return Err(LifecycleError::RunMismatch);
        }
        let next = match (self.status, event) {
            (RunStatus::Queued, RunEvent::Start) => RunStatus::Running,
            (RunStatus::Running, RunEvent::WaitForInput) => RunStatus::WaitingInput,
            (RunStatus::WaitingInput, RunEvent::Continue) => RunStatus::Running,
            (RunStatus::Running, RunEvent::Complete) => RunStatus::Completed,
            (RunStatus::Running | RunStatus::WaitingInput, RunEvent::Fail) => RunStatus::Failed,
            (
                RunStatus::Queued | RunStatus::Running | RunStatus::WaitingInput,
                RunEvent::Cancel,
            ) => RunStatus::Cancelled,
            (
                RunStatus::Queued | RunStatus::Running | RunStatus::WaitingInput,
                RunEvent::Interrupt,
            ) => RunStatus::Interrupted,
            _ => return Err(LifecycleError::InvalidTransition),
        };
        self.status = next;
        Ok(())
    }
    /// 崩溃后不得将未完成执行伪装为成功或自动重放可能计费的副作用。
    pub fn restore(&mut self) {
        if matches!(self.status, RunStatus::Running | RunStatus::WaitingInput) {
            self.status = RunStatus::Interrupted;
        }
    }
}
