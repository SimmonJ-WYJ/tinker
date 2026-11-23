//! 只读取用户所选备份索引指定的会话及 SDK 回退 ID。
use super::{fs::Dir, records, *};
use crate::desktop_runtime::protocol::{id, MAX_SAFE_INTEGER};
use serde_json::Value;
use std::collections::HashSet;
pub(super) const MAX_INDEX: usize = 1024 * 1024;
const MAX_LOG: usize = 8 * 1024 * 1024;
const MAX_TOTAL: usize = 32 * 1024 * 1024;
pub(super) struct Budget {
    pub bytes: usize,
    pub output: usize,
}
impl Budget {
    pub fn charge(&mut self, n: usize) -> Result<()> {
        self.bytes = self
            .bytes
            .checked_sub(n)
            .ok_or(DesktopError("importLimit"))?;
        Ok(())
    }
}
pub(super) fn warning(w: &mut Vec<ImportWarning>, code: &str, sid: &str) {
    if let Some(warning) = w
        .iter_mut()
        .rev()
        .find(|v| v.code == code && v.session_id.as_deref() == Some(sid))
    {
        warning.count += 1;
    } else {
        w.push(ImportWarning {
            count: 1,
            code: code.into(),
            session_id: Some(sid.into()),
        });
    }
}
pub(super) fn timestamp(v: &Value) -> Option<u64> {
    v.as_u64().filter(|n| *n <= MAX_SAFE_INTEGER)
}
pub(super) fn safe_name(v: &str) -> bool {
    !v.is_empty()
        && v.len() <= 255
        && !v.starts_with('.')
        && !v.chars().any(|c| c.is_control() || matches!(c, '/' | '\\'))
}
pub(super) fn file_in(
    root: &Dir,
    dirs: &[&str],
    file: &str,
    max: usize,
) -> Result<Option<Vec<u8>>> {
    let mut current = None;
    for name in dirs {
        let parent = current.as_ref().unwrap_or(root);
        let Some(next) = parent.child(name)? else {
            return Ok(None);
        };
        current = Some(next);
    }
    current.as_ref().unwrap_or(root).file(file, max)
}
struct History {
    bytes: Vec<u8>,
    raw_sdk: bool,
}
fn history(
    root: &Dir,
    sid: &str,
    sdk: Option<&str>,
    budget: &mut Budget,
) -> Result<Option<History>> {
    let max = MAX_LOG.min(budget.bytes);
    if let Some(bytes) = file_in(root, &["agent-sessions"], &format!("{sid}.jsonl"), max)? {
        budget.charge(bytes.len())?;
        if !bytes.iter().all(u8::is_ascii_whitespace) {
            return Ok(Some(History {
                bytes,
                raw_sdk: false,
            }));
        }
    }
    let Some(sdk) = sdk.filter(|v| id(v).is_ok()) else {
        return Ok(None);
    };
    let Some(config) = root.child("sdk-config")? else {
        return Ok(None);
    };
    let Some(projects) = config.child("projects")? else {
        return Ok(None);
    };
    let mut found = None;
    for name in projects.project_names()? {
        let Some(project) = projects.child(&name)? else {
            continue;
        };
        if let Some(bytes) = project.file(&format!("{sdk}.jsonl"), MAX_LOG.min(budget.bytes))? {
            budget.charge(bytes.len())?;
            if found.is_some() {
                return Err(DesktopError("ambiguousHistory"));
            }
            found = Some(History {
                bytes,
                raw_sdk: true,
            });
        }
    }
    Ok(found)
}
pub(super) fn read(root: &Path, expected: Option<(u64, u64)>) -> Result<ImportBatch> {
    let root = Dir::selected(root)?;
    if let Some(expected) = expected {
        if root.identity()? != expected {
            return Err(DesktopError("unsafeImportPath"));
        }
    }
    let mut result = ImportBatch::default();
    let projects = projects::ProjectIndex::read(&root, &mut result);
    let Some(bytes) = root.file("agent-sessions.json", MAX_INDEX)? else {
        return if projects.valid {
            Ok(result)
        } else {
            Err(DesktopError("invalidImportFolder"))
        };
    };
    let index: Value =
        serde_json::from_slice(&bytes).map_err(|_| DesktopError("invalidImportIndex"))?;
    let version = index["version"]
        .as_u64()
        .ok_or(DesktopError("invalidImportIndex"))?;
    if version != 1 {
        return Err(DesktopError("unsupportedImportVersion"));
    }
    let rows = index["sessions"]
        .as_array()
        .ok_or(DesktopError("invalidImportIndex"))?;
    if rows.len() > 128 {
        return Err(DesktopError("importLimit"));
    }
    let mut ids = HashSet::new();
    let mut budget = Budget {
        bytes: MAX_TOTAL,
        output: 16 * 1024 * 1024,
    };
    for row in rows {
        let Some(sid) = row["id"].as_str().filter(|sid| id(sid).is_ok()) else {
            result.skipped += 1;
            result.warnings.push(ImportWarning {
                count: 1,
                code: "invalidSession".into(),
                session_id: None,
            });
            continue;
        };
        if !ids.insert(sid) {
            result.skipped += 1;
            warning(&mut result.warnings, "duplicateSession", sid);
            continue;
        }
        let outcome = (|| {
            let title = row["title"]
                .as_str()
                .filter(|s| s.len() <= 1024 && !s.chars().any(char::is_control))
                .ok_or(DesktopError("invalidSession"))?;
            let created_at = timestamp(&row["createdAt"]).ok_or(DesktopError("invalidSession"))?;
            let updated_at = timestamp(&row["updatedAt"]).ok_or(DesktopError("invalidSession"))?;
            if updated_at < created_at {
                return Err(DesktopError("invalidSession"));
            }
            let history = history(&root, sid, row["sdkSessionId"].as_str(), &mut budget)?
                .ok_or(DesktopError("missingHistory"))?;
            let slug = projects.slug(&row["workspaceId"]);
            let mut s = SourceSession {
                source_session_id: sid.into(),
                title: title.into(),
                created_at,
                updated_at,
                archived: row["archived"].as_bool().unwrap_or(false),
                pinned: row["pinned"].as_bool().unwrap_or(false),
                messages: vec![],
                attachments: vec![],
            };
            records::parse(
                &history.bytes,
                history.raw_sdk,
                &root,
                slug,
                &mut s,
                &mut budget,
                &mut result.warnings,
            )?;
            projects::associate(&row["workspaceId"], sid, &mut result)?;
            Ok(s)
        })();
        match outcome {
            Ok(s) => {
                result.sessions.push(s);
            }
            Err(DesktopError("importLimit")) => return Err(DesktopError("importLimit")),
            Err(e) => {
                let code = match e.0 {
                    "unsafeImportPath" => "unsafeSource",
                    "importReadFailed" => "invalidHistory",
                    code => code,
                };
                warning(&mut result.warnings, code, sid);
                result.skipped += 1;
            }
        }
    }
    Ok(result)
}
