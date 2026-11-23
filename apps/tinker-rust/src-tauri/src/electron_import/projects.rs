//! 项目 ID 用作归属。只有索引中不冲突的 slug 可用于读取备份内的已知文件。
use super::{
    fs::Dir,
    reader::{file_in, timestamp, warning, MAX_INDEX},
    DesktopError, ImportBatch, ImportWarning, Result, SourceProject,
};
use crate::formal_platform::protocol::{identifier, valid_project_name};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;

fn global_warning(warnings: &mut Vec<ImportWarning>, code: &str) {
    if let Some(w) = warnings
        .iter_mut()
        .find(|w| w.session_id.is_none() && w.code == code)
    {
        w.count += 1;
    } else {
        warnings.push(ImportWarning {
            code: code.into(),
            session_id: None,
            count: 1,
        });
    }
}

#[derive(Default)]
pub(super) struct ProjectIndex {
    slugs: HashMap<String, String>,
    pub(super) valid: bool,
}

fn slug(row: &Value) -> Option<&str> {
    row["slug"].as_str().filter(|s| {
        let valid_first = s
            .as_bytes()
            .first()
            .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit());
        s.len() <= 128
            && valid_first
            && s.bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'-' | b'_'))
    })
}
fn source_id(row: &Value) -> Option<&str> {
    row["id"].as_str().filter(|v| identifier(v).is_ok())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DirectoryHints {
    #[serde(default)]
    attached_directories: Vec<String>,
}
fn hint(root: &Dir, slug: &str) -> Result<bool> {
    let Some(bytes) = file_in(root, &["agent-workspaces", slug], "config.json", 64 * 1024)? else {
        return Ok(false);
    };
    let hint: DirectoryHints =
        serde_json::from_slice(&bytes).map_err(|_| DesktopError("invalidDirectoryHint"))?;
    // 只检测旧版曾设置目录，不解析、保存或访问这些路径。
    Ok(hint
        .attached_directories
        .iter()
        .any(|s| !s.trim().is_empty()))
}
impl ProjectIndex {
    pub(super) fn slug<'a>(&'a self, workspace: &Value) -> Option<&'a str> {
        if workspace.is_null() {
            Some("_no-workspace")
        } else {
            self.slugs.get(workspace.as_str()?).map(String::as_str)
        }
    }
    pub(super) fn read(root: &Dir, batch: &mut ImportBatch) -> Self {
        let bytes = match root.file("agent-workspaces.json", MAX_INDEX) {
            Ok(None) => return Self::default(),
            Ok(Some(bytes)) => bytes,
            Err(_) => {
                global_warning(&mut batch.warnings, "invalidProjectIndex");
                return Self::default();
            }
        };
        let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
            global_warning(&mut batch.warnings, "invalidProjectIndex");
            return Self::default();
        };
        let known_version = match value.get("version") {
            None | Some(Value::Null) => true,
            Some(version) => matches!(version.as_u64(), Some(1 | 2)),
        };
        let Some(rows) = value["workspaces"]
            .as_array()
            .filter(|rows| known_version && rows.len() <= 128)
        else {
            global_warning(&mut batch.warnings, "invalidProjectIndex");
            return Self::default();
        };
        let mut result = Self {
            valid: true,
            ..Self::default()
        };
        let mut ids = HashMap::new();
        let mut slugs = HashMap::new();
        // 先找整份索引中的冲突，避免先读到哪一条就误认作可信源。
        for row in rows {
            if let Some(id) = source_id(row) {
                *ids.entry(id).or_insert(0usize) += 1;
            }
            if let Some(slug) = slug(row) {
                *slugs.entry(slug).or_insert(0usize) += 1;
            }
        }
        for row in rows {
            let Some(id) = source_id(row) else {
                global_warning(&mut batch.warnings, "invalidProject");
                continue;
            };
            if ids[id] > 1 {
                global_warning(&mut batch.warnings, "duplicateProject");
                continue;
            }
            let trusted_slug = match slug(row) {
                Some(slug) if slugs[slug] == 1 => {
                    result.slugs.insert(id.into(), slug.into());
                    Some(slug)
                }
                Some(_) => {
                    global_warning(&mut batch.warnings, "duplicateProject");
                    None
                }
                None => {
                    global_warning(&mut batch.warnings, "invalidProject");
                    None
                }
            };
            let name = row["name"].as_str().filter(|s| valid_project_name(s));
            let (Some(name), Some(created_at), Some(updated_at)) = (
                name,
                timestamp(&row["createdAt"]),
                timestamp(&row["updatedAt"]),
            ) else {
                global_warning(&mut batch.warnings, "invalidProject");
                continue;
            };
            if updated_at < created_at {
                global_warning(&mut batch.warnings, "invalidProject");
                continue;
            }
            let has_directory_hint = trusted_slug
                .and_then(|slug| match hint(root, slug) {
                    Ok(value) => Some(value),
                    Err(_) => {
                        global_warning(&mut batch.warnings, "invalidDirectoryHint");
                        None
                    }
                })
                .unwrap_or(false);
            batch.projects.push(SourceProject {
                source_project_id: id.into(),
                name: name.into(),
                created_at,
                updated_at,
                has_directory_hint,
            });
        }
        result
    }
}
pub(super) fn associate(workspace: &Value, sid: &str, batch: &mut ImportBatch) -> Result<()> {
    if workspace.is_null() {
        return Ok(());
    }
    let Some(pid) = workspace.as_str().filter(|pid| identifier(pid).is_ok()) else {
        return Err(DesktopError("unavailableProject"));
    };
    batch.session_projects.insert(sid.into(), pid.into());
    if !batch.projects.iter().any(|p| p.source_project_id == pid) {
        warning(&mut batch.warnings, "missingProject", sid);
    }
    Ok(())
}
