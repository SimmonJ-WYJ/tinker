//! 私有日志头解码；存储版本与公开事件协议分离。
use super::*;
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct RunHeader {
    pub(super) protocol_version: u32,
    pub(super) run_id: String,
    pub(super) request_id: String,
    pub(super) provider_kind: ProviderKind,
    pub(super) scenario: OfflineScenario,
    pub(super) input: String,
    pub(super) created_order: u64,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RunHeaderV2 {
    pub(super) protocol_version: u32,
    pub(super) run_id: String,
    pub(super) request_id: String,
    pub(super) provider_kind: ProviderKind,
    pub(super) scenario: OfflineScenario,
    pub(super) input: String,
    pub(super) created_order: u64,
    pub(super) parent: ParentRunRef,
    pub(super) context_policy_version: u32,
}

pub(super) fn decode_header(
    line: &[u8],
    id: &str,
    layout: u8,
) -> Result<(RunHeader, RunLineage), RunError> {
    let value: serde_json::Value =
        serde_json::from_slice(line).map_err(|_| RunError::CorruptLog)?;
    let version = value
        .get("protocolVersion")
        .and_then(|v| v.as_u64())
        .ok_or(RunError::CorruptLog)?;
    if version != 1 && version != 2 {
        return Err(RunError::UnsupportedVersion);
    }
    if version != u64::from(layout) {
        return Err(RunError::CorruptLog);
    }
    let (header, lineage) = if version == 1 {
        (
            serde_json::from_slice::<RunHeader>(line).map_err(|_| RunError::CorruptLog)?,
            RunLineage::Standalone,
        )
    } else {
        let v: RunHeaderV2 = serde_json::from_slice(line).map_err(|_| RunError::CorruptLog)?;
        if v.context_policy_version != CONTEXT_POLICY_VERSION {
            return Err(RunError::UnsupportedVersion);
        }
        validate_parent(&v.parent, id)?;
        (
            RunHeader {
                protocol_version: 1,
                run_id: v.run_id,
                request_id: v.request_id,
                provider_kind: v.provider_kind,
                scenario: v.scenario,
                input: v.input,
                created_order: v.created_order,
            },
            RunLineage::Continuation {
                parent: v.parent,
                policy_version: v.context_policy_version,
            },
        )
    };
    if header.run_id != id
        || header.request_id != id
        || header.created_order == 0
        || header.input.len() > MAX_INPUT_BYTES
    {
        return Err(RunError::CorruptLog);
    }
    Ok((header, lineage))
}
pub(super) fn encode_header(header: &RunHeader, lineage: &RunLineage) -> Result<Vec<u8>, RunError> {
    match lineage {
        RunLineage::Standalone => serde_json::to_vec(header),
        RunLineage::Continuation {
            parent,
            policy_version,
        } => serde_json::to_vec(&RunHeaderV2 {
            protocol_version: 2,
            run_id: header.run_id.clone(),
            request_id: header.request_id.clone(),
            provider_kind: header.provider_kind,
            scenario: header.scenario,
            input: header.input.clone(),
            created_order: header.created_order,
            parent: parent.clone(),
            context_policy_version: *policy_version,
        }),
    }
    .map_err(|_| RunError::StoreIo)
}
