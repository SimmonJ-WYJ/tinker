//! 有界父链重建；重定向许可仅来自桌面 journal 已验证的确切执行边。
use super::*;
impl RunStore {
    pub(crate) fn context_for(
        &self,
        parent: &ParentRunRef,
        child_order: u64,
        input: &str,
    ) -> Result<(RunContext, ParentRunRef), RunError> {
        self.context_for_policy(parent, child_order, input, None)
    }
    pub(crate) fn validate_redirects(&self) -> Result<(), RunError> {
        for (child, proof) in &self.redirects {
            validate_id(child)?;
            validate_parent(proof, child)?;
            let (status, sequence, recovery) = if self.find_location(&proof.run_id)? == 3 {
                let r = self.load_tool_run(&proof.run_id)?;
                (
                    r.snapshot.status,
                    r.snapshot.sequence,
                    r.snapshot.recovery_required,
                )
            } else {
                let r = self.load(&proof.run_id)?;
                (
                    r.snapshot.status,
                    r.snapshot.sequence,
                    r.snapshot.recovery_required,
                )
            };
            if status != RunStatus::Cancelled || sequence != proof.sequence || recovery {
                return Err(RunError::CorruptLog);
            }
        }
        Ok(())
    }
    pub(crate) fn redirect_policy(&self, child: &str) -> u32 {
        if self.redirects.contains_key(child) {
            REDIRECT_POLICY_VERSION
        } else {
            CONTEXT_POLICY_VERSION
        }
    }
    pub(crate) fn redirect_edge(
        &self,
        child: &str,
        parent: Option<&ParentRunRef>,
        policy: u32,
    ) -> Result<bool, RunError> {
        if policy == CONTEXT_POLICY_VERSION {
            return Ok(false);
        }
        if policy != REDIRECT_POLICY_VERSION {
            return Err(RunError::UnsupportedVersion);
        }
        match (self.redirects.get(child), parent) {
            (Some(proof), Some(p)) if proof == p => Ok(true),
            _ => Err(RunError::UnsupportedVersion),
        }
    }
    pub(crate) fn context_for_policy(
        &self,
        parent: &ParentRunRef,
        child_order: u64,
        input: &str,
        child: Option<(&str, u32)>,
    ) -> Result<(RunContext, ParentRunRef), RunError> {
        let mut redirected = child
            .map(|(id, v)| self.redirect_edge(id, Some(parent), v))
            .transpose()?
            .unwrap_or(false);
        let mut next = parent.clone();
        let mut order = child_order;
        let mut visited = std::collections::HashSet::new();
        let mut turns = Vec::new();
        let mut bytes = input.len();
        loop {
            if turns.len() >= MAX_CONTEXT_ANCESTORS {
                return Err(RunError::ContextLimitExceeded);
            }
            if !visited.insert(next.run_id.clone()) {
                return Err(RunError::CorruptLog);
            }
            if self.find_location(&next.run_id)? == 3 {
                return Err(RunError::ContextUnsupported);
            }
            let run = self.load(&next.run_id)?;
            if (run.snapshot.status != RunStatus::Completed
                && !(redirected && run.snapshot.status == RunStatus::Cancelled))
                || run.snapshot.recovery_required
            {
                return Err(RunError::ContextParentNotCompleted);
            }
            if run.snapshot.sequence != next.sequence || run.created_order >= order {
                return Err(RunError::CorruptLog);
            }
            bytes += run.snapshot.input.len() + run.snapshot.output.len();
            if bytes > MAX_CONTEXT_BYTES {
                return Err(RunError::ContextLimitExceeded);
            }
            turns.push((
                run.snapshot.input,
                run.snapshot.output,
                run.snapshot.status == RunStatus::Cancelled,
            ));
            order = run.created_order;
            match run.lineage {
                RunLineage::Standalone => break,
                RunLineage::Continuation {
                    parent,
                    policy_version,
                } => {
                    redirected = self.redirect_edge(&next.run_id, Some(&parent), policy_version)?;
                    next = parent;
                }
            }
        }
        turns.reverse();
        Ok((
            RunContext::from_committed_turns(turns, input)?,
            parent.clone(),
        ))
    }
    pub(crate) fn continuation_context(
        &self,
        parent_id: &str,
        input: &str,
    ) -> Result<(RunContext, ParentRunRef), RunError> {
        if self.find_location(parent_id)? == 3 {
            return Err(RunError::ContextUnsupported);
        }
        let run = self.load(parent_id)?;
        let parent = ParentRunRef {
            run_id: parent_id.into(),
            sequence: run.snapshot.sequence,
        };
        self.context_for(&parent, u64::MAX, input)
    }
    pub(crate) fn continuation_for_child(
        &self,
        child: &str,
        parent_id: &str,
        input: &str,
    ) -> Result<(RunContext, ParentRunRef), RunError> {
        if self.redirect_policy(child) == CONTEXT_POLICY_VERSION {
            return self.continuation_context(parent_id, input);
        }
        if self.find_location(parent_id)? == 3 {
            return Err(RunError::ContextUnsupported);
        }
        let run = self.load(parent_id)?;
        let parent = ParentRunRef {
            run_id: parent_id.into(),
            sequence: run.snapshot.sequence,
        };
        self.context_for_policy(
            &parent,
            u64::MAX,
            input,
            Some((child, self.redirect_policy(child))),
        )
    }
    pub(crate) fn create_continuation(
        &self,
        id: &str,
        input: String,
        scenario: OfflineScenario,
        parent: ParentRunRef,
    ) -> Result<StoredRun, RunError> {
        validate_parent(&parent, id)?;
        self.create_inner(
            id,
            input,
            scenario,
            RunLineage::Continuation {
                parent,
                policy_version: self.redirect_policy(id),
            },
        )
    }
}
