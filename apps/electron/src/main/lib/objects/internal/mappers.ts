/**
 * Row ↔ Domain 对象映射
 *
 * SQLite 列名是 snake_case；@asci/shared 的 interface 是 camelCase + branded
 * ObjectId。所有从 / 向 SQL 行结构的转换集中在本文件，避免在每个 repo 里
 * 散落 `row.created_at as Timestamp` 这种重复代码。
 *
 * 命名约定：
 *   - `<kind>FromRow(row)` ：把 db 行还原为 domain 对象
 *   - 对应的 INSERT/UPDATE 参数由 repo 直接拼，不再单独包一层
 *     "toInsertParams" —— SQL 文本与参数顺序耦合，分散反而更乱
 *
 * 6 个对象 + 1 个关联表行类型在同一个文件里，方便 row interface 互相参照。
 */

import type {
  EvidenceRef,
  EvidenceRefSourceKind,
  EvidenceRefTargetKind,
  EvidenceSet,
  EvidenceSetSource,
  Note,
  ObjectId,
  ObjectVisibility,
  Paper,
  Proposal,
  ProposalDismissPolicy,
  ProposalKind,
  ProposalStatus,
  ProposalTargetRef,
  Review,
  Timestamp,
} from '@asci/shared'

import { decodeJson } from './common.ts'
import { deserializeAnchor } from '../anchor-codec.ts'

// ---------------- 行类型（SQLite -> JS） ----------------
// 共用字段：所有主表都有 id / created_at / updated_at / visibility / deleted_at

interface BaseRow {
  id: string
  created_at: string
  updated_at: string
  visibility: string
  deleted_at: string | null
}

export interface PaperRow extends BaseRow {
  title: string
  authors_json: string
  abstract: string | null
  year: number | null
  venue: string | null
  doi: string | null
  url: string | null
  zotero_key: string | null
}

export interface ReviewRow extends BaseRow {
  title: string
  intent: string
  source_capability: string
  source_evidence_set_id: string | null
  topic: string | null
  agent_session_id: string | null
  body_path: string | null
}

export interface EvidenceRefRow extends BaseRow {
  source_kind: string
  source_id: string
  /** Anchor JSON（见 anchor-codec.ts）；老数据可能是普通字符串，codec 会兜底 */
  source_anchor: string
  target_kind: string
  target_id: string
  /** Anchor JSON；target_kind='review' 时非空，'evidence-set' 时为 null（CHECK 约束） */
  target_anchor: string | null
}

export interface NoteRow extends BaseRow {
  body: string
}

export interface EvidenceSetRow extends BaseRow {
  /** B2 之后可空：agent-assembled set 不绑定 note */
  note_id: string | null
  persisted: number // 0 / 1
  name: string | null
  saved_at: string | null
  source: string | null
  /** workspace 归属（issue #457）；NOT NULL */
  workspace_id: string
}

export interface EvidenceSetRefRow {
  set_id: string
  ref_id: string
  position: number
}

export interface ProposalRow extends BaseRow {
  kind: string
  source_capability: string
  payload_json: string
  modified_payload_json: string | null
  reasoning: string
  status: string
  target_kind: string
  target_id: string
  dismiss_policy: string
  decided_at: string | null
}

// ---------------- 行 → Domain ----------------

function baseMeta(row: BaseRow): {
  id: ObjectId
  createdAt: Timestamp
  updatedAt: Timestamp
  visibility: ObjectVisibility
} {
  return {
    id: row.id as ObjectId,
    createdAt: row.created_at as Timestamp,
    updatedAt: row.updated_at as Timestamp,
    visibility: row.visibility as ObjectVisibility,
  }
}

export function paperFromRow(row: PaperRow): Paper {
  return {
    ...baseMeta(row),
    title: row.title,
    authors: decodeJson<string[]>(row.authors_json) ?? [],
    abstract: row.abstract ?? undefined,
    year: row.year ?? undefined,
    venue: row.venue ?? undefined,
    doi: row.doi ?? undefined,
    url: row.url ?? undefined,
    zoteroKey: row.zotero_key ?? undefined,
  }
}

export function reviewFromRow(row: ReviewRow): Review {
  return {
    ...baseMeta(row),
    title: row.title,
    intent: row.intent,
    sourceCapability: row.source_capability,
    sourceEvidenceSetId:
      row.source_evidence_set_id == null ? undefined : (row.source_evidence_set_id as ObjectId),
    topic: row.topic ?? undefined,
    agentSessionId: row.agent_session_id ?? undefined,
    bodyPath: row.body_path ?? undefined,
  }
}

export function evidenceRefFromRow(row: EvidenceRefRow): EvidenceRef {
  const sourceAnchor = deserializeAnchor(row.source_anchor)
  if (!sourceAnchor) {
    throw new Error(
      `[mappers] evidence_ref ${row.id} 的 source_anchor 列解析失败（应是 Anchor JSON）`,
    )
  }
  const targetKind = row.target_kind as EvidenceRefTargetKind
  const sourceKind = row.source_kind as EvidenceRefSourceKind

  if (targetKind === 'review') {
    const targetAnchor = deserializeAnchor(row.target_anchor)
    if (!targetAnchor) {
      throw new Error(
        `[mappers] evidence_ref ${row.id} target_kind='review' 但 target_anchor 列空（DB CHECK 应已阻止）`,
      )
    }
    return {
      ...baseMeta(row),
      source: {
        kind: sourceKind,
        id: row.source_id as ObjectId,
        anchor: sourceAnchor,
      },
      target: {
        kind: 'review',
        id: row.target_id as ObjectId,
        anchor: targetAnchor,
      },
    }
  }

  // target_kind === 'evidence-set'：DB CHECK 保证 target_anchor 必空
  return {
    ...baseMeta(row),
    source: {
      kind: sourceKind,
      id: row.source_id as ObjectId,
      anchor: sourceAnchor,
    },
    target: {
      kind: 'evidence-set',
      id: row.target_id as ObjectId,
    },
  }
}

export function noteFromRow(row: NoteRow): Note {
  return {
    ...baseMeta(row),
    body: row.body,
  }
}

export function evidenceSetFromRow(
  row: EvidenceSetRow,
  evidenceRefIds: ObjectId[],
): EvidenceSet {
  return {
    ...baseMeta(row),
    noteId: row.note_id == null ? undefined : (row.note_id as ObjectId),
    persisted: row.persisted === 1,
    evidenceRefIds,
    name: row.name ?? undefined,
    savedAt: row.saved_at ?? undefined,
    source: row.source == null ? undefined : (row.source as EvidenceSetSource),
    workspaceId: row.workspace_id,
  }
}

export function proposalFromRow(row: ProposalRow): Proposal {
  const targetObjectRef: ProposalTargetRef = {
    kind: row.target_kind as 'paper' | 'evidence-set' | 'note',
    id: row.target_id as ObjectId,
  }
  return {
    ...baseMeta(row),
    kind: row.kind as ProposalKind,
    sourceCapability: row.source_capability,
    payload: decodeJson(row.payload_json),
    modifiedPayload:
      row.modified_payload_json == null ? undefined : decodeJson(row.modified_payload_json),
    reasoning: row.reasoning,
    status: row.status as ProposalStatus,
    targetObjectRef,
    dismissPolicy: row.dismiss_policy as ProposalDismissPolicy,
    decidedAt: row.decided_at == null ? undefined : (row.decided_at as Timestamp),
  }
}
