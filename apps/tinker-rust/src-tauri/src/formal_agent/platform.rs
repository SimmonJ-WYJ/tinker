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

impl crate::formal_platform::project_catalog::ProjectCatalog for HostPlatform {
    fn check_project_text(&self, text: &str) -> Result<()> {
        match self {
            Self::Synthetic(p) => p.check_project_text(text),
            Self::Credentialed(p) => p.check_project_text(text),
        }
    }
    fn edit_projects<T>(
        &self,
        edit: impl FnOnce(
            &mut Vec<crate::formal_platform::workspace::WorkspaceRecord>,
            &std::path::Path,
        ) -> Result<T>,
    ) -> Result<T> {
        match self {
            Self::Synthetic(p) => p.edit_projects(edit),
            Self::Credentialed(p) => p.edit_projects(edit),
        }
    }
}
