//! 受信任宿主的项目目录；源标识与显示名称分离，文件夹绑定只能来自系统选择器。
use super::{
    protocol::{identifier, valid_project_name, MAX_SAFE_INTEGER},
    store::Store,
    workspace::{Workspace, WorkspaceRecord},
    FormalPlatform, Inner, Persisted, TrustedRoot,
};
use crate::{
    desktop_runtime::protocol::{DesktopError, Result},
    electron_import::SourceProject,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
};
const NAMESPACE: &str = "formal-project-platform-v1";
pub(super) const MAX_PROJECTS: usize = 256;
#[derive(Clone, PartialEq, Serialize, Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub(super) struct Binding {
    path: PathBuf,
    device: u64,
    inode: u64,
}
pub(crate) struct ImportedProjects {
    pub ids: BTreeMap<String, String>,
    pub imported: usize,
    pub updated: usize,
    pub rejected: usize,
}
fn has_project_snapshot(root: &TrustedRoot) -> Result<bool> {
    let dir = root.path().join(NAMESPACE);
    match dir.symlink_metadata() {
        Ok(_) => {
            super::store::directory(&dir, true)?;
            match dir.join("snapshot.json").symlink_metadata() {
                Ok(_) => return Ok(true),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => return Err(DesktopError("storeIo")),
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(DesktopError("storeIo")),
    }
    Ok(false)
}
pub(super) fn open_current(root: &TrustedRoot) -> Result<(Store, bool)> {
    root.validate()?;
    if has_project_snapshot(root)? {
        return Ok((Store::open_namespace(root, NAMESPACE)?, true));
    }
    let legacy = Store::open(root)?;
    // 两次检测之间别的进程可能刚在旧锁内发布了项目副本。
    if has_project_snapshot(root)? {
        return Ok((Store::open_namespace(root, NAMESPACE)?, true));
    }
    Ok((legacy, false))
}
pub(crate) fn project_id(source: &str) -> String {
    format!(
        "project-{}",
        &format!("{:x}", Sha256::digest(source.as_bytes()))[..32]
    )
}
pub(super) fn directory_identity(path: &Path) -> Result<(u64, u64)> {
    super::store::directory(path, false)
        .map_err(|_| DesktopError("projectDirectoryUnavailable"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let m = path
            .symlink_metadata()
            .map_err(|_| DesktopError("projectDirectoryUnavailable"))?;
        Ok((m.dev(), m.ino()))
    }
    #[cfg(not(unix))]
    Err(DesktopError("unsupportedPlatform"))
}
impl WorkspaceRecord {
    pub(super) fn public(&self) -> Workspace {
        let mut out = self.workspace.clone();
        if let Some(name) = &self.local_name {
            out.name = name.clone();
        }
        if out.project_origin.is_some() {
            out.directory_status = Some(
                match &self.binding {
                    None => "unbound",
                    Some(b) if directory_identity(&b.path).ok() == Some((b.device, b.inode)) => {
                        "bound"
                    }
                    Some(_) => "unavailable",
                }
                .into(),
            )
        }
        out
    }
}
pub(super) fn validate_catalog(records: &[WorkspaceRecord], managed: bool) -> Result<()> {
    let mut seen = BTreeSet::new();
    for record in records.iter().skip(1) {
        let w = &record.workspace;
        let ids_ok = match (
            w.project_origin.as_deref(),
            record.source_project_id.as_deref(),
        ) {
            (Some("orphan" | "imported"), Some(source)) => {
                identifier(source).is_ok() && w.id == project_id(source)
            }
            (Some("native"), None) => {
                w.id.strip_prefix("native-project-")
                    .is_some_and(|s| s.len() == 32 && s.bytes().all(|c| c.is_ascii_hexdigit()))
            }
            _ => false,
        };
        if !ids_ok
            || !seen.insert(&w.id)
            || w.slug != w.id
            || w.created_at > w.updated_at
            || w.updated_at > MAX_SAFE_INTEGER
            || !valid_project_name(&w.name)
            || record
                .local_name
                .as_deref()
                .is_some_and(|s| !valid_project_name(s))
            || w.directory_status.is_some()
            || !(["low", "medium", "high", "max"].contains(&record.effort.as_str())
                || managed && record.effort.is_empty())
            || record.binding.as_ref().is_some_and(|b| {
                !b.path.is_absolute()
                    || b.path
                        .components()
                        .any(|c| matches!(c, std::path::Component::ParentDir))
            })
        {
            return Err(DesktopError("corruptSnapshot"));
        }
    }
    Ok(())
}
impl Inner {
    fn commit_projects(&mut self, next: Persisted, publish: bool) -> Result<()> {
        validate_catalog(&next.workspaces, false)?;
        let bytes = serde_json::to_vec(&next).map_err(|_| DesktopError("storeIo"))?;
        super::store::snapshot_budget(&bytes)?;
        if !publish {
            return Ok(());
        }
        if !self.project_mode {
            // 首次项目写入时切换副本。旧版可继续打开自己的偏好；两个副本此后独立。
            self.store.verify_current()?;
            let mut copy = Store::open_namespace(&self.root, NAMESPACE)?;
            if copy.bytes().is_some() {
                return Err(DesktopError("storeChanged"));
            }
            copy.recover_pending()?;
            // 先持有新锁，再释放旧锁；同步失败时保留原状态并要求重开。
            #[cfg(test)]
            {
                copy.fail_after_rename = self.store.fail_after_rename;
            }
            if let Err(error) = copy.write(bytes) {
                // 无法确认新副本的提交状态。冻结旧写端；重开时以持久化快照为准。
                if copy.publication_uncertain() {
                    self.store.freeze();
                }
                return Err(error);
            }
            self.store = copy;
            self.project_mode = true;
        } else {
            self.store.write(bytes)?;
        }
        self.state = next;
        Ok(())
    }
}
// 仅携带项目身份和显示信息。目录授权、源机器路径、渠道及凭据均不属于归档格式。
#[derive(Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PortableProject {
    pub id: String,
    pub name: String,
    origin: String,
    source_project_id: Option<String>,
    created_at: u64,
    updated_at: u64,
}
impl PortableProject {
    fn from_record(record: &WorkspaceRecord) -> Result<Self> {
        let w = &record.workspace;
        Ok(Self {
            id: w.id.clone(),
            name: record.local_name.as_ref().unwrap_or(&w.name).clone(),
            origin: w
                .project_origin
                .clone()
                .ok_or(DesktopError("workspaceNotFound"))?,
            source_project_id: record.source_project_id.clone(),
            created_at: w.created_at,
            updated_at: w.updated_at,
        })
    }
    fn record(&self) -> WorkspaceRecord {
        WorkspaceRecord {
            workspace: Workspace {
                id: self.id.clone(),
                slug: self.id.clone(),
                name: self.name.clone(),
                created_at: self.created_at,
                updated_at: self.updated_at,
                project_origin: Some(self.origin.clone()),
                directory_status: None,
                has_directory_hint: None,
            },
            source_project_id: self.source_project_id.clone(),
            effort: "high".into(),
            binding: None,
            local_name: None,
        }
    }
    pub(crate) fn validate(&self) -> Result<()> {
        validate_catalog(&[WorkspaceRecord::initial(), self.record()], false)
            .map_err(|_| DesktopError("invalidProjectArchive"))
    }
}
pub(crate) trait ProjectCatalog {
    fn check_project_text(&self, text: &str) -> Result<()>;
    fn edit_projects_mode<T>(
        &self,
        publish: bool,
        edit: impl FnOnce(&mut Vec<WorkspaceRecord>, &Path) -> Result<T>,
    ) -> Result<T>;
    fn edit_projects<T>(
        &self,
        edit: impl FnOnce(&mut Vec<WorkspaceRecord>, &Path) -> Result<T>,
    ) -> Result<T> {
        self.edit_projects_mode(true, edit)
    }
    fn portable_project(&self, id: &str) -> Result<Option<PortableProject>> {
        self.edit_projects(|records, _| {
            records
                .iter()
                .skip(1)
                .find(|r| r.workspace.id == id)
                .map(PortableProject::from_record)
                .transpose()
        })
    }
    fn prepare_portable_project(&self, project: &PortableProject, publish: bool) -> Result<()> {
        project.validate()?;
        self.check_project_text(&project.name)?;
        self.check_project_text(&project.id)?;
        if let Some(source) = &project.source_project_id {
            self.check_project_text(source)?;
        }
        self.edit_projects_mode(publish, |records, _| {
            if records.len() > MAX_PROJECTS {
                return Err(DesktopError("projectLimit"));
            }
            if records.iter().any(|r| {
                r.workspace.id == project.id
                    || r.local_name.as_ref().unwrap_or(&r.workspace.name) == &project.name
            }) {
                return Err(DesktopError("projectConflict"));
            }
            records.push(project.record());
            Ok(())
        })
    }
    fn import_projects(
        &self,
        projects: &[SourceProject],
        refs: &BTreeSet<String>,
    ) -> Result<ImportedProjects> {
        self.edit_projects(|records, _| {
            let mut result = ImportedProjects {
                ids: BTreeMap::new(),
                imported: 0,
                updated: 0,
                rejected: 0,
            };
            let sources: BTreeMap<_, _> = projects
                .iter()
                .map(|p| (p.source_project_id.clone(), p))
                .collect();
            if sources.len() != projects.len() {
                return Err(DesktopError("invalidProject"));
            }
            let keys: BTreeSet<_> = sources.keys().chain(refs.iter()).collect();
            for source in keys {
                let detail = sources.get(source);
                let valid = identifier(source).is_ok()
                    && self.check_project_text(source).is_ok()
                    && detail.is_none_or(|p| {
                        valid_project_name(&p.name)
                            && p.created_at <= p.updated_at
                            && p.updated_at <= MAX_SAFE_INTEGER
                            && self.check_project_text(&p.name).is_ok()
                    });
                if !valid {
                    // 不返回被拒的标识、名称或路径。关联会话由调用方按缺失映射逐项跳过。
                    result.rejected += 1;
                    continue;
                }
                let id = project_id(source);
                if let Some(record) = records.iter_mut().find(|w| w.workspace.id == id) {
                    if record.source_project_id.as_deref() != Some(source.as_str()) {
                        return Err(DesktopError("projectConflict"));
                    }
                    if let Some(p) = detail {
                        let w = &mut record.workspace;
                        if w.project_origin.as_deref() == Some("orphan")
                            || p.updated_at > w.updated_at
                        {
                            w.name = p.name.clone();
                            w.created_at = p.created_at;
                            w.updated_at = p.updated_at;
                            w.has_directory_hint = Some(p.has_directory_hint);
                            w.project_origin = Some("imported".into());
                            result.updated += 1;
                        } else if p.updated_at == w.updated_at
                            && w.has_directory_hint != Some(p.has_directory_hint)
                        {
                            w.has_directory_hint = Some(p.has_directory_hint);
                            result.updated += 1;
                        }
                    }
                } else {
                    if records.len() > MAX_PROJECTS {
                        return Err(DesktopError("projectLimit"));
                    }
                    records.push(WorkspaceRecord {
                        workspace: Workspace {
                            id: id.clone(),
                            slug: id.clone(),
                            name: detail
                                .map_or("Recovered project", |p| p.name.as_str())
                                .to_owned(),
                            created_at: detail.map_or(0, |p| p.created_at),
                            updated_at: detail.map_or(0, |p| p.updated_at),
                            project_origin: Some(
                                if detail.is_some() {
                                    "imported"
                                } else {
                                    "orphan"
                                }
                                .into(),
                            ),
                            has_directory_hint: Some(detail.is_some_and(|p| p.has_directory_hint)),
                            directory_status: None,
                        },
                        effort: "high".into(),
                        source_project_id: Some(source.clone()),
                        binding: None,
                        local_name: None,
                    });
                    result.imported += 1;
                }
                result.ids.insert(source.clone(), id);
            }
            Ok(result)
        })
    }
    fn create_project(&self, name: &str, from: Option<&str>) -> Result<Workspace> {
        self.edit_projects(|records, _| {
            if !valid_project_name(name) {
                return Err(DesktopError("invalidProject"));
            }
            self.check_project_text(name)?;
            if from.is_some_and(|from| !records.iter().any(|w| w.workspace.slug == from)) {
                return Err(DesktopError("workspaceNotFound"));
            }
            if records
                .iter()
                .any(|w| w.local_name.as_ref().unwrap_or(&w.workspace.name) == name)
            {
                return Err(DesktopError("projectConflict"));
            }
            if records.len() > MAX_PROJECTS {
                return Err(DesktopError("projectLimit"));
            }
            let id = format!(
                "native-project-{}",
                crate::credentialed_channels::catalog::random_reference()?
            );
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|_| DesktopError("clockUnavailable"))?
                .as_millis() as u64;
            let record = WorkspaceRecord {
                workspace: Workspace {
                    id: id.clone(),
                    slug: id,
                    name: name.into(),
                    created_at: now,
                    updated_at: now,
                    project_origin: Some("native".into()),
                    directory_status: None,
                    has_directory_hint: None,
                },
                source_project_id: None,
                effort: "high".into(),
                binding: None,
                local_name: None,
            };
            let out = record.public();
            records.push(record);
            Ok(out)
        })
    }
    fn rename_project(&self, id: &str, name: &str) -> Result<Workspace> {
        self.edit_projects(|records, _| {
            if !valid_project_name(name) {
                return Err(DesktopError("invalidProject"));
            }
            self.check_project_text(name)?;
            let index = records
                .iter()
                .position(|r| r.workspace.id == id && r.workspace.project_origin.is_some())
                .ok_or(DesktopError("workspaceNotFound"))?;
            let current = &records[index];
            if current
                .local_name
                .as_ref()
                .unwrap_or(&current.workspace.name)
                == name
            {
                return Ok(current.public());
            }
            if records.iter().any(|r| {
                r.workspace.id != id && r.local_name.as_ref().unwrap_or(&r.workspace.name) == name
            }) {
                return Err(DesktopError("projectConflict"));
            }
            let record = &mut records[index];
            record.local_name = Some(name.to_owned());
            let out = record.public();
            Ok(out)
        })
    }
    fn bind_project_folder(
        &self,
        id: &str,
        path: &Path,
        selected: (u64, u64),
    ) -> Result<Workspace> {
        self.edit_projects(|records, target| {
            let path_text = path
                .to_str()
                .ok_or(DesktopError("projectDirectoryUnavailable"))?;
            self.check_project_text(path_text)?;
            if directory_identity(path)? != selected {
                return Err(DesktopError("projectDirectoryUnavailable"));
            }
            let root_identity = directory_identity(target)?;
            for (tree, forbidden) in [(target, selected), (path, root_identity)] {
                for ancestor in tree.ancestors() {
                    if directory_identity(ancestor)? == forbidden {
                        return Err(DesktopError("unsafeImportPath"));
                    }
                }
            }
            let record = records
                .iter_mut()
                .skip(1)
                .find(|w| w.workspace.id == id)
                .ok_or(DesktopError("workspaceNotFound"))?;
            record.binding = Some(Binding {
                path: path.to_owned(),
                device: selected.0,
                inode: selected.1,
            });
            if directory_identity(path)? != selected {
                return Err(DesktopError("projectDirectoryUnavailable"));
            }
            let out = record.public();
            Ok(out)
        })
    }
}

impl ProjectCatalog for FormalPlatform {
    fn check_project_text(&self, text: &str) -> Result<()> {
        super::reject_credentials(&serde_json::json!(text), &self.known_keys)
    }
    fn edit_projects_mode<T>(
        &self,
        publish: bool,
        edit: impl FnOnce(&mut Vec<WorkspaceRecord>, &Path) -> Result<T>,
    ) -> Result<T> {
        let mut i = self
            .inner
            .lock()
            .map_err(|_| DesktopError("recoveryRequired"))?;
        let mut next = i.state.clone();
        let result = edit(&mut next.workspaces, i.root.path())?;
        if i.state.workspaces != next.workspaces {
            i.commit_projects(next, publish)?;
        }
        Ok(result)
    }
}
impl FormalPlatform {
    pub(crate) fn require_workspace(&self, key: super::workspace::WorkspaceKey<'_>) -> Result<()> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| DesktopError("recoveryRequired"))?;
        inner
            .state
            .workspaces
            .iter()
            .any(|r| key.matches(&r.workspace))
            .then_some(())
            .ok_or(DesktopError("workspaceNotFound"))
    }
    #[cfg(test)]
    pub(crate) fn project_workspace(&self, id: &str) -> Result<Workspace> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| DesktopError("recoveryRequired"))?;
        Ok(inner
            .state
            .workspaces
            .iter()
            .skip(1)
            .find(|w| w.workspace.id == id)
            .ok_or(DesktopError("workspaceNotFound"))?
            .public())
    }
}
