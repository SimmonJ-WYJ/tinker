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

fn fingerprint(name: &str, text: &str, pages: Option<&[usize]>) -> String {
    let mut hash = Sha256::new();
    hash.update(name);
    hash.update([0]);
    if let Some(counts) = pages {
        // 页界属于不可变的引用身份，即使两份文件的连续文本完全一样。
        hash.update((counts.len() as u64).to_be_bytes());
        for count in counts {
            hash.update((*count as u64).to_be_bytes());
        }
    }
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
        .filter(|n| *n < 2 * MAX_PROJECT_DOCUMENTS)
}

pub(super) fn record_name(index: usize) -> String {
    format!("document-{index:02x}.json")
}

fn valid_pages(doc: &DocumentSummary, index: usize) -> bool {
    match (&doc.page_line_counts, is_pdf(&doc.filename)) {
        (None, false) => index < MAX_PROJECT_DOCUMENTS,
        (Some(pages), true) => {
            index >= MAX_PROJECT_DOCUMENTS
                && !pages.is_empty()
                && pages.len() <= MAX_PDF_PAGES
                && pages.iter().all(|&n| n <= MAX_DOCUMENT_LINES)
                && pages.iter().sum::<usize>() == doc.line_count
        }
        _ => false,
    }
}

fn open_snapshot(dir: &ProjectDir, workspace: &str, index: usize) -> Result<Option<Snapshot>> {
    let Some(bytes) = dir.read(&record_name(index))? else {
        return Ok(None);
    };
    let s: Snapshot =
        serde_json::from_slice(&bytes).map_err(|_| DesktopError("corruptSnapshot"))?;
    validate_snapshot(&s, workspace, index)?;
    Ok(Some(s))
}

fn validate_snapshot(s: &Snapshot, workspace: &str, index: usize) -> Result<()> {
    if s.workspace != workspace
        || slot(&s.document.document_id) != Some(index)
        || s.text.len() != s.document.byte_length
        || s.text.len() > MAX_DOCUMENT_BYTES
        || check_name(&s.document.filename).is_err()
        || !valid_pages(&s.document, index)
        || (s.document.page_line_counts.is_none() && s.text.starts_with("%PDF-"))
        || line_count(&s.text).ok() != Some(s.document.line_count)
        || fingerprint(
            &s.document.filename,
            &s.text,
            s.document.page_line_counts.as_deref(),
        ) != s.digest
    {
        return Err(DesktopError("corruptSnapshot"));
    }
    Ok(())
}

struct Catalog {
    entries: Vec<(DocumentSummary, String)>,
    total_bytes: usize,
    free_slots: [Option<usize>; 2],
}

