//! 可替换的执行提供者与默认离线片段；可信宿主负责选择实现。
use crate::run_types::{OfflineScenario, RunError};
use std::{
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::Duration,
};
/// 受信任的同步实现；必须轮询取消令牌、遵守 remaining 总时限并立即传播 sink 错误。
/// 取消或错误后不得继续提交片段或启动网络；宿主负责配置实现，不能注入不受信代码。
pub trait RunProvider: Send + Sync {
    /// 结构化宿主元数据的秘密检查；不把元数据伪装成模型用户上下文。
    fn validate_tool_metadata(&self, _metadata: &serde_json::Value) -> Result<(), RunError> {
        Ok(())
    }

    fn validate_tool_context(
        &self,
        _context: &crate::tool_types::ToolContext,
        _tools: &[crate::tool_types::ToolSpec],
    ) -> Result<(), RunError> {
        Ok(())
    }
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
    /// 纯校验累计可见输出；在 TextDelta 持久化和发布前调用。
    fn validate_tool_output(&self, _output: &str) -> Result<(), RunError> {
        Ok(())
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
