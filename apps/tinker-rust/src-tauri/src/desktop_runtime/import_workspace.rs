//! 旧导入会话的不可变项目认领；不改旧seed或journal的workspace字段。
use super::*;
const ASSOCIATION_FILE: &str = "import-workspace-v1.json";
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Association {
    version: u32,
    session_id: String,
    source_session_id: String,
    fingerprint: String,
    workspace_id: String,
    integrity: String,
}
fn integrity(association: &Association) -> Result<String> {
    digest(&(
        association.version,
        &association.session_id,
        &association.source_session_id,
        &association.fingerprint,
        &association.workspace_id,
    ))
}
pub(super) fn load_claim(seed: &mut Seed, dir: &Path) -> Result<()> {
    let path = dir.join(ASSOCIATION_FILE);
    store::safe_file(&path)?;
    if !path.exists() {
        return Ok(());
    }
    let association: Association = read_json(&path)?;
    if association.version != 1 {
        return Err(DesktopError("unsupportedVersion"));
    }
    if association.integrity != integrity(&association)?
        || association.session_id != seed.session.session_id
        || association.source_session_id != seed.source_session_id
        || association.fingerprint != seed.fingerprint
        || seed.session.workspace_id.is_some()
        || id(&association.workspace_id).is_err()
    {
        return Err(DesktopError("corruptImport"));
    }
    seed.claimed_workspace = Some(association.workspace_id);
    Ok(())
}
pub(super) fn claim(seed: &mut Seed, dir: &Path, requested: Option<&str>) -> Result<()> {
    claim_with_sync(seed, dir, requested, store::sync_directory)
}
fn claim_with_sync(
    seed: &mut Seed,
    dir: &Path,
    requested: Option<&str>,
    sync: impl Fn(&Path) -> Result<()>,
) -> Result<()> {
    if let Some(workspace) = requested {
        id(workspace)?;
        if seed.workspace().is_some_and(|current| current != workspace) {
            return Err(DesktopError("importConflict"));
        }
    }
    if seed.claimed_workspace.is_some() {
        // 已存在不代表上次rename已确认；任何成功重试都再次确认文件与父目录。
        let path = dir.join(ASSOCIATION_FILE);
        store::safe_file(&path)?;
        File::open(path)?.sync_all()?;
        sync(dir)?;
    }
    let Some(workspace) = requested else {
        return Ok(());
    };
    if seed.workspace().is_some() {
        return Ok(());
    }
    let mut association = Association {
        version: 1,
        session_id: seed.session.session_id.clone(),
        source_session_id: seed.source_session_id.clone(),
        fingerprint: seed.fingerprint.clone(),
        workspace_id: workspace.into(),
        integrity: String::new(),
    };
    association.integrity = integrity(&association)?;
    write_json_with_sync(&dir.join(ASSOCIATION_FILE), &association, sync)?;
    seed.claimed_workspace = Some(workspace.into());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::desktop_runtime::import_tests::{profiles, source, Temp};
    #[test]
    fn claimed_workspace_retry_confirms_parent_sync_after_uncertain_rename() {
        let temp = Temp::new();
        let runtime = DesktopRuntime::open(&temp.0, profiles("http://127.0.0.1:9/chat")).unwrap();
        let sid = runtime
            .import_electron_session(&source(), "synthetic-local", |_| Ok(vec![]))
            .unwrap()
            .session_id;
        let dir = temp.0.join("desktop-runtime-v1").join(&sid);
        let original = fs::read(dir.join(SEED_FILE)).unwrap();
        let mut seed = load(&dir, &sid).unwrap();
        assert_eq!(
            claim_with_sync(&mut seed, &dir, Some("project-a"), |_| Err(DesktopError(
                "storeIo"
            ))),
            Err(DesktopError("storeIo"))
        );
        assert!(dir.join(ASSOCIATION_FILE).is_file());
        assert_eq!(seed.claimed_workspace, None);
        drop(runtime);
        let _reopened = DesktopRuntime::open(&temp.0, profiles("http://127.0.0.1:9/chat")).unwrap();
        let mut fresh = load(&dir, &sid).unwrap();
        let calls = std::cell::Cell::new(0);
        assert_eq!(
            claim_with_sync(&mut fresh, &dir, Some("project-a"), |_| {
                calls.set(calls.get() + 1);
                Err(DesktopError("storeIo"))
            }),
            Err(DesktopError("storeIo"))
        );
        assert_eq!(calls.get(), 1);
        assert_eq!(
            claim_with_sync(&mut fresh, &dir, None, |_| Err(DesktopError("storeIo"))),
            Err(DesktopError("storeIo"))
        );
        assert_eq!(
            claim_with_sync(&mut fresh, &dir, Some("project-b"), |_| panic!(
                "冲突无需同步"
            )),
            Err(DesktopError("importConflict"))
        );
        claim_with_sync(&mut fresh, &dir, Some("project-a"), store::sync_directory).unwrap();
        assert_eq!(fresh.workspace(), Some("project-a"));
        assert_eq!(fs::read(dir.join(SEED_FILE)).unwrap(), original);
    }
}
