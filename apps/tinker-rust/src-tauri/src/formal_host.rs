//! preview宿主薄门面：owned mock、一个runtime、原生平台与适配actor。
use crate::{
    desktop_runtime::{protocol::Result, DesktopRuntime},
    formal_agent::{protocol::EventEnvelope, FormalAgentHost, PendingReply},
    formal_mock::{OwnedMock, RequestMetadata},
    formal_platform::{FormalPlatform, HostEnvironment, TrustedRoot},
};
use serde_json::Value;
use std::{sync::Arc, time::Duration};
pub struct FormalHost {
    agent: FormalAgentHost,
    mock: OwnedMock,
}
impl FormalHost {
    pub fn open(root: &TrustedRoot, environment: HostEnvironment) -> Result<Self> {
        root.validate()?;
        let mock = OwnedMock::start()?;
        let profiles = mock.profiles()?;
        let platform = FormalPlatform::open(root, &profiles, environment)?;
        let runtime = Arc::new(DesktopRuntime::open(root.path(), profiles)?);
        let agent = FormalAgentHost::new(runtime, platform, root.clone())?;
        Ok(Self { agent, mock })
    }
    pub fn command(&self, window: &str, value: Value) -> Result<PendingReply> {
        self.agent.command(window, value)
    }
    pub fn set_host_environment(&self, environment: HostEnvironment) -> Result<PendingReply> {
        self.agent.set_host_environment(environment)
    }
    pub fn next_event(&self, timeout: Duration) -> Option<EventEnvelope> {
        self.agent.next_event(timeout)
    }
    pub fn mock_records(&self) -> Vec<RequestMetadata> {
        self.mock.records()
    }
    pub fn shutdown(&mut self) -> Result<()> {
        let result = self.agent.shutdown();
        self.mock.shutdown();
        result
    }
}
impl Drop for FormalHost {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}
