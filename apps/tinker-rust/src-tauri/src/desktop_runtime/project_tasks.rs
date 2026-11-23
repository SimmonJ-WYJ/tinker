//! 项目概览仅读取已经恢复的绑定和执行状态，无需重放消息或再次打开日志。
use super::{protocol::*, DesktopRuntime};
use crate::session_lifecycle::RunStatus;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectTaskStatus {
    session_id: String,
    request_id: String,
    status: RunStatus,
}
impl DesktopRuntime {
    pub(crate) fn project_task_statuses(&self, workspace: &str) -> Result<Vec<ProjectTaskStatus>> {
        id(workspace)?;
        let inner = self
            .inner
            .lock()
            .map_err(|_| DesktopError("runtimeUnavailable"))?;
        let mut rows = Vec::new();
        // 会话数量受 MAX_SESSIONS 限制，每条只查一次最后绑定，无磁盘或网络操作。
        for session in inner.sessions.values() {
            if session.deleted
                || session.archived
                || inner.session_workspace(session) != Some(workspace)
                || inner.require_import_seed(&session.session_id).is_err()
            {
                continue;
            }
            let Some(binding) = inner
                .bindings
                .get(&session.session_id)
                .and_then(|list| list.last())
            else {
                continue;
            };
            if inner.tools.contains_key(&binding.request.profile_id) {
                continue;
            }
            let controller = inner
                .controllers
                .get(&session.session_id)
                .ok_or(DesktopError("sessionNotFound"))?;
            if let Some(status) = controller.latest_text_status(&binding.request.request_id)? {
                rows.push(ProjectTaskStatus {
                    session_id: session.session_id.clone(),
                    request_id: binding.request.request_id.clone(),
                    status,
                });
            }
        }
        Ok(rows)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::desktop_runtime::{
        import_tests::{profiles, source, Temp},
        session::{Binding, Entry},
    };
    use serde_json::json;

    #[test]
    fn claimed_legacy_project_only_shows_new_native_binding_even_if_launch_was_interrupted() {
        let temp = Temp::new();
        let open = || DesktopRuntime::open(&temp.0, profiles("http://127.0.0.1:9/chat")).unwrap();
        let rt = open();
        let sid = rt
            .import_electron_session(&source(), "synthetic-local", |_| Ok(vec![]))
            .unwrap()
            .session_id;
        rt.import_electron_session_in_workspace(
            &source(),
            "synthetic-local",
            Some("claimed"),
            |_| panic!(),
        )
        .unwrap();
        assert!(rt.project_task_statuses("claimed").unwrap().is_empty());
        // 模拟 Bind 已同步、尚未启动 provider 时进程退出。旧导入的正文不产生任务。
        rt.inner
            .lock()
            .unwrap()
            .journal
            .append(Entry::Bind {
                binding: Binding {
                    request: Send {
                        session_id: sid.clone(),
                        request_id: "bound-only".into(),
                        profile_id: "synthetic-local".into(),
                        model_id: "synthetic-model".into(),
                        effort: None,
                        user_message: "fixture".into(),
                        started_at: 300,
                    },
                    accepted_at: 300,
                    config_revision: "r1".into(),
                    parent_run_id: None,
                },
            })
            .unwrap();
        drop(rt);
        let rt = open();
        assert_eq!(
            json!(rt.project_task_statuses("claimed").unwrap()),
            json!([{"sessionId":sid,"requestId":"bound-only","status":"interrupted"}])
        );
        assert!(rt.project_task_statuses("other").unwrap().is_empty());
    }
}
