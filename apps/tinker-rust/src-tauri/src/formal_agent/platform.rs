//! 同一actor的两种平台事实源，不复制调用或事件编排。
use crate::{
    desktop_runtime::{
        availability::Availability,
        protocol::{DesktopError, Result},
    },
    formal_platform::{
        credentialed::CredentialedPlatform, FormalPlatform, HostEnvironment, PlatformReply,
        PlatformRequest, PlatformSnapshot,
    },
};
use serde_json::Value;
use std::sync::Arc;
pub(super) enum HostPlatform {
    Synthetic(Box<FormalPlatform>),
    Credentialed(Arc<CredentialedPlatform>),
}
impl From<FormalPlatform> for HostPlatform {
    fn from(p: FormalPlatform) -> Self {
        Self::Synthetic(Box::new(p))
    }
}
impl HostPlatform {
    pub fn bootstrap(&self) -> Result<PlatformSnapshot> {
        match self {
            Self::Synthetic(p) => p.bootstrap(),
            Self::Credentialed(p) => p.bootstrap(),
        }
    }
    pub fn require_workspace(
        &self,
        key: crate::formal_platform::workspace::WorkspaceKey<'_>,
    ) -> Result<()> {
        match self {
            Self::Synthetic(p) => p.require_workspace(key),
            Self::Credentialed(p) => p.require_workspace(key),
        }
    }
    pub fn bind_project_folder(
        &self,
        id: &str,
        path: &std::path::Path,
        identity: (u64, u64),
    ) -> Result<crate::formal_platform::workspace::Workspace> {
        self.project_platform()?
            .bind_project_folder(id, path, identity)
    }
    pub fn project_platform(&self) -> Result<&FormalPlatform> {
        match self {
            Self::Synthetic(p) => Ok(p),
            _ => Err(DesktopError("unsupported")),
        }
    }
    pub fn channels(&self) -> Result<Value> {
        match self {
            Self::Synthetic(p) => p.channels(),
            Self::Credentialed(p) => p.channels(),
        }
    }
    pub fn set_host_environment(&self, e: HostEnvironment) -> Result<PlatformSnapshot> {
        match self {
            Self::Synthetic(p) => p.set_host_environment(e),
            Self::Credentialed(p) => p.set_host_environment(e),
        }
    }
    pub fn invoke(&self, r: PlatformRequest) -> Result<PlatformReply> {
        match self {
            Self::Synthetic(p) => p.invoke(r),
            Self::Credentialed(p) => p.read(r),
        }
    }
    pub fn availability(&self) -> Result<Availability> {
        match self {
            Self::Synthetic(p) => p.availability(),
            Self::Credentialed(_) => Err(DesktopError("unsupported")),
        }
    }
    pub fn synthetic_connection(&self, id: &str) -> Result<(String, String, Vec<String>)> {
        match self {
            Self::Synthetic(p) => p.synthetic_connection(id),
            Self::Credentialed(_) => Err(DesktopError("unsupported")),
        }
    }
}
