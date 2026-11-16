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
    pub fn open_tools(root: &TrustedRoot, environment: HostEnvironment) -> Result<Self> {
        root.validate_tools()?;
        let mock = OwnedMock::start_tools()?;
        let profiles = mock.profiles()?;
        let executor = Arc::new(crate::synthetic_workspace::SyntheticWorkspace::create(
            root,
        )?);
        use crate::tool_types::ToolExecutor;
        let options = crate::tool_types::ToolRunOptions::new(
            executor.workspace_revision().into(),
            Duration::from_secs(60),
            Duration::from_secs(120),
        )?;
        let bindings = vec![crate::desktop_runtime::TrustedToolBinding {
            profile_id: "local-tools-mock".into(),
            executor,
            options,
        }];
        let platform = FormalPlatform::open(root, &profiles, environment)?;
        let runtime = Arc::new(DesktopRuntime::open_with_tools(
            root.path(),
            profiles,
            bindings,
        )?);
        let agent = FormalAgentHost::new(runtime, platform, root.clone())?;
        Ok(Self { agent, mock })
    }
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
