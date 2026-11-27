//! 从已完成的原生改图收据解析草稿候选；所有路径和 ID 都在会话边界内重建。
use super::*;

pub(super) const FORK_HISTORY_REVISION: &str = "fork-history-v1";

impl ImageTurn {
    pub(crate) fn is_fork_history(&self) -> bool {
        self.route()
            .is_some_and(|r| r.revision == FORK_HISTORY_REVISION)
    }

    pub(crate) fn is_revision_candidate(&self, session_is_local: bool) -> bool {
        (session_is_local || self.admitted_locally)
            && !self.is_fork_history()
            && self.status == ImageStatus::Succeeded
            && self.asset.is_some()
            && self.base_image_id.is_some()
            && self.route().is_some_and(|r| r.action == ImageAction::Edit)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RevisionImageReference {
    pub image_id: String,
    pub local_path: String,
    pub filename: String,
    pub media_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_message_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_attachment_path: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum RevisionInput {
    Imported(ImportedImage),
    Generated { request: String, sha256: String },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct RevisionImageEdit {
    pub prompt: String,
    pub route: ImageRoute,
    pub input_id: String,
    pub request_id: String,
    session: String,
    pub(super) session_is_local: bool,
    input: RevisionInput,
}

impl RevisionImageReference {
    pub(crate) fn from_import(session: &str, image: &ImportedImage) -> Self {
        let owner = image.history_source.as_ref();
        let id = imports::reference_id(session, &image.display_name, &image.content_sha256, owner);
        let mut reference = Self::new(session, id);
        reference.display_name = Some(image.display_name.clone());
        if let Some(source) = owner {
            let name = crate::legacy_attachments::managed_name(
                &source.attachment_id,
                &image.content_sha256,
                "png",
            );
            reference.source_message_id =
                Some(format!("electron-import:{session}:{}", source.message_id));
            reference.source_attachment_path = Some(format!("{session}/{name}"));
        }
        reference
    }

    pub(crate) fn from_generated(session: &str, request: &str) -> Self {
        let mut reference = Self::new(session, image_id(session, request));
        reference.source_message_id = Some(format!("native-image-{session}-{request}-assistant"));
        reference
    }

    fn new(session: &str, image_id: String) -> Self {
        let filename = format!("{image_id}.png");
        Self {
            image_id,
            local_path: format!("{session}/{filename}"),
            filename,
            media_type: "image/png".into(),
            display_name: None,
            source_message_id: None,
            source_attachment_path: None,
        }
    }
}

impl RevisionImageEdit {
    pub(crate) fn reference_in(&self, child: &str) -> RevisionImageReference {
        match &self.input {
            RevisionInput::Generated { request, .. } => {
                RevisionImageReference::from_generated(child, request)
            }
            RevisionInput::Imported(a) => RevisionImageReference::from_import(child, a),
        }
    }
}

impl SessionImages {
    pub(super) fn revision_edit(
        &self,
        session: &str,
        request: &str,
        session_is_local: bool,
    ) -> Result<RevisionImageEdit> {
        let entry = self
            .routed
            .get(request)
            .filter(|entry| entry.turn.is_revision_candidate(session_is_local))
            .ok_or(DesktopError("forkUnsupported"))?;
        let base = entry
            .turn
            .base_image_id
            .as_ref()
            .ok_or(DesktopError("forkUnsupported"))?;
        let mut candidates = self
            .imports
            .iter()
            .filter(|a| &a.id == base)
            .cloned()
            .map(RevisionInput::Imported)
            .chain(self.turns().filter_map(|t| {
                let asset = t.asset.as_ref().filter(|a| &a.id == base)?;
                Some(RevisionInput::Generated {
                    request: t.request_id.clone(),
                    sha256: asset.content_sha256.clone(),
                })
            }));
        let input = candidates.next().ok_or(DesktopError("forkUnsupported"))?;
        if candidates.next().is_some() {
            return Err(DesktopError("forkUnsupported"));
        }
        Ok(RevisionImageEdit {
            session: session.into(),
            session_is_local,
            request_id: request.into(),
            prompt: entry.turn.prompt.clone(),
            route: entry.route.clone(),
            input_id: base.clone(),
            input,
        })
    }
}

impl ImageStore {
    pub(crate) fn revision_edit(
        &self,
        source: &str,
        request: &str,
        session_is_local: bool,
    ) -> Result<RevisionImageEdit> {
        let dir = self.session(source)?;
        let _guard = self.guard()?;
        SessionImages::open(&dir, source)?.revision_edit(source, request, session_is_local)
    }
}
