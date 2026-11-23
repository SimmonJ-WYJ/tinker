use super::{disk::ProjectDir, *};
use crate::{
    credentialed_channels::catalog::random_reference, formal_platform::protocol::identifier,
};
use sha2::{Digest, Sha256};

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Snapshot {
    workspace: String,
    document: DocumentSummary,
    digest: String,
    text: String,
}

fn valid_id(id: &str) -> bool {
    id.strip_prefix("doc-").is_some_and(|s| {
        s.len() == 32
            && s.bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    })
}

fn fingerprint(name: &str, text: &str) -> String {
    let mut hash = Sha256::new();
    hash.update(name);
    hash.update([0]);
    hash.update(text);
    format!("{:x}", hash.finalize())
}

pub(super) fn project_name(workspace: &str) -> Result<String> {
    identifier(workspace)?;
    Ok(format!(
        "project-documents-v1-{:x}",
        Sha256::digest(workspace)
    ))
}

// 固定槽位让读写都能相对同一个目录句柄寻址，后 120 位随机值区分引用身份。
pub(super) fn slot(id: &str) -> Option<usize> {
    if !valid_id(id) {
        return None;
    }
    usize::from_str_radix(&id[4..6], 16)
        .ok()
        .filter(|n| *n < MAX_PROJECT_DOCUMENTS)
}

pub(super) fn record_name(index: usize) -> String {
    format!("document-{index:02x}.json")
}

fn open_snapshot(dir: &ProjectDir, workspace: &str, index: usize) -> Result<Option<Snapshot>> {
    let Some(bytes) = dir.read(&record_name(index))? else {
        return Ok(None);
    };
    let s: Snapshot =
        serde_json::from_slice(&bytes).map_err(|_| DesktopError("corruptSnapshot"))?;
    if s.workspace != workspace
        || slot(&s.document.document_id) != Some(index)
        || s.text.len() != s.document.byte_length
        || s.text.len() > MAX_DOCUMENT_BYTES
        || check_name(&s.document.filename).is_err()
        || line_count(&s.text).ok() != Some(s.document.line_count)
        || fingerprint(&s.document.filename, &s.text) != s.digest
    {
        return Err(DesktopError("corruptSnapshot"));
    }
    Ok(Some(s))
}

struct Catalog {
    entries: Vec<(DocumentSummary, String)>,
    total_bytes: usize,
    free_slot: Option<usize>,
}

impl Catalog {
    fn load(dir: &ProjectDir, workspace: &str) -> Result<Self> {
        let mut catalog = Self {
            entries: vec![],
            total_bytes: 0,
            free_slot: None,
        };
        for index in 0..MAX_PROJECT_DOCUMENTS {
            let Some(snapshot) = open_snapshot(dir, workspace, index)? else {
                catalog.free_slot.get_or_insert(index);
                continue;
            };
            catalog.total_bytes += snapshot.document.byte_length;
            if catalog.total_bytes > MAX_PROJECT_BYTES {
                return Err(DesktopError("documentQuotaExceeded"));
            }
            catalog.entries.push((snapshot.document, snapshot.digest));
        }
        Ok(catalog)
    }
}

pub fn list(root: &TrustedRoot, workspace: &str) -> Result<Vec<DocumentSummary>> {
    let Some(dir) = ProjectDir::open(root, workspace, false)? else {
        return Ok(vec![]);
    };
    let mut entries: Vec<_> = Catalog::load(&dir, workspace)?
        .entries
        .into_iter()
        .map(|(s, _)| s)
        .collect();
    entries.sort_by(|a, b| (&a.filename, &a.document_id).cmp(&(&b.filename, &b.document_id)));
    dir.verify_current()?;
    Ok(entries)
}

pub fn read(
    root: &TrustedRoot,
    workspace: &str,
    selection: &DocumentSelection,
) -> Result<DocumentExcerpt> {
    let index = slot(&selection.document_id).ok_or(DesktopError("documentNotFound"))?;
    let start = selection.start_line;
    let end = selection.end_line;
    if start == 0 || end < start || end - start >= MAX_EXCERPT_LINES {
        return Err(DesktopError("invalidDocumentRange"));
    }
    let dir = ProjectDir::open(root, workspace, false)?.ok_or(DesktopError("documentNotFound"))?;
    let snapshot = open_snapshot(&dir, workspace, index)?
        .filter(|value| value.document.document_id == selection.document_id)
        .ok_or(DesktopError("documentNotFound"))?;
    dir.verify_current()?;
    if end > snapshot.document.line_count {
        return Err(DesktopError("invalidDocumentRange"));
    }
    let mut text = String::new();
    for (offset, line) in snapshot
        .text
        .lines()
        .skip(start - 1)
        .take(end - start + 1)
        .enumerate()
    {
        let newline = usize::from(offset != 0);
        if text.len() + newline + line.len() > MAX_EXCERPT_BYTES {
            return Err(DesktopError("invalidDocumentRange"));
        }
        if offset != 0 {
            text.push('\n');
        }
        text.push_str(line);
    }
    Ok(DocumentExcerpt {
        document: snapshot.document,
        start_line: start,
        end_line: end,
        text,
    })
}

/// 仅供原生宿主传入面板中已选择、在固定目录描述符内读取的单个文件。
pub fn import_selected(
    root: &TrustedRoot,
    workspace: &str,
    filename: &str,
    bytes: &[u8],
) -> Result<DocumentSummary> {
    check_name(filename)?;
    if bytes.len() > MAX_DOCUMENT_BYTES {
        return Err(DesktopError("documentTooLarge"));
    }
    let original = std::str::from_utf8(bytes).map_err(|_| DesktopError("invalidDocument"))?;
    let text = original
        .strip_prefix('\u{feff}')
        .unwrap_or(original)
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    let lines = line_count(&text)?;
    let dir = ProjectDir::open(root, workspace, true)?.ok_or(DesktopError("storeIo"))?;
    let catalog = Catalog::load(&dir, workspace)?;
    dir.clear_pending()?;
    let digest = fingerprint(filename, &text);
    if let Some((summary, _)) = catalog.entries.iter().find(|(_, hash)| hash == &digest) {
        dir.commit()?;
        return Ok(summary.clone());
    }
    let index = catalog
        .free_slot
        .ok_or(DesktopError("documentQuotaExceeded"))?;
    if catalog.total_bytes + text.len() > MAX_PROJECT_BYTES {
        return Err(DesktopError("documentQuotaExceeded"));
    }
    let document = DocumentSummary {
        document_id: format!("doc-{index:02x}{}", &random_reference()?[2..]),
        filename: filename.into(),
        line_count: lines,
        byte_length: text.len(),
    };
    let snapshot = Snapshot {
        workspace: workspace.into(),
        document,
        digest,
        text,
    };
    let payload = serde_json::to_vec(&snapshot).map_err(|_| DesktopError("storeIo"))?;
    dir.publish(&record_name(index), &payload)?;
    Ok(snapshot.document)
}
