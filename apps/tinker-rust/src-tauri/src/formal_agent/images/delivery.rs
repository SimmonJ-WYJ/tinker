//! 工作者只提交持久化结果；完成后由原 actor 按序号发出有限的终态事件。
use super::*;
impl ImageWorkflow {
    pub(super) fn deliver_finished(&mut self, actor: &mut Actor) {
        let finished = self
            .jobs
            .iter()
            .filter(|(_, job)| job.worker.is_finished())
            .map(|(sid, _)| sid.clone())
            .collect::<Vec<_>>();
        for sid in finished {
            let Some(job) = self.jobs.remove(&sid) else {
                continue;
            };
            let turn = job
                .worker
                .join()
                .unwrap_or(Err(DesktopError("hostUnavailable")));
            let identity = json!({"sessionId":sid,"requestId":job.id,"startedAt":job.started});
            let stopped = turn.as_ref().is_ok_and(ImageTurn::user_stopped);
            let mut events = VecDeque::new();
            let result = turn.and_then(|turn| {
                actor.core("sessions.update", json!({"sessionId":sid}))?;
                let (turns, imports) = self.store.snapshot(&sid)?;
                let (_, sdk) = project(&sid, &turn, &turns, &imports);
                for mut message in sdk {
                    if message["type"] == "assistant" {
                        message["_desktopTaskRetryable"] = json!(matches!(
                            turn.task_status(),
                            crate::session_lifecycle::RunStatus::Failed
                                | crate::session_lifecycle::RunStatus::Interrupted
                        ));
                    }
                    let event = projection::stream(
                        &identity,
                        json!({"kind":"sdk_message","message":message}),
                    );
                    events.push_back(("agent:stream:event", event));
                }
                terminal_result(&turn)
            });
            if result.is_err() {
                let mut error = identity.clone();
                error["error"] = json!("responseFailed");
                events.push_back(("agent:stream:error", error));
            }
            let mut complete = identity;
            complete["stoppedByUser"] = json!(stopped);
            complete["resultSubtype"] = json!(if result.is_ok() && !stopped {
                "success"
            } else {
                "error_during_execution"
            });
            events.push_back(("agent:stream:complete", complete));
            self.deliveries.insert(sid, events);
            for reply in job.replies {
                let _ = reply.send(result.clone());
            }
        }
        if actor.attached {
            self.deliveries.retain(|sid, events| {
                if !actor.barriers.contains_key(sid) {
                    while let Some((channel, event)) = events.front() {
                        if !actor.emit(channel, event.clone()) {
                            break;
                        }
                        events.pop_front();
                    }
                }
                !events.is_empty()
            });
        }
    }
}
