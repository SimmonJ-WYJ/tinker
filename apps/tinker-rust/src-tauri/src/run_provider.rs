//! 可替换的离线片段提供者；唯一实现不执行网络、shell或模型调用。
use crate::run_types::{OfflineScenario, RunError};
use std::{
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::Duration,
};
pub trait RunProvider: Send + Sync {
    fn execute(
        &self,
        input: &str,
        scenario: OfflineScenario,
        cancelled: &AtomicBool,
        emit: &mut dyn FnMut(&str) -> Result<(), RunError>,
    ) -> Result<(), RunError>;
}
#[derive(Debug)]
pub struct OfflineFixture;
impl RunProvider for OfflineFixture {
    fn execute(
        &self,
        _input: &str,
        scenario: OfflineScenario,
        cancelled: &AtomicBool,
        emit: &mut dyn FnMut(&str) -> Result<(), RunError>,
    ) -> Result<(), RunError> {
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
