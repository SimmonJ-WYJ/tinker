//! 仅可信原生宿主可创建合成根或传入profile；不读环境凭据或真实home。
use super::store::{directory, read_regular, sync_dir, write_new, MAX_MARKER_BYTES};
use crate::{
    chat_http::HttpProtocol,
    desktop_runtime::{
        profile::Profile,
        protocol::{DesktopError, Result},
        Model, TrustedProfile,
    },
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};
pub const TOOLS_APPLICATION_ID: &str = "com.tinker.tools-preview";
pub const SYNTHETIC_TOOLS: &str = "synthetic-tools-v1";
pub const APPLICATION_ID: &str = "com.tinker.formal-preview";
pub const SYNTHETIC_PROFILE: &str = "synthetic-profile-v1";
pub const MOCK_PROFILE_ID: &str = "local-mock";
pub const MOCK_CONFIG_REVISION: &str = "local-mock-protocol-v1";
pub const MOCK_KEY: &str = "synthetic-local-mock-key";
#[derive(Debug, Clone)]
enum RootLocation {
    Temporary,
    ToolsTemporary,
    ToolsAppData(PathBuf),
    AppData(PathBuf),
}
#[derive(Debug, Clone)]
pub struct TrustedRoot {
    path: PathBuf,
    location: RootLocation,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Marker {
    kind: String,
    version: u32,
    root: PathBuf,
}
impl TrustedRoot {
    pub fn create_tools_temporary(path: impl AsRef<Path>) -> Result<Self> {
        Self::create(path.as_ref(), RootLocation::ToolsTemporary)
    }
    pub fn open_tools_temporary(path: impl AsRef<Path>) -> Result<Self> {
        Self::open(path.as_ref(), RootLocation::ToolsTemporary)
    }
    pub fn create_tools_app_data(parent: impl AsRef<Path>) -> Result<Self> {
        Self::create(
            &parent.as_ref().join(SYNTHETIC_TOOLS),
            RootLocation::ToolsAppData(parent.as_ref().into()),
        )
    }
    pub fn open_tools_app_data(parent: impl AsRef<Path>) -> Result<Self> {
        Self::open(
            &parent.as_ref().join(SYNTHETIC_TOOLS),
            RootLocation::ToolsAppData(parent.as_ref().into()),
        )
    }
    pub(crate) fn validate_tools(&self) -> Result<()> {
        if !matches!(
            self.location,
            RootLocation::ToolsTemporary | RootLocation::ToolsAppData(_)
        ) {
            return Err(DesktopError("invalidRoot"));
        }
        self.validate()
    }
    fn kind(location: &RootLocation) -> &'static str {
        if matches!(
            location,
            RootLocation::ToolsTemporary | RootLocation::ToolsAppData(_)
        ) {
            "tinker-tauri-tools-preview"
        } else {
            "tinker-tauri-formal-preview"
        }
    }
    pub fn create_temporary(path: impl AsRef<Path>) -> Result<Self> {
        Self::create(path.as_ref(), RootLocation::Temporary)
    }
    pub fn open_temporary(path: impl AsRef<Path>) -> Result<Self> {
        Self::open(path.as_ref(), RootLocation::Temporary)
    }
    /// expected_parent仅由Tauri app.path().app_local_data_dir()取得；禁止来自renderer。
    pub fn create_app_data(expected_parent: impl AsRef<Path>) -> Result<Self> {
        let parent = expected_parent.as_ref();
        Self::create(
            &parent.join(SYNTHETIC_PROFILE),
            RootLocation::AppData(parent.into()),
        )
    }
    pub fn open_app_data(expected_parent: impl AsRef<Path>) -> Result<Self> {
        let parent = expected_parent.as_ref();
        Self::open(
            &parent.join(SYNTHETIC_PROFILE),
            RootLocation::AppData(parent.into()),
        )
    }
    pub fn path(&self) -> &Path {
        &self.path
    }
    fn check_location(path: &Path, location: &RootLocation) -> Result<()> {
        if !path.is_absolute() {
            return Err(DesktopError("invalidRoot"));
        }
        let parent = path.parent().ok_or(DesktopError("invalidRoot"))?;
        if fs::canonicalize(parent).map_err(|_| DesktopError("invalidRoot"))? != parent {
            return Err(DesktopError("invalidRoot"));
        }
        match location {
            RootLocation::Temporary | RootLocation::ToolsTemporary => {
                let tmp = fs::canonicalize(std::env::temp_dir())
                    .map_err(|_| DesktopError("invalidRoot"))?;
                let system_tmp = fs::canonicalize("/tmp").ok();
                if (parent != tmp && system_tmp.as_deref() != Some(parent))
                    || !path.file_name().and_then(|s| s.to_str()).is_some_and(|s| {
                        s.starts_with(&format!("{}-", Self::kind(location)))
                            && s.len() > Self::kind(location).len() + 1
                    })
                {
                    return Err(DesktopError("invalidRoot"));
                }
            }
            RootLocation::AppData(expected) | RootLocation::ToolsAppData(expected) => {
                let tools = matches!(location, RootLocation::ToolsAppData(_));
                if parent != expected
                    || expected.file_name().and_then(|s| s.to_str())
                        != Some(if tools {
                            TOOLS_APPLICATION_ID
                        } else {
                            APPLICATION_ID
                        })
                    || path.file_name().and_then(|s| s.to_str())
                        != Some(if tools {
                            SYNTHETIC_TOOLS
                        } else {
                            SYNTHETIC_PROFILE
                        })
                {
                    return Err(DesktopError("invalidRoot"));
                }
                directory(parent, true)?;
            }
        }
        Ok(())
    }
    fn create(path: &Path, location: RootLocation) -> Result<Self> {
        Self::check_location(path, &location)?;
        // exclusive创建：已有无marker目录绝不被认领。
        let mut builder = fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder
            .create(path)
            .map_err(|_| DesktopError("invalidRoot"))?;
        let marker = Marker {
            kind: Self::kind(&location).into(),
            version: 1,
            root: path.into(),
        };
        write_new(
            &path.join("preview.json"),
            &serde_json::to_vec(&marker).map_err(|_| DesktopError("storeIo"))?,
        )?;
        sync_dir(path)?;
        sync_dir(path.parent().ok_or(DesktopError("invalidRoot"))?)?;
        Self::open(path, location)
    }
    fn open(path: &Path, location: RootLocation) -> Result<Self> {
        let root = Self {
            path: path.into(),
            location,
        };
        root.validate()?;
        Ok(root)
    }
    pub(crate) fn validate(&self) -> Result<()> {
        Self::check_location(&self.path, &self.location)?;
        directory(&self.path, true)?;
        let marker: Marker = serde_json::from_slice(&read_regular(
            &self.path.join("preview.json"),
            MAX_MARKER_BYTES,
        )?)
        .map_err(|_| DesktopError("invalidRoot"))?;
        if marker.kind != Self::kind(&self.location)
            || marker.version != 1
            || marker.root != self.path
        {
            return Err(DesktopError("invalidRoot"));
        }
        Ok(())
    }
}
pub(crate) struct PublicProfile {
    pub profile_id: String,
    pub models: Vec<Model>,
}
pub(crate) fn public_profiles(profiles: &[TrustedProfile]) -> Result<Vec<PublicProfile>> {
    if profiles.is_empty() || profiles.len() > 16 {
        return Err(DesktopError("invalidProfile"));
    }
    let mut result = Vec::new();
    for p in profiles {
        validate_endpoint(&p.endpoint)?;
        if p.key != MOCK_KEY
            || !(p.label.starts_with("Local Mock") || p.label.starts_with("Local Synthetic Mock"))
            || p.models.iter().any(|m| {
                !(m.label.starts_with("Local Mock") || m.label.starts_with("Local Synthetic Mock"))
            })
            || result
                .iter()
                .any(|other: &PublicProfile| other.profile_id == p.profile_id)
        {
            return Err(DesktopError("invalidProfile"));
        }
        let validated = Profile::from_trusted(TrustedProfile {
            profile_id: p.profile_id.clone(),
            label: p.label.clone(),
            config_revision: p.config_revision.clone(),
            models: p.models.clone(),
            endpoint: p.endpoint.clone(),
            key: p.key.clone(),
            protocol: p.protocol,
        })?;
        result.push(PublicProfile {
            profile_id: validated.profile_id,
            models: validated.models,
        });
    }
    Ok(result)
}
fn validate_endpoint(endpoint: &str) -> Result<()> {
    let u = reqwest::Url::parse(endpoint).map_err(|_| DesktopError("invalidProfile"))?;
    if u.scheme() != "http"
        || !matches!(u.host_str(), Some("127.0.0.1" | "[::1]"))
        || !u.username().is_empty()
        || u.password().is_some()
        || u.query().is_some()
        || u.fragment().is_some()
        || u.port() == Some(0)
    {
        return Err(DesktopError("invalidProfile"));
    }
    Ok(())
}
/// 仅供预览宿主owned loopback fixture使用；端口不是逻辑配置revision的一部分。
/// 调用方必须先持有本进程创建的listener，不能用此helper为外部服务声称owned身份。
pub fn local_mock_profiles(endpoint: &str) -> Result<Vec<TrustedProfile>> {
    validate_endpoint(endpoint)?;
    let profiles = vec![TrustedProfile {
        profile_id: MOCK_PROFILE_ID.into(),
        label: "Local Mock".into(),
        config_revision: MOCK_CONFIG_REVISION.into(),
        models: [
            ("local-mock-a", "Local Mock A"),
            ("local-mock-b", "Local Mock B"),
        ]
        .into_iter()
        .map(|(id, label)| Model {
            model_id: id.into(),
            label: label.into(),
            supported_efforts: vec!["low".into(), "medium".into(), "high".into()],
        })
        .collect(),
        endpoint: endpoint.into(),
        key: MOCK_KEY.into(),
        protocol: HttpProtocol::OpenaiChat,
    }];
    public_profiles(&profiles)?;
    Ok(profiles)
}
