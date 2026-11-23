//! 纯关闭门：宿主提供generation和已确认revision；窗口/取消/join由宿主接线。
use crate::desktop_runtime::protocol::{DesktopError, Result};
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CloseTicket {
    pub generation: String,
    pub close_token: String,
    pub baseline_revision: u64,
}
enum Phase {
    Open,
    Preparing {
        ticket: CloseTicket,
        started: Instant,
    },
    Draining,
    Closed,
}
pub struct CloseGate {
    phase: Phase,
    timeout: Duration,
    sequence: u64,
    aborted: Option<String>,
}
impl CloseGate {
    pub fn new(timeout: Duration) -> Result<Self> {
        if timeout.is_zero() || timeout > Duration::from_secs(60) {
            return Err(DesktopError("invalidParams"));
        }
        Ok(Self {
            phase: Phase::Open,
            timeout,
            sequence: 0,
            aborted: None,
        })
    }
    pub fn begin(&mut self, generation: &str, revision: u64) -> Result<CloseTicket> {
        super::protocol::identifier(generation)?;
        if revision > super::protocol::MAX_SAFE_INTEGER {
            return Err(DesktopError("invalidParams"));
        }
        self.expire();
        match &self.phase {
            Phase::Preparing { ticket, .. } if ticket.generation == generation => {
                return Ok(ticket.clone())
            }
            Phase::Preparing { .. } => return Err(DesktopError("staleGeneration")),
            Phase::Draining | Phase::Closed => return Err(DesktopError("closing")),
            Phase::Open => {}
        }
        self.sequence = self
            .sequence
            .checked_add(1)
            .ok_or(DesktopError("storageLimit"))?;
        let ticket = CloseTicket {
            generation: generation.into(),
            close_token: format!("{generation}-close-{}", self.sequence),
            baseline_revision: revision,
        };
        self.phase = Phase::Preparing {
            ticket: ticket.clone(),
            started: Instant::now(),
        };
        Ok(ticket)
    }
    /// 必须在宿主串行队列中读取platform revision并调用；进入Draining后冻结平台变更。
    pub fn ready(
        &mut self,
        generation: &str,
        token: &str,
        committed_revision: u64,
        actual_revision: u64,
    ) -> Result<()> {
        if self.expire() {
            return Err(DesktopError("closeTimeout"));
        }
        match &self.phase {
            Phase::Preparing { ticket, .. }
                if ticket.generation == generation && ticket.close_token == token =>
            {
                if committed_revision != actual_revision
                    || committed_revision < ticket.baseline_revision
                    || actual_revision > super::protocol::MAX_SAFE_INTEGER
                {
                    return Err(DesktopError("revisionConflict"));
                }
                self.phase = Phase::Draining;
                Ok(())
            }
            _ => Err(DesktopError("invalidCloseToken")),
        }
    }
    pub fn abort(&mut self, token: &str) -> Result<()> {
        self.expire();
        if matches!(self.phase, Phase::Open) && self.aborted.as_deref() == Some(token) {
            return Ok(());
        }
        match &self.phase {
            Phase::Preparing { ticket, .. } if ticket.close_token == token => {
                self.aborted = Some(token.into());
                self.phase = Phase::Open;
                Ok(())
            }
            _ => Err(DesktopError("invalidCloseToken")),
        }
    }
    /// 宿主timer调用；超时恢复Open，不能直接关窗。
    pub fn expire(&mut self) -> bool {
        if matches!(&self.phase,Phase::Preparing {started,..} if started.elapsed()>=self.timeout) {
            if let Phase::Preparing { ticket, .. } = &self.phase {
                self.aborted = Some(ticket.close_token.clone());
            }
            self.phase = Phase::Open;
            true
        } else {
            false
        }
    }
    /// 只有宿主已durable cancel并join自身worker后才调用。
    pub fn complete(&mut self) -> Result<()> {
        if !matches!(self.phase, Phase::Draining) {
            return Err(DesktopError("invalidCloseToken"));
        }
        self.phase = Phase::Closed;
        Ok(())
    }
    #[cfg(all(target_os = "macos", feature = "formal-preview"))]
    pub(crate) fn sequence(&self) -> u64 {
        self.sequence
    }
    pub fn allows_send(&self) -> bool {
        matches!(self.phase, Phase::Open)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_matching_generation_token_and_latest_durable_revision_can_drain() {
        let mut g = CloseGate::new(Duration::from_secs(5)).unwrap();
        let ticket = g.begin("doc-a", 7).unwrap();
        assert!(!g.allows_send());
        assert_eq!(g.begin("doc-a", 8).unwrap(), ticket);
        assert!(g.ready("doc-b", &ticket.close_token, 8, 8).is_err());
        assert!(g.ready("doc-a", "old-token", 8, 8).is_err());
        assert!(g.ready("doc-a", &ticket.close_token, 7, 8).is_err());
        g.ready("doc-a", &ticket.close_token, 8, 8).unwrap();
        assert!(g.begin("doc-a", 8).is_err());
        g.complete().unwrap();
        assert!(!g.allows_send());
    }
    #[test]
    fn expired_and_repeated_abort_confirm_the_same_transaction_is_open() {
        let mut gate = CloseGate::new(Duration::from_nanos(1)).unwrap();
        let ticket = gate.begin("document-1", 1).unwrap();
        assert!(gate.expire());
        gate.abort(&ticket.close_token).unwrap();
        gate.abort(&ticket.close_token).unwrap();
        assert!(gate.allows_send());
        assert!(gate.abort("unknown").is_err());
    }
    #[test]
    fn abort_timeout_and_stale_tokens_cannot_close_a_new_transaction() {
        let mut g = CloseGate::new(Duration::from_secs(5)).unwrap();
        let old = g.begin("doc-a", 1).unwrap();
        g.abort(&old.close_token).unwrap();
        assert!(g.allows_send());
        let new = g.begin("doc-a", 1).unwrap();
        assert_ne!(old.close_token, new.close_token);
        assert!(g.ready("doc-a", &old.close_token, 1, 1).is_err());
        g.abort(&new.close_token).unwrap();
        let mut g = CloseGate::new(Duration::from_nanos(1)).unwrap();
        let expired = g.begin("doc-a", 1).unwrap();
        assert_eq!(
            g.ready("doc-a", &expired.close_token, 1, 1).unwrap_err().0,
            "closeTimeout"
        );
        assert!(g.allows_send());
    }
}
