//! 项目归属和最近文字绑定来自已恢复的 journal；不重放正文或打开执行日志。
use super::{protocol::*, DesktopRuntime, Inner};
use crate::session_lifecycle::RunStatus;

pub(crate) struct TextTaskStatus {
    pub request_id: String,
    pub started_at: u64,
    pub status: RunStatus,
}
impl Inner {
    fn latest_text_task(&self, sid: &str) -> Result<Option<TextTaskStatus>> {
        let Some(binding) = self.bindings.get(sid).and_then(|list| list.last()) else {
            return Ok(None);
        };
        if self.tools.contains_key(&binding.request.profile_id) {
            return Ok(None);
        }
        let controller = self
            .controllers
            .get(sid)
            .ok_or(DesktopError("sessionNotFound"))?;
        Ok(controller
            .latest_text_status(&binding.request.request_id)?
            .map(|status| TextTaskStatus {
                request_id: binding.request.request_id.clone(),
                started_at: binding.request.started_at,
                status,
            }))
    }
}
impl DesktopRuntime {
    /// 新图片接收时记录最近文字身份；旧格式只支持按历史展示时间排序。
    pub(crate) fn image_follows_text(
        &self,
        sid: &str,
        text: Option<&TextTaskStatus>,
        image: &crate::formal_images::ImageTaskSummary,
    ) -> Result<bool> {
        match &image.text_head_at_admission {
            None => Ok(text.is_none_or(|t| t.started_at <= image.created_at)),
            Some(head) if head.as_ref() == text.map(|t| &t.request_id) => Ok(true),
            Some(None) => Ok(false),
            Some(Some(head)) => {
                // 可能是该会话中更早的绑定；其他会话的同名或缺失身份不能当作排序证据。
                let inner = self
                    .inner
                    .lock()
                    .map_err(|_| DesktopError("runtimeUnavailable"))?;
                let binding = inner
                    .binding(sid, head)
                    .map_err(|_| DesktopError("corruptImages"))?;
                if text.is_none() || inner.tools.contains_key(&binding.request.profile_id) {
                    return Err(DesktopError("corruptImages"));
                }
                Ok(false)
            }
        }
    }
    pub(crate) fn latest_text_task(&self, sid: &str) -> Result<Option<TextTaskStatus>> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| DesktopError("runtimeUnavailable"))?;
        inner.session(sid)?;
        inner.require_import_seed(sid)?;
        inner.latest_text_task(sid)
    }
    pub(crate) fn project_task_candidates(
        &self,
        workspace: &str,
    ) -> Result<Vec<(String, Option<TextTaskStatus>)>> {
        id(workspace)?;
        let inner = self
            .inner
            .lock()
            .map_err(|_| DesktopError("runtimeUnavailable"))?;
        inner
            .sessions
            .values()
            .filter(|s| {
                !s.deleted
                    && !s.archived
                    && inner.session_workspace(s) == Some(workspace)
                    && inner.require_import_seed(&s.session_id).is_ok()
            })
            // 没有文字绑定的会话仍可能持有图片任务。释放 runtime 锁后才访问图片收据。
            .map(|s| Ok((s.session_id.clone(), inner.latest_text_task(&s.session_id)?)))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::desktop_runtime::{
        import_tests::{profiles, source, Temp},
        session::{Binding, Entry},
    };

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
        let rows = rt.project_task_candidates("claimed").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].0, sid);
        assert!(rows[0].1.is_none());
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
        let rows = rt.project_task_candidates("claimed").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].0, sid);
        let task = rows[0].1.as_ref().unwrap();
        assert_eq!(task.request_id, "bound-only");
        assert_eq!(task.status, RunStatus::Interrupted);
        assert!(rt.project_task_candidates("other").unwrap().is_empty());
    }
}
