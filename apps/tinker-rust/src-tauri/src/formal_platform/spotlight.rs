//! 保留现有引导状态形状和位置守卫；仅修改本地引导状态，不伪造外部能力。
use super::protocol::*;
use crate::desktop_runtime::protocol::{DesktopError, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OnboardingState {
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_step: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_sub_stage: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<u64>,
}
const STEPS: [(&str, u32); 3] = [("configure-llm", 3), ("connect-zotero", 2), ("new-task", 2)];
fn now() -> Result<u64> {
    u64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| DesktopError("invalidClock"))?
            .as_millis(),
    )
    .ok()
    .filter(|n| *n <= MAX_SAFE_INTEGER)
    .ok_or(DesktopError("invalidClock"))
}
impl OnboardingState {
    pub(crate) fn initial() -> Self {
        Self {
            status: "in-progress".into(),
            current_step: Some(STEPS[0].0.into()),
            current_sub_stage: Some(0),
            finished_at: None,
        }
    }
    pub(crate) fn validate(&self) -> Result<()> {
        match self.status.as_str() {
            "in-progress"
                if self.finished_at.is_none()
                    && STEPS.iter().any(|(step, total)| {
                        self.current_step.as_deref() == Some(step)
                            && self.current_sub_stage.is_some_and(|s| s < *total)
                    }) =>
            {
                Ok(())
            }
            "completed" | "skipped"
                if self.current_step.is_none()
                    && self.current_sub_stage.is_none()
                    && self.finished_at.is_some_and(|n| n <= MAX_SAFE_INTEGER) =>
            {
                Ok(())
            }
            "idle"
                if self.current_step.is_none()
                    && self.current_sub_stage.is_none()
                    && self.finished_at.is_none() =>
            {
                Ok(())
            }
            _ => Err(DesktopError("invalidParams")),
        }
    }
    fn finish(&mut self, status: &str) -> Result<()> {
        *self = Self {
            status: status.into(),
            current_step: None,
            current_sub_stage: None,
            finished_at: Some(now()?),
        };
        Ok(())
    }
    fn advance(&mut self) -> Result<()> {
        if self.status != "in-progress" {
            return Ok(());
        }
        let position = STEPS
            .iter()
            .position(|(step, _)| Some(*step) == self.current_step.as_deref())
            .ok_or(DesktopError("invalidParams"))?;
        let sub = self
            .current_sub_stage
            .ok_or(DesktopError("invalidParams"))?;
        if sub + 1 < STEPS[position].1 {
            self.current_sub_stage = Some(sub + 1);
        } else if position + 1 < STEPS.len() {
            self.current_step = Some(STEPS[position + 1].0.into());
            self.current_sub_stage = Some(0);
        } else {
            self.finish("completed")?;
        }
        Ok(())
    }
    pub(crate) fn apply(&mut self, channel: &str, args: &[Value]) -> Result<()> {
        match channel {
            "onboarding-spotlight:advance" => {
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase", deny_unknown_fields)]
                struct Advance {
                    from: String,
                    from_sub_stage: u32,
                }
                if args.len() != 1 {
                    return Err(DesktopError("invalidParams"));
                }
                let input: Advance = decode(args[0].clone())?;
                if !STEPS
                    .iter()
                    .any(|(s, total)| *s == input.from && input.from_sub_stage < *total)
                {
                    return Err(DesktopError("invalidParams"));
                }
                if self.current_step.as_ref() == Some(&input.from)
                    && self.current_sub_stage == Some(input.from_sub_stage)
                {
                    self.advance()?;
                }
            }
            _ => {
                if !args.is_empty() {
                    return Err(DesktopError("invalidParams"));
                }
                match channel {
                    "onboarding-spotlight:start" => {
                        if self.status != "in-progress" {
                            *self = Self::initial()
                        }
                    }
                    "onboarding-spotlight:restart" => *self = Self::initial(),
                    "onboarding-spotlight:skip-sub-stage" => self.advance()?,
                    "onboarding-spotlight:complete" => self.finish("completed")?,
                    "onboarding-spotlight:skip" => self.finish("skipped")?,
                    _ => return Err(DesktopError("unsupported")),
                }
            }
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConceptTour {
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_sub_stage: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<u64>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConceptState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evidence_set: Option<ConceptTour>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paper_notes: Option<ConceptTour>,
}
impl ConceptState {
    pub(crate) fn validate(&self) -> Result<()> {
        for (tour, total) in [(&self.evidence_set, 3), (&self.paper_notes, 2)] {
            if let Some(t) = tour {
                match t.status.as_str() {
                    "in-progress"
                        if t.finished_at.is_none()
                            && t.current_sub_stage.is_some_and(|s| s < total) => {}
                    "completed" | "skipped"
                        if t.current_sub_stage.is_none()
                            && t.finished_at.is_some_and(|n| n <= MAX_SAFE_INTEGER) => {}
                    _ => return Err(DesktopError("invalidParams")),
                }
            }
        }
        Ok(())
    }
    pub(crate) fn apply(&mut self, channel: &str, args: &[Value]) -> Result<()> {
        if args.len() != 1 {
            return Err(DesktopError("invalidParams"));
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Input {
            tour: String,
            #[serde(default)]
            from_sub_stage: Option<u32>,
        }
        let input: Input = decode(args[0].clone())?;
        let (slot, total) = match input.tour.as_str() {
            "evidenceSet" => (&mut self.evidence_set, 3),
            "paperNotes" => (&mut self.paper_notes, 2),
            _ => return Err(DesktopError("invalidParams")),
        };
        let initial = || {
            Some(ConceptTour {
                status: "in-progress".into(),
                current_sub_stage: Some(0),
                finished_at: None,
            })
        };
        let finish = |status: &str| -> Result<Option<ConceptTour>> {
            Ok(Some(ConceptTour {
                status: status.into(),
                current_sub_stage: None,
                finished_at: Some(now()?),
            }))
        };
        if channel != "concept-spotlight:advance" && input.from_sub_stage.is_some() {
            return Err(DesktopError("invalidParams"));
        }
        match channel {
            "concept-spotlight:start" => {
                if slot.as_ref().is_none_or(|s| s.status != "in-progress") {
                    *slot = initial();
                }
            }
            "concept-spotlight:restart" => *slot = initial(),
            "concept-spotlight:skip" => *slot = finish("skipped")?,
            "concept-spotlight:complete" => *slot = finish("completed")?,
            "concept-spotlight:advance" => {
                let from = input
                    .from_sub_stage
                    .filter(|s| *s < total)
                    .ok_or(DesktopError("invalidParams"))?;
                if let Some(current) = slot {
                    if current.status == "in-progress" && current.current_sub_stage == Some(from) {
                        if from + 1 < total {
                            current.current_sub_stage = Some(from + 1);
                        } else {
                            *slot = finish("completed")?;
                        }
                    }
                }
            }
            _ => return Err(DesktopError("unsupported")),
        }
        Ok(())
    }
}
