//! Store a passive conversation prefix using the same journal commit as portable history.
use super::*;
use crate::desktop_runtime::activity_time;

impl DesktopRuntime {
    pub(crate) fn fork_completed_turns(
        &self,
        source: &str,
        anchor: &str,
        mut turns: Vec<Turn>,
        prepare_assets: impl FnOnce(&str) -> Result<()>,
    ) -> Result<Value> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| DesktopError("runtimeUnavailable"))?;
        let parent = inner.session(source)?;
        let workspace = inner.session_workspace(parent).map(str::to_owned);
        let profile = parent.profile_id.clone();
        let now = activity_time(parent.updated_at)?;
        // The next unpublished slot for this exact anchor is stable across crashes,
        // even if another conversation is created before the user retries.
        let mut slot = 0;
        let sid = loop {
            let sid = format!(
                "portable-{}",
                &digest(&("fork-v1", source, anchor, slot))?[..40]
            );
            if !inner.sessions.contains_key(&sid) {
                break sid;
            }
            slot += 1;
        };
        let intent = inner.journal.root.join(format!(".fork-{sid}.json"));
        let suffix = " (fork)";
        let mut name = parent.title.as_str();
        while name.len() + suffix.len() > 1024 {
            name = &name[..name.char_indices().next_back().unwrap().0];
        }
        let session = Session {
            session_id: sid.clone(),
            workspace_id: workspace.clone(),
            profile_id: profile.clone(),
            title: format!("{name}{suffix}"),
            created_at: now,
            updated_at: now,
            pinned: false,
            archived: false,
            deleted: false,
        };
        let resumed = intent.try_exists()?;
        let session = if resumed {
            let held: Session = read_json(&intent)?;
            if held.session_id != sid
                || held.workspace_id != workspace
                || held.profile_id != profile
            {
                return Err(DesktopError("importConflict"));
            }
            held
        } else {
            session
        };
        for (index, turn) in turns.iter_mut().enumerate() {
            if turn.session_id != source
                || turn.status != crate::session_lifecycle::RunStatus::Completed
            {
                return Err(DesktopError("forkUnsupported"));
            }
            turn.session_id = sid.clone();
            let rid = format!("fork-{}-{index}", &sid["portable-".len()..]);
            turn.user_message_id = format!("{rid}-user");
            turn.assistant_message_id = format!("{rid}-assistant");
            turn.request_id = rid.clone();
            turn.run_id = rid;
            turn.profile_id = "portable-history".into();
            turn.model_id = "portable-history".into();
            turn.config_revision = "portable-history-v1".into();
            turn.effort = None;
        }
        let seed = PortableSession {
            session: session.clone(),
            messages: vec![],
            attachments: vec![],
            turns,
        };
        // Reject a prefix too large for even the first follow-up before publishing it.
        RunContext::prepend(&seed.seed(String::new()).prefix(), &RunContext::single("x"))?;
        let values = std::slice::from_ref(&seed);
        preflight(&inner, workspace.as_deref(), &profile, values)?;
        if !resumed {
            // A torn temporary intent has never been published; its timestamp may differ on retry.
            let tmp = intent.with_file_name(format!("..fork-{sid}.json.tmp"));
            store::safe_file(&tmp)?;
            if tmp.try_exists()? {
                fs::remove_file(&tmp)?;
            }
            write_json(&intent, &session)?;
        }
        prepare_assets(&sid)?;
        publish(&mut inner, values, || Ok(()))?;
        // Once journaled the session is authoritative even if cleanup fails.
        let _ = fs::remove_file(intent);
        Ok(json!(session))
    }
}
