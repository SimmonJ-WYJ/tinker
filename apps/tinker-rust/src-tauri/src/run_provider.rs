//! 可替换的执行提供者与默认离线片段；可信宿主负责选择实现。
use crate::run_types::{OfflineScenario, RunError};
use std::{
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::Duration,
};
/// 受信任的同步实现；应轮询取消令牌并传播sink错误。宿主负责配置实现。
pub trait RunProvider: Send + Sync {
    fn execute_tool_round(
        &self,
        _context: &crate::tool_types::ToolContext,
        _tools: &[crate::tool_types::ToolSpec],
        _cancelled: &AtomicBool,
        _remaining: Duration,
        _emit: &mut dyn FnMut(&str) -> Result<(), RunError>,
    ) -> Result<crate::tool_types::ToolRoundOutput, RunError> {
        Err(RunError::ContextUnsupported)
    }
    fn validate_tool_result(
        &self,
        _result: &crate::tool_types::ToolResult,
    ) -> Result<(), RunError> {
        Ok(())
    }

    fn execute_context(
        &self,
        context: &crate::run_context::RunContext,
        cancelled: &AtomicBool,
        emit: &mut dyn FnMut(&str) -> Result<(), RunError>,
    ) -> Result<(), RunError> {
        match context.messages() {
            [message] if message.role == crate::run_context::ChatRole::User => {
                self.execute(&message.content, cancelled, emit)
            }
            _ => Err(RunError::ContextUnsupported),
        }
    }

    fn execute(
        &self,
        input: &str,
        cancelled: &AtomicBool,
        emit: &mut dyn FnMut(&str) -> Result<(), RunError>,
    ) -> Result<(), RunError>;
}
#[derive(Debug)]
pub struct OfflineFixture {
    scenario: OfflineScenario,
}
impl OfflineFixture {
    pub fn new(scenario: OfflineScenario) -> Self {
        Self { scenario }
    }
}
impl RunProvider for OfflineFixture {
    fn execute(
        &self,
        _input: &str,
        cancelled: &AtomicBool,
        emit: &mut dyn FnMut(&str) -> Result<(), RunError>,
    ) -> Result<(), RunError> {
        let scenario = self.scenario;
        let fragments = [
            "[offline fixture] ",
            "This is a local test. ",
            "No model or network was used.",
        ];
        for (index, fragment) in fragments.iter().enumerate() {
            let steps = if scenario == OfflineScenario::Slow {
                200
            } else {
                30
            };
            for _ in 0..steps {
                if cancelled.load(Ordering::Acquire) {
                    return Ok(());
                }
                thread::sleep(Duration::from_millis(5));
            }
            if cancelled.load(Ordering::Acquire) {
                return Ok(());
            }
            emit(fragment)?;
            if scenario == OfflineScenario::Failure && index == 0 {
                return Err(RunError::OfflineFixtureFailed);
            }
        }
        Ok(())
    }
}
