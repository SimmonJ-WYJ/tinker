//! 归档只由本机已持有的项目快照构造；容器中没有文件路径或网络请求。
mod transaction;
use crate::{
    desktop_runtime::{
        protocol::{DesktopError, Result},
        DesktopRuntime, PortableSession,
    },
    formal_documents::{self, PortableDocument},
    formal_images::{ImageStore, PortableImages},
    formal_platform::{
        project_catalog::{PortableProject, ProjectCatalog},
        TrustedRoot,
    },
};
use serde::{
    de::{SeqAccess, Visitor},
    Deserialize, Deserializer, Serialize,
};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    fmt,
    io::{self, Write},
    marker::PhantomData,
};
pub(crate) use transaction::{install_directory, preflight, recover, restore, same};

pub(crate) const MAX_ARCHIVE_BYTES: usize = 64 * 1024 * 1024;
const MAGIC: &[u8; 8] = b"TINKERPB";
const VERSION: u32 = 1;
const HEADER: usize = 8 + 4 + 8 + 32;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SessionImages {
    session_id: String,
    images: PortableImages,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Payload {
    project: PortableProject,
    #[serde(deserialize_with = "bounded")]
    documents: Vec<PortableDocument>,
    #[serde(deserialize_with = "bounded")]
    sessions: Vec<PortableSession>,
    #[serde(deserialize_with = "bounded")]
    images: Vec<SessionImages>,
}
// 无长度前缀的 JSON 列表在反序列化时即执行上限，避免先分配然后才拒绝。
fn bounded<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> std::result::Result<Vec<T>, D::Error> {
    struct Items<T>(PhantomData<T>);
    impl<'de, T: Deserialize<'de>> Visitor<'de> for Items<T> {
        type Value = Vec<T>;
        fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.write_str("bounded project entries")
        }
        fn visit_seq<A: SeqAccess<'de>>(
            self,
            mut seq: A,
        ) -> std::result::Result<Self::Value, A::Error> {
            let mut items = Vec::new();
            while let Some(item) = seq.next_element()? {
                if items.len() >= 256 {
                    return Err(serde::de::Error::custom("project entry limit"));
                }
                items.push(item);
            }
            Ok(items)
        }
    }
    d.deserialize_seq(Items(PhantomData))
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Summary {
    project_name: String,
    session_count: usize,
    document_count: usize,
    image_count: usize,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RestoreReport {
    pub workspace_id: String,
    pub already_restored: bool,
}
struct Limited(Vec<u8>);
impl Write for Limited {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() > MAX_ARCHIVE_BYTES - self.0.len() {
            return Err(io::Error::other("archive size limit"));
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
fn encode(payload: &Payload) -> Result<Vec<u8>> {
    let mut out = Limited(vec![0; HEADER]);
    serde_json::to_writer(&mut out, payload).map_err(|_| DesktopError("storageLimit"))?;
    let bytes = &mut out.0;
    let length = (bytes.len() - HEADER) as u64;
    check_structure(&bytes[HEADER..])?;
    let digest = Sha256::digest(&bytes[HEADER..]);
    bytes[..8].copy_from_slice(MAGIC);
    bytes[8..12].copy_from_slice(&VERSION.to_be_bytes());
    bytes[12..20].copy_from_slice(&length.to_be_bytes());
    bytes[20..HEADER].copy_from_slice(&digest);
    Ok(out.0)
}
fn decode(bytes: &[u8]) -> Result<Payload> {
    if bytes.len() > MAX_ARCHIVE_BYTES {
        return Err(DesktopError("storageLimit"));
    }
    if bytes.len() < HEADER || &bytes[..8] != MAGIC {
        return Err(DesktopError("invalidProjectArchive"));
    }
    if bytes[8..12] != VERSION.to_be_bytes() {
        return Err(DesktopError("unsupportedVersion"));
    }
    let data = &bytes[HEADER..];
    if bytes[12..20] != (data.len() as u64).to_be_bytes() {
        return Err(DesktopError("invalidProjectArchive"));
    }
    if Sha256::digest(data)[..] != bytes[20..HEADER] {
        return Err(DesktopError("archiveChecksumMismatch"));
    }
    check_structure(data)?;
    let payload: Payload =
        serde_json::from_slice(data).map_err(|_| DesktopError("invalidProjectArchive"))?;
    payload.project.validate()?;
    let ids: BTreeSet<_> = payload
        .sessions
        .iter()
        .map(PortableSession::session_id)
        .collect();
    let mut owners = BTreeSet::new();
    if ids.len() != payload.sessions.len()
        || payload.images.iter().any(|group| {
            !ids.contains(group.session_id.as_str())
                || !owners.insert(&group.session_id)
                || group.images.is_empty()
        })
    {
        return Err(DesktopError("invalidProjectArchive"));
    }
    Ok(payload)
}
// 字节上限之外再限制结构节点，防止大量空对象、空字符串在展开时放大内存。
fn check_structure(bytes: &[u8]) -> Result<()> {
    let (mut quoted, mut escape, mut count) = (false, false, 0usize);
    for &b in bytes {
        if quoted {
            if escape {
                escape = false;
            } else if b == 92 {
                escape = true;
            } else if b == b'"' {
                quoted = false;
            }
        } else if matches!(b, b'"' | b'[' | b'{') {
            quoted = b == b'"';
            count += 1;
            if count > 512 * 1024 {
                return Err(DesktopError("storageLimit"));
            }
        }
    }
    Ok(())
}
fn summary(payload: &Payload) -> Summary {
    Summary {
        project_name: payload.project.name.clone(),
        session_count: payload.sessions.len(),
        document_count: payload.documents.len(),
        image_count: payload
            .images
            .iter()
            .map(|group| group.images.image_count())
            .sum(),
    }
}
pub(crate) fn export(
    root: &TrustedRoot,
    runtime: &DesktopRuntime,
    platform: &impl ProjectCatalog,
    images: &ImageStore,
    id: &str,
) -> Result<Vec<u8>> {
    root.validate()?;
    let project = platform
        .portable_project(id)?
        .ok_or(DesktopError("workspaceNotFound"))?;
    project.validate()?;
    let sessions = runtime.export_portable_sessions(id)?;
    if sessions.len() > 256 {
        return Err(DesktopError("storageLimit"));
    }
    let mut groups = Vec::new();
    let mut remaining = MAX_ARCHIVE_BYTES;
    for session in &sessions {
        session.validate_references(root, id)?;
        let bundle = images.export_portable(session.session_id(), &mut remaining)?;
        if !bundle.is_empty() {
            groups.push(SessionImages {
                session_id: session.session_id().into(),
                images: bundle,
            });
        }
    }
    let bytes = encode(&Payload {
        project,
        sessions,
        images: groups,
        documents: formal_documents::export_portable(root, id)?,
    })?;
    guard_text(platform, &bytes)?;
    Ok(bytes)
}
fn guard_text(platform: &impl ProjectCatalog, bytes: &[u8]) -> Result<()> {
    let text =
        std::str::from_utf8(&bytes[HEADER..]).map_err(|_| DesktopError("invalidProjectArchive"))?;
    platform.check_project_text(text)?;
    // 逐条解码转义过的字符串，防止遗漏已知凭据，同时避免将旧附件字节数组展开成 JSON 树。
    if text.contains('\\') {
        let mut rest = text;
        while let Some(start) = rest.find('"') {
            let mut tokens =
                serde_json::Deserializer::from_str(&rest[start..]).into_iter::<String>();
            let value = tokens
                .next()
                .and_then(|v| v.ok())
                .ok_or(DesktopError("invalidProjectArchive"))?;
            let end = start + tokens.byte_offset();
            if rest[start..end].contains('\\') {
                platform.check_project_text(&value)?;
            }
            rest = &rest[end..];
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
