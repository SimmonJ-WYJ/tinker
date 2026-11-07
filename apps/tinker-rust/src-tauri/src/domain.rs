// Tinker Rust 新模块：仅实现内存草稿，不读取现有应用数据。
#[derive(Debug, PartialEq)]
pub enum DraftError {
    EmptyInput,
    InputTooLarge,
    ModelNotMigrated,
}
#[derive(Default)]
pub struct Workspace {
    draft: String,
}
impl Workspace {
    pub fn draft(&self) -> &str {
        &self.draft
    }
    pub fn save(&mut self, input: String) -> Result<(), DraftError> {
        if input.len() > 65_536 {
            return Err(DraftError::InputTooLarge);
        }
        self.draft = input;
        Ok(())
    }
    pub fn submit(&mut self, input: String) -> Result<(), DraftError> {
        self.save(input)?;
        if self.draft.trim().is_empty() {
            return Err(DraftError::EmptyInput);
        }
        Err(DraftError::ModelNotMigrated)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restores_exact_draft_including_whitespace() {
        let mut state = Workspace::default();
        state.save("  修改这张图\n".into()).unwrap();
        assert_eq!(state.draft(), "  修改这张图\n");
    }
    #[test]
    fn unavailable_model_preserves_submitted_input() {
        let mut state = Workspace::default();
        assert_eq!(
            state.submit("继续修改".into()),
            Err(DraftError::ModelNotMigrated)
        );
        assert_eq!(state.draft(), "继续修改");
    }
    #[test]
    fn empty_request_is_rejected() {
        assert_eq!(
            Workspace::default().submit("  ".into()),
            Err(DraftError::EmptyInput)
        );
    }
    #[test]
    fn oversized_input_does_not_replace_previous_draft() {
        let mut state = Workspace::default();
        state.save("保留".into()).unwrap();
        assert_eq!(
            state.save("x".repeat(65_537)),
            Err(DraftError::InputTooLarge)
        );
        assert_eq!(state.draft(), "保留");
    }
    #[test]
    fn explicit_clear_is_allowed() {
        let mut state = Workspace::default();
        state.save("草稿".into()).unwrap();
        state.save(String::new()).unwrap();
        assert_eq!(state.draft(), "");
    }
}
