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
    mock: Option<OwnedMock>,
    #[cfg(any(test, feature = "formal-native-qa"))]
    owned_qa: Option<crate::credentialed_channels::qa::OwnedQa>,
}
impl FormalHost {
    pub fn open_tools(root: &TrustedRoot, environment: HostEnvironment) -> Result<Self> {
        Self::open_tools_mode(root, environment, false)
    }
    pub fn open_queueing(root: &TrustedRoot, environment: HostEnvironment) -> Result<Self> {
        Self::open_tools_mode(root, environment, true)
    }
    fn open_tools_mode(
        root: &TrustedRoot,
        environment: HostEnvironment,
        queueing: bool,
    ) -> Result<Self> {
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
        let runtime = Arc::new(if queueing {
            DesktopRuntime::open_with_queueing(root.path(), profiles, bindings)?
        } else {
            DesktopRuntime::open_with_tools(root.path(), profiles, bindings)?
        });
        let agent = if queueing {
            FormalAgentHost::new_queueing(runtime, platform, root.clone())?
        } else {
            FormalAgentHost::new(runtime, platform, root.clone())?
        };
        Ok(Self {
            agent,
            mock: Some(mock),
            #[cfg(any(test, feature = "formal-native-qa"))]
            owned_qa: None,
        })
    }
    pub fn open(root: &TrustedRoot, environment: HostEnvironment) -> Result<Self> {
        root.validate()?;
        let mock = OwnedMock::start()?;
        let profiles = mock.profiles()?;
        let platform = FormalPlatform::open(root, &profiles, environment)?;
        let runtime = Arc::new(DesktopRuntime::open(root.path(), profiles)?);
        let agent =
            FormalAgentHost::new_images(runtime, platform, root.clone(), mock.image_addr())?;
        Ok(Self {
            agent,
            mock: Some(mock),
            #[cfg(any(test, feature = "formal-native-qa"))]
            owned_qa: None,
        })
    }
    #[cfg(any(test, feature = "formal-native-qa"))]
    pub fn open_channels_owned_qa(
        root: &TrustedRoot,
        environment: HostEnvironment,
    ) -> Result<Self> {
        let server = crate::credentialed_channels::qa::OwnedQa::start(root)?;
        let path = root.path().join("qa-vault");
        if !path.exists() {
            let mut builder = std::fs::DirBuilder::new();
            #[cfg(unix)]
            {
                use std::os::unix::fs::DirBuilderExt;
                builder.mode(0o700);
            }
            builder.create(&path)?;
        }
        let vault = crate::credentialed_channels::vault_fake::FakeVault::open(path)?;
        let mut host = Self::open_channels_qa(root, environment, server.policy(), vault)?;
        host.owned_qa = Some(server);
        Ok(host)
    }
    pub fn open_channels(root: &TrustedRoot, environment: HostEnvironment) -> Result<Self> {
        let vault: Arc<dyn crate::credentialed_channels::vault::CredentialVault> =
            Arc::new(crate::credentialed_channels::vault::UnavailableVault);
        #[cfg(target_os = "macos")]
        let vault = if crate::credentialed_channels::process::is_native_role() {
            Arc::new(crate::credentialed_channels::vault_host::HelperVault)
                as Arc<dyn crate::credentialed_channels::vault::CredentialVault>
        } else {
            vault
        };
        Self::open_channels_with_vault(
            root,
            environment,
            crate::credentialed_channels::catalog::EndpointPolicy::Https,
            vault,
        )
    }
    #[cfg(any(test, feature = "formal-native-qa"))]
    pub fn open_channels_qa(
        root: &TrustedRoot,
        environment: HostEnvironment,
        policy: crate::credentialed_channels::catalog::EndpointPolicy,
        vault: crate::credentialed_channels::vault_fake::FakeVault,
    ) -> Result<Self> {
        if !matches!(
            policy,
            crate::credentialed_channels::catalog::EndpointPolicy::OwnedQa(_)
        ) {
            return Err(crate::desktop_runtime::protocol::DesktopError(
                "invalidEndpoint",
            ));
        }
        Self::open_channels_with_vault(root, environment, policy, Arc::new(vault))
    }
    fn open_channels_with_vault(
        root: &TrustedRoot,
        environment: HostEnvironment,
        policy: crate::credentialed_channels::catalog::EndpointPolicy,
        vault: Arc<dyn crate::credentialed_channels::vault::CredentialVault>,
    ) -> Result<Self> {
        use crate::credentialed_channels::worker;
        let platform = Arc::new(
            crate::formal_platform::credentialed::CredentialedPlatform::open(
                root,
                policy.clone(),
                environment,
            )?,
        );
        let known = Arc::new(std::sync::Mutex::new(std::collections::BTreeMap::new()));
        let prepared = worker::profiles(
            &platform.catalog()?,
            &std::collections::BTreeMap::new(),
            &known,
            &policy,
        )?;
        let runtime = Arc::new(DesktopRuntime::open_managed_with_profiles(
            root.path(),
            prepared,
        )?);
        let agent =
            FormalAgentHost::new_credentialed(runtime, platform, root.clone(), vault, policy)?;
        Ok(Self {
            agent,
            mock: None,
            #[cfg(any(test, feature = "formal-native-qa"))]
            owned_qa: None,
        })
    }
    pub fn command(&self, window: &str, value: Value) -> Result<PendingReply> {
        self.agent.command(window, value)
    }
    #[cfg(all(target_os = "macos", feature = "formal-preview"))]
    pub(crate) fn image_grant(
        &self,
        generation: String,
        session: String,
        step: crate::formal_agent::image_grant::Step,
    ) -> Result<std::sync::mpsc::Receiver<Result<crate::formal_agent::image_grant::Outcome>>> {
        self.agent.image_grant(generation, session, step)
    }
    #[cfg(all(target_os = "macos", feature = "formal-preview"))]
    pub(crate) fn import_step(
        &self,
        generation: String,
        step: crate::formal_agent::session_import::ImportStep,
    ) -> Result<std::sync::mpsc::Receiver<Result<crate::formal_agent::session_import::ImportReply>>>
    {
        self.agent.import_step(generation, step)
    }
    pub fn set_host_environment(&self, environment: HostEnvironment) -> Result<PendingReply> {
        self.agent.set_host_environment(environment)
    }
    pub fn next_event(&self, timeout: Duration) -> Option<EventEnvelope> {
        self.agent.next_event(timeout)
    }
    pub fn mock_records(&self) -> Vec<RequestMetadata> {
        self.mock
            .as_ref()
            .map(OwnedMock::records)
            .unwrap_or_default()
    }
    pub fn shutdown(&mut self) -> Result<()> {
        let result = self.agent.shutdown();
        if let Some(mock) = self.mock.as_mut() {
            mock.shutdown();
        }
        #[cfg(any(test, feature = "formal-native-qa"))]
        {
            self.owned_qa.take();
        }
        result
    }
}
impl Drop for FormalHost {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}

#[cfg(test)]
#[path = "credentialed_host_tests.rs"]
mod credentialed_tests;