impl Catalog {
    fn load(dir: &ProjectDir, workspace: &str) -> Result<Self> {
        let mut catalog = Self {
            entries: vec![],
            total_bytes: 0,
            free_slots: [None; 2],
        };
        // 旧预览只扫描前 64 个槽位，因此含 PDF 的项目仍可用旧版查看原有文本文档。
        for index in 0..2 * MAX_PROJECT_DOCUMENTS {
            let Some(snapshot) = open_snapshot(dir, workspace, index)? else {
                catalog.free_slots[index / MAX_PROJECT_DOCUMENTS].get_or_insert(index);
                continue;
            };
            catalog.total_bytes += snapshot.document.byte_length;
            if catalog.entries.len() >= MAX_PROJECT_DOCUMENTS
                || catalog.total_bytes > MAX_PROJECT_BYTES
            {
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
    let (first, lines) = match (&snapshot.document.page_line_counts, selection.page) {
        (None, None) => (0, snapshot.document.line_count),
        (Some(counts), Some(page)) if (1..=counts.len()).contains(&page) => {
            (counts[..page - 1].iter().sum(), counts[page - 1])
        }
        _ => return Err(DesktopError("invalidDocumentRange")),
    };
    if end > lines {
        return Err(DesktopError("invalidDocumentRange"));
    }
    let mut text = String::new();
    for (offset, line) in snapshot
        .text
        .lines()
        .skip(first + start - 1)
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
        page: selection.page,
        start_line: start,
        end_line: end,
        text,
    })
}

fn normalize(text: &str) -> String {
    text.strip_prefix('\u{feff}')
        .unwrap_or(text)
        .replace("\r\n", "\n")
        .replace('\r', "\n")
}

fn selected_text(filename: &str, bytes: &[u8]) -> Result<(String, Option<Vec<usize>>)> {
    if bytes.len() > input_limit(filename) {
        return Err(DesktopError("documentTooLarge"));
    }
    if !is_pdf(filename) {
        let text =
            normalize(std::str::from_utf8(bytes).map_err(|_| DesktopError("invalidDocument"))?);
        if text.starts_with("%PDF-") {
            return Err(DesktopError("invalidDocument"));
        }
        return Ok((text, None));
    }

    let pages = pdf::extract_pages(bytes)?;
    if pages.len() > MAX_PDF_PAGES {
        return Err(DesktopError("documentTooLarge"));
    }
    let mut text = String::new();
    let mut counts = Vec::with_capacity(pages.len());
    for page in pages {
        let normalized = normalize(&page);
        let body = normalized.trim_end_matches('\n');
        if body.trim().is_empty() {
            counts.push(0);
            continue;
        }
        if text.len() + usize::from(!text.is_empty()) + body.len() > MAX_DOCUMENT_BYTES {
            return Err(DesktopError("documentTooLarge"));
        }
        if !text.is_empty() {
            text.push('\n');
        }
        counts.push(line_count(body)?);
        text.push_str(body);
    }
    if text.is_empty() {
        return Err(DesktopError("pdfNoText"));
    }
    Ok((text, Some(counts)))
}

/// 仅供原生宿主传入面板中已选择、在固定目录描述符内读取的单个文件。
pub(crate) fn prepare_selected(filename: &str, bytes: &[u8]) -> Result<PreparedDocument> {
    check_name(filename)?;
    let (text, pages) = selected_text(filename, bytes)?;
    let lines = line_count(&text)?;
    Ok(PreparedDocument {
        filename: filename.to_owned(),
        text,
        pages,
        lines,
    })
}

pub(crate) fn publish_selected(
    root: &TrustedRoot,
    workspace: &str,
    pending: PreparedDocument,
    check_text: impl Fn(&str) -> Result<()>,
) -> Result<DocumentSummary> {
    let PreparedDocument {
        filename,
        text,
        pages,
        lines,
    } = pending;
    check_text(&filename)?;
    check_text(&text)?;
    let dir = ProjectDir::open(root, workspace, true)?.ok_or(DesktopError("storeIo"))?;
    let catalog = Catalog::load(&dir, workspace)?;
    dir.clear_pending()?;
    let digest = fingerprint(&filename, &text, pages.as_deref());
    if let Some((summary, _)) = catalog.entries.iter().find(|(_, hash)| hash == &digest) {
        dir.commit()?;
        return Ok(summary.clone());
    }
    let index = catalog.free_slots[usize::from(pages.is_some())]
        .ok_or(DesktopError("documentQuotaExceeded"))?;
    if catalog.entries.len() >= MAX_PROJECT_DOCUMENTS
        || catalog.total_bytes + text.len() > MAX_PROJECT_BYTES
    {
        return Err(DesktopError("documentQuotaExceeded"));
    }
    let document = DocumentSummary {
        document_id: format!("doc-{index:02x}{}", &random_reference()?[2..]),
        filename,
        page_line_counts: pages,
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

pub(crate) fn export_portable(
    root: &TrustedRoot,
    workspace: &str,
) -> Result<Vec<PortableDocument>> {
    let Some(dir) = ProjectDir::open(root, workspace, false)? else {
        return Ok(vec![]);
    };
    let mut items = vec![];
    let mut total = 0;
    for index in 0..2 * MAX_PROJECT_DOCUMENTS {
        if let Some(s) = open_snapshot(&dir, workspace, index)? {
            total += s.text.len();
            if items.len() >= MAX_PROJECT_DOCUMENTS || total > MAX_PROJECT_BYTES {
                return Err(DesktopError("documentQuotaExceeded"));
            }
            items.push(PortableDocument {
                document: s.document,
                digest: s.digest,
                text: s.text,
            });
        }
    }
    dir.verify_current()?;
    Ok(items)
}

// 仅写入独立预检根；保留槽位与随机 ID，使历史引用无需映射。
pub(crate) fn stage_portable(
    root: &TrustedRoot,
    workspace: &str,
    items: &[PortableDocument],
) -> Result<()> {
    if items.len() > MAX_PROJECT_DOCUMENTS {
        return Err(DesktopError("documentQuotaExceeded"));
    }
    if items.is_empty() {
        return Ok(());
    }
    let dir = ProjectDir::open(root, workspace, true)?.ok_or(DesktopError("storeIo"))?;
    let mut total = 0;
    let mut slots = std::collections::HashSet::new();
    let mut digests = std::collections::HashSet::new();
    for item in items {
        let index = slot(&item.document.document_id).ok_or(DesktopError("corruptSnapshot"))?;
        if !slots.insert(index) || !digests.insert(&item.digest) {
            return Err(DesktopError("corruptSnapshot"));
        }
        total += item.text.len();
        if total > MAX_PROJECT_BYTES {
            return Err(DesktopError("documentQuotaExceeded"));
        }
        let snapshot = Snapshot {
            workspace: workspace.into(),
            document: item.document.clone(),
            digest: item.digest.clone(),
            text: item.text.clone(),
        };
        validate_snapshot(&snapshot, workspace, index)?;
        let bytes = serde_json::to_vec(&snapshot).map_err(|_| DesktopError("storeIo"))?;
        dir.publish(&record_name(index), &bytes)?;
    }
    Ok(())
}
