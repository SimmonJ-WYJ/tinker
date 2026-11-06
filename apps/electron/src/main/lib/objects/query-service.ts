/**
 * 参数化查询入口 —— A-3 + A-2 P2 协议
 *
 * 0.2 协议铁律 [P3] 要求"通过关系索引查询，不遍历全量"，对应审计项 V6e
 * （100+ Note 时按 Paper 反查的响应时间与 Note 总量无关）。本模块提供
 * 反查函数族，**每条 SQL 必须命中 idx_***。索引契约由配套测试断言
 * （EXPLAIN QUERY PLAN）守门。
 *
 * 0.2 协议铁律 [P2] 要求"删除源对象时引用处标记'源已移除'而非置空"。
 * 当反查会经过一个可能软删的"源 Paper"时（典型：Review 视角下的
 * EvidenceRef 源 Paper），返回结构里那一端用
 * `ResolvedRef<Paper>` 包装：
 *   - 源 Paper 仍 visible/archived → `{ state: 'present', ref: <Paper> }`
 *   - 源 Paper 已 deleted（deleted_at 非空） → `{ state: 'removed', id, removedAt }`
 *
 * 说明 ResolvedRef 仅出现在"对端可能被软删"的查询返回里；同侧（被查询的
 * paperId 那一端）默认存在，不包装。
 *
 * --- v0.2 重构后的 Note ↔ Paper 反查路径 ---
 *
 * Note 不再直接挂 paper，关系经 evidence_refs / evidence_sets 三跳解析：
 *   paper.id → evidence_refs(source_kind='paper', source_id=paperId, target_kind='evidence-set')
 *            → evidence_sets(id=ref.target_id)
 *            → notes(id=set.note_id)
 *
 * 索引契约：靠 idx_evidence_refs_source(source_kind, source_id) 走索引扫源端；
 * 后续 JOIN 走主键 / 唯一索引（evidence_sets.note_id UNIQUE，evidence_set_refs PK）。
 */

import type {
  ConversationEvidenceMember,
  EvidenceRef,
  EvidenceRefWithSource,
  EvidenceSetDetail,
  EvidenceSetSummary,
  Note,
  NoteWithQuote,
  ObjectId,
  Paper,
  ResolvedRef,
  Review,
  Timestamp,
} from '@asci/shared'

import { listAgentSessions } from '../agent-session-manager.ts'

import { deserializeAnchor } from './anchor-codec.ts'

import {
  evidenceRefFromRow,
  evidenceSetFromRow,
  noteFromRow,
  paperFromRow,
  reviewFromRow,
  type EvidenceRefRow,
  type EvidenceSetRow,
  type NoteRow,
  type PaperRow,
  type ReviewRow,
} from './internal/mappers.ts'
import type { RepoDb } from './internal/repo-db.ts'
import { findPaperByZoteroKey } from './repositories/paper-repository.ts'
import {
  getReviewByAgentSessionId,
  getReviewBySourceEvidenceSetId,
} from './repositories/review-repository.ts'

// ---------------- helpers ----------------

/**
 * 把"可能已软删"的 paper 行包装成 ResolvedRef。
 * 行不存在 → 视为 removed（id 由调用方传入）；行存在且 deleted_at 非空 → removed；否则 present。
 *
 * 注意：deleted_at IS NOT NULL 与 visibility='deleted' 在本仓的写入路径下严格同时成立
 * （softDeleteRow 同时设置）；以 deleted_at 为判据是因为它是更明确的"时间戳"信号。
 */
function wrapPaper(row: PaperRow | undefined, id: ObjectId): ResolvedRef<Paper> {
  if (!row) return { state: 'removed', id, removedAt: 'unknown' as Timestamp }
  if (row.deleted_at) {
    // 软删行 title 仍在，回填给占位卡展示原标题 / hover tooltip（V3）
    return {
      state: 'removed',
      id,
      removedAt: row.deleted_at as Timestamp,
      removedTitle: row.title,
    }
  }
  return { state: 'present', ref: paperFromRow(row) }
}

// ---------------- Notes ----------------

/**
 * 按 Paper 反查 Note。v0.2 重构后的三跳路径：
 *   paper → evidence_refs(source=paper, target=set) → evidence_sets → notes
 *
 * 索引契约：必须命中 idx_evidence_refs_source(source_kind, source_id)。
 *
 * 同一 paper 可在多个 set 中以多条 ref 出现，对应不同 note → DISTINCT 去重；
 * 默认排除 visibility='deleted' 的 note / set / ref。
 */
export function queryNotesByPaper(
  db: RepoDb,
  paperId: ObjectId,
  workspaceId: string,
): NoteWithQuote[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT
            n.id, n.body,
            n.visibility, n.created_at, n.updated_at, n.deleted_at,
            r.source_anchor AS r_source_anchor
         FROM notes n
         JOIN evidence_sets s        ON s.note_id = n.id
         JOIN evidence_set_refs sr   ON sr.set_id = s.id
         JOIN evidence_refs r        ON r.id = sr.ref_id
        WHERE r.source_kind = 'paper'
          AND r.source_id   = ?
          AND r.target_kind = 'evidence-set'
          AND r.target_id   = s.id
          AND s.workspace_id = ?
          AND n.visibility != 'deleted'
          AND s.visibility != 'deleted'
          AND r.visibility != 'deleted'
        ORDER BY n.created_at DESC`,
    )
    .all(paperId, workspaceId) as Array<NoteRow & { r_source_anchor: string }>
  return rows.map((row) => {
    // 单次 deserialize 同时取 snapshotText 与 PDF 页码（issue #452），避免每行 JSON.parse 两次。
    const { snapshotText, page } = extractAnchorFields(row.r_source_anchor)
    return {
      note: noteFromRow(row),
      quote: sanitizeQuote(snapshotText, row.body),
      page,
    }
  })
}

/** 从 source_anchor JSON 列里抽出 snapshotText 用于 UI 展示；解析失败时返回空字符串 */
function extractSnapshotText(anchorJson: string | null): string {
  if (!anchorJson) return ''
  const a = deserializeAnchor(anchorJson)
  return a?.snapshotText ?? ''
}

/**
 * 一次性抽出 UI 要的两个字段：snapshotText（展示 / 高亮 key）+ PDF 页码（issue #452，划词建注时
 * 捕获的选区所在页，供 PdfRenderer 文本匹配 miss 时回退翻页）。queryNotesByPaper 同时要两者，
 * 合并到一次 deserialize 省掉重复 JSON.parse。page 仅 type='pdf' 且 locationData.kind='pdf' 时有值。
 */
function extractAnchorFields(anchorJson: string | null): {
  snapshotText: string
  page: number | undefined
} {
  if (!anchorJson) return { snapshotText: '', page: undefined }
  const a = deserializeAnchor(anchorJson)
  const page = a?.type === 'pdf' && a.locationData?.kind === 'pdf' ? a.locationData.page : undefined
  return { snapshotText: a?.snapshotText ?? '', page }
}

/**
 * 伪引文判定（issue #446）：旧版本无划词建注时用正文前 200 字兜底生成
 * anchor.snapshotText；正文以 quote 开头 → 视为伪造，按"无引文"返回，
 * 避免详情页把正文重复展示成引用块、PDF 跳转拿伪 quote 定位必败。
 * 真实划词引文来自论文原文，与用户正文前缀重合的概率可忽略；即便重合，
 * 隐藏重复引用块也符合预期。纯读侧归一，不动存量数据。导出供单测。
 *
 * 仅对 **paper 锚点**做此判定（兜底伪造只发生在 paper md anchor 写入路径）；
 * conversation 的 Q/A 快照与 note 正文同源是合法形态，调用方按 kind 门控。
 */
export function sanitizeQuote(snapshot: string, noteBody: string): string {
  const q = snapshot.trim()
  if (q.length === 0) return ''
  return noteBody.trim().startsWith(q) ? '' : snapshot
}

/** 按 source kind 门控的 sanitizeQuote：非 paper 锚点原样返回（见 sanitizeQuote 注释） */
function sanitizeQuoteForKind(
  kind: string | null,
  snapshot: string,
  noteBody: string,
): string {
  return kind === 'paper' ? sanitizeQuote(snapshot, noteBody) : snapshot
}

/**
 * 按 EvidenceSet 反查 Note —— 由于 1:1 强绑定，结果至多 1 条。
 * 保持数组返回签名以减少调用方改动；空数组 = note 已软删 / 不存在。
 */
export function queryNotesByEvidenceSet(db: RepoDb, setId: ObjectId): Note[] {
  const rows = db
    .prepare(
      `SELECT n.*
         FROM notes n
         JOIN evidence_sets s ON s.note_id = n.id
        WHERE s.id = ?
          AND n.visibility != 'deleted'`,
    )
    .all(setId) as NoteRow[]
  return rows.map(noteFromRow)
}

/**
 * 列出全局 Note（V6a 用：「证据集」视图聚合显示）。
 *
 * v0.2 重构后的反查：每个 note 关联唯一 evidence_set；set 内可能有 0~N 个
 * evidence_refs 指向不同 paper / review —— 列表项只取**首条 ref**（按
 * evidence_set_refs.position 升序）作为"主要来源"展示。
 *
 * 2026-05-24 source 端多态化（'paper' | 'review'）后，首条 ref 可能是 review，
 * 此时回退展示 review 标题；paper / review 都为 null 时（set 暂无 ref / 源已软删）
 * 显示 "(unlinked note)" 占位。
 *
 * 排序：n.created_at DESC（最新优先）。
 *
 * 索引契约：JOIN evidence_sets.note_id 命中 UNIQUE 索引；首条 ref 用相关子查询
 * 走 (set_id, position) PK 前缀。
 */
export interface NoteWithPaper {
  note: Note
  /** 首条 ref 指向的 paper（若 source_kind='paper'）；否则 null */
  paper: {
    id: ObjectId
    title: string
    zoteroKey: string | null
  } | null
  /** 首条 ref 指向的 review（若 source_kind='review'）；否则 null */
  review: {
    id: ObjectId
    title: string
    bodyPath: string | null
  } | null
  /** 首条 ref 是 conversation 来源时的会话信息（会话名 + 问题）；否则 null */
  conversation: {
    sessionId: string
    sessionTitle: string | null
    question: string
  } | null
  /** 1:1 绑定的 evidence_set.id；UI 选中后直接拿来调 evidenceSets:getDetail */
  evidenceSetId: ObjectId | null
  /** 首条 ref 的 anchor.snapshotText —— UI 列表展示的"引文片段"（B3 起；可空串） */
  quote: string
  /** 集合 name（命名集合时非空）—— NotesView 列表 content 空时作 fallback 主标 */
  setName: string | null
  /** 集合内 paper 数（去重 source_id）—— NotesView 列表"N 篇论文" badge 用 */
  setPaperCount: number
}

/**
 * 从 conversation anchor 的 snapshotText（约定 `Q: <问>\n\nA: <答>`）剥出问题原文。
 * 找不到 A: 分隔时退回整段去掉 `Q:` 前缀。
 */
function extractConversationQuestion(snapshotText: string): string {
  let s = snapshotText.trim()
  const aIdx = s.search(/\n\s*A[:：]/)
  if (aIdx >= 0) s = s.slice(0, aIdx)
  return s.replace(/^Q[:：]\s*/, '').trim()
}

/**
 * 列出所有 note + 首条 ref 关联的 paper/review/conversation —— NotesView 列表数据源。
 *
 * **综述 autohook 临时 set 不出现**（v0.2.x 起）：parseAndAttachReviewCitations 给
 * 每篇 review 建一条 `persisted=0 AND source IS NULL` 的临时 set 服务
 * "BookmarkPlus → PROMOTE_FROM_REVIEW" 内部承载，用户主动保存（升格 persisted=1）
 * 之前不该在 NotesView 左栏冒出来。
 *
 * 过滤谓词（issue #457 后）：`s.id IS NOT NULL AND (s.persisted = 1 OR s.source IS NOT NULL)`
 *   - `s.id IS NOT NULL`：set JOIN 已按 `s.workspace_id = ?` scope，跨 workspace 的 note
 *     join 不到 set（s.id=NULL）→ 整条排除，杜绝跨 workspace 串数据；
 *     note 1:1 绑 set，当前 workspace 内的 note 必有 set，故不会误伤。
 *   - `s.persisted = 1 OR s.source IS NOT NULL`：仍排除 "persisted=0 且 source 为 NULL" 的
 *     综述 autohook 临时产物，**保留**用户主动保存的命名集（persisted=1）与划词建注的
 *     `source='user-highlight'` 临时集。
 */
export function queryAllNotesWithPaper(db: RepoDb, workspaceId: string): NoteWithPaper[] {
  const rows = db
    .prepare(
      `SELECT
         n.id            AS n_id,
         n.body          AS n_body,
         n.visibility    AS n_visibility,
         n.created_at    AS n_created_at,
         n.updated_at    AS n_updated_at,
         n.deleted_at    AS n_deleted_at,
         s.id            AS s_id,
         s.name          AS s_name,
         (
           SELECT COUNT(DISTINCT er.source_id)
             FROM evidence_set_refs esr
             JOIN evidence_refs er ON er.id = esr.ref_id
            WHERE esr.set_id = s.id
              AND er.source_kind = 'paper'
              AND er.visibility != 'deleted'
         )               AS s_paper_count,
         p.id            AS p_id,
         p.title         AS p_title,
         p.zotero_key    AS p_zotero_key,
         rv.id           AS rv_id,
         rv.title        AS rv_title,
         rv.body_path    AS rv_body_path,
         r.source_kind   AS r_source_kind,
         r.source_id     AS r_source_id,
         r.source_anchor AS r_source_anchor
       FROM notes n
       -- issue #457：按 workspace_id scope —— set 不在当前 workspace 则 join 不到，
       -- WHERE 的 s.id IS NOT NULL 会把它整条排除（note 1:1 绑 set，跨 workspace 不应冒出）。
       LEFT JOIN evidence_sets s ON s.note_id = n.id AND s.visibility != 'deleted' AND s.workspace_id = ?
       LEFT JOIN evidence_set_refs sr
              ON sr.set_id = s.id
             AND sr.position = (
               SELECT MIN(position) FROM evidence_set_refs WHERE set_id = s.id
             )
       LEFT JOIN evidence_refs r
              ON r.id = sr.ref_id
             AND r.visibility != 'deleted'
       LEFT JOIN papers p
              ON p.id = r.source_id
             AND r.source_kind = 'paper'
             AND p.visibility != 'deleted'
       LEFT JOIN reviews rv
              ON rv.id = r.source_id
             AND r.source_kind = 'review'
             AND rv.visibility != 'deleted'
       WHERE n.visibility != 'deleted'
         AND s.id IS NOT NULL
         AND (s.persisted = 1 OR s.source IS NOT NULL)
       ORDER BY n.created_at DESC`,
    )
    .all(workspaceId) as Array<{
      n_id: string
      n_body: string
      n_visibility: string
      n_created_at: string
      n_updated_at: string
      n_deleted_at: string | null
      s_id: string | null
      s_name: string | null
      s_paper_count: number | null
      p_id: string | null
      p_title: string | null
      p_zotero_key: string | null
      rv_id: string | null
      rv_title: string | null
      rv_body_path: string | null
      r_source_kind: string | null
      r_source_id: string | null
      r_source_anchor: string | null
    }>

  // 仅当存在 conversation 来源行时才加载一次 session 标题索引（避免每次 listAll 都读盘）
  const hasConversation = rows.some((r) => r.r_source_kind === 'conversation')
  const sessionTitleById = new Map<string, string>()
  if (hasConversation) {
    try {
      for (const meta of listAgentSessions()) {
        if (meta.title) sessionTitleById.set(meta.id, meta.title)
      }
    } catch (err) {
      console.warn('[query-service] listAgentSessions failed for notes listAll:', err)
    }
  }

  return rows.map((r) => ({
    note: noteFromRow({
      id: r.n_id,
      body: r.n_body,
      visibility: r.n_visibility,
      created_at: r.n_created_at,
      updated_at: r.n_updated_at,
      deleted_at: r.n_deleted_at,
    } as NoteRow),
    paper:
      r.p_id == null
        ? null
        : {
            id: r.p_id as ObjectId,
            title: r.p_title ?? '',
            zoteroKey: r.p_zotero_key,
          },
    review:
      r.rv_id == null
        ? null
        : {
            id: r.rv_id as ObjectId,
            title: r.rv_title ?? '',
            bodyPath: r.rv_body_path,
          },
    conversation:
      r.r_source_kind === 'conversation' && r.r_source_id != null
        ? {
            sessionId: r.r_source_id,
            sessionTitle: sessionTitleById.get(r.r_source_id) ?? null,
            question: extractConversationQuestion(extractSnapshotText(r.r_source_anchor)),
          }
        : null,
    evidenceSetId: r.s_id == null ? null : (r.s_id as ObjectId),
    quote: sanitizeQuoteForKind(r.r_source_kind, extractSnapshotText(r.r_source_anchor), r.n_body),
    setName: r.s_name,
    setPaperCount: r.s_paper_count ?? 0,
  }))
}

// ---------------- Latest Review Set for Agent Session（B5） ----------------

/**
 * 当前 agent session 最近一份 review 的 EvidenceSet 状态。
 *
 * 用于 Agent 消息上的 BookmarkPlus 按钮：决定 popover 显示状态
 *   - reviewId = null：会话还没产出 review → 显示"暂无可保存的证据集"
 *   - setId = null：review 存在但没挂 set（cite 为空 / 抽取失败） → 同样不显示保存
 *   - setPersisted = false：可保存（显示输入框 + 保存按钮）
 *   - setPersisted = true：已保存（显示"已保存 · <name>"+ 详情链接）
 */
export interface LatestReviewSetForSession {
  reviewId: ObjectId | null
  reviewTitle: string | null
  setId: ObjectId | null
  setPersisted: boolean
  setName: string | null
}

export function queryLatestReviewSetByAgentSession(
  db: RepoDb,
  agentSessionId: string,
): LatestReviewSetForSession {
  const row = db
    .prepare(
      `SELECT
         r.id            AS review_id,
         r.title         AS review_title,
         s.id            AS set_id,
         s.persisted     AS set_persisted,
         s.name          AS set_name
       FROM reviews r
       LEFT JOIN evidence_sets s
              ON s.id = r.source_evidence_set_id
             AND s.visibility != 'deleted'
       WHERE r.agent_session_id = ?
         AND r.visibility != 'deleted'
       ORDER BY r.created_at DESC
       LIMIT 1`,
    )
    .get(agentSessionId) as
    | {
        review_id: string
        review_title: string
        set_id: string | null
        set_persisted: number | null
        set_name: string | null
      }
    | undefined

  if (!row) {
    return {
      reviewId: null,
      reviewTitle: null,
      setId: null,
      setPersisted: false,
      setName: null,
    }
  }

  return {
    reviewId: row.review_id as ObjectId,
    reviewTitle: row.review_title,
    setId: row.set_id == null ? null : (row.set_id as ObjectId),
    setPersisted: row.set_persisted === 1,
    setName: row.set_name,
  }
}

// ---------------- EvidenceRefs ----------------

/**
 * 按 Paper 反查"由该 Paper 作为源被引用"的 EvidenceRef 列表。
 * 索引契约：必须命中 idx_evidence_refs_source(source_kind, source_id)。
 *
 * 源即查询参数 paperId（必在上下文存在），故无需 ResolvedRef 包装。
 */
export function queryEvidenceRefsByPaper(db: RepoDb, paperId: ObjectId): EvidenceRef[] {
  const rows = db
    .prepare(
      `SELECT * FROM evidence_refs
        WHERE source_kind = 'paper'
          AND source_id   = ?
          AND visibility != 'deleted'
        ORDER BY created_at DESC`,
    )
    .all(paperId) as EvidenceRefRow[]
  return rows.map(evidenceRefFromRow)
}

/**
 * 按 Review 反查挂在该 Review 上的 EvidenceRef 列表，连带源 Paper 的解析状态。
 * 索引契约：必须命中 idx_evidence_refs_target(target_kind, target_id)。
 *
 * 每条结果里 `sourcePaper` 用 ResolvedRef 包装：源 Paper 软删 → state='removed'，
 * 用于 V3 审计场景（综述视角下的源已移除标记）。
 */
export function queryEvidenceRefsByReview(
  db: RepoDb,
  reviewId: ObjectId,
): Array<{ evidenceRef: EvidenceRef; sourcePaper: ResolvedRef<Paper> }> {
  const rows = db
    .prepare(
      `SELECT * FROM evidence_refs
        WHERE target_kind = 'review'
          AND target_id   = ?
          AND visibility != 'deleted'
        ORDER BY created_at DESC`,
    )
    .all(reviewId) as EvidenceRefRow[]
  if (rows.length === 0) return []

  // 当前 source_kind 仅 'paper'，可直接按 source_id 取 papers；未来扩展时按 kind 分支
  const paperIds = Array.from(new Set(rows.map((r) => r.source_id)))
  const placeholders = paperIds.map(() => '?').join(',')
  const paperRows = db
    .prepare(`SELECT * FROM papers WHERE id IN (${placeholders})`)
    .all(...paperIds) as PaperRow[]
  const paperById = new Map(paperRows.map((p) => [p.id, p]))

  return rows.map((row) => ({
    evidenceRef: evidenceRefFromRow(row),
    sourcePaper: wrapPaper(paperById.get(row.source_id), row.source_id as ObjectId),
  }))
}

// ---------------- EvidenceSet 聚合 ----------------

export interface QueryEvidenceSetDetailOpts {
  /** 是否包含 visibility='deleted' 的 ref / paper；默认 false */
  includeDeleted?: boolean
}

/**
 * 一次性拿单个证据集的完整详情：set 主表 + 1:1 绑定的 note + 集合内所有 ref +
 * 派生成员 paper 列表。
 *
 * 实现策略：多个单表 PK 查询拼装（不用复杂 5 表 JOIN），better-sqlite3 是同步 API，
 * round-trip 成本忽略，pragmatic 选择。
 *
 * 索引契约（全部 PK / 唯一索引命中，配套测试用 EXPLAIN QUERY PLAN 守门）：
 *   - `evidence_sets WHERE id=?` → PK
 *   - `notes WHERE id=?` → PK
 *   - `evidence_set_refs WHERE set_id=?` ORDER BY position → PK (set_id, position)
 *   - `evidence_refs WHERE id=?`（JOIN） → PK
 *   - `papers WHERE id IN (...)` → PK
 *
 * 返回 null 的唯一情况：set 行不存在（或被硬删）。set 软删（visibility='deleted'）
 * 仍返回，由调用方决定过滤；详情见 docs/superpowers/specs/2026-05-24-...
 */
export function queryEvidenceSetDetail(
  db: RepoDb,
  setId: ObjectId,
  opts: QueryEvidenceSetDetailOpts = {},
): EvidenceSetDetail | null {
  const includeDeleted = opts.includeDeleted ?? false

  // ① set 主表
  const setRow = db.prepare(`SELECT * FROM evidence_sets WHERE id = ?`).get(setId) as
    | EvidenceSetRow
    | undefined
  if (!setRow) return null

  // ② notes（容器内多笔记，走 evidence_set_notes join；003 后不再读 setRow.note_id legacy 列）
  const noteVisClause = includeDeleted ? '' : `AND n.visibility != 'deleted'`
  const noteRows = db
    .prepare(
      `SELECT n.* FROM evidence_set_notes esn
         JOIN notes n ON n.id = esn.note_id
        WHERE esn.set_id = ? ${noteVisClause}
        ORDER BY esn.position`,
    )
    .all(setId) as NoteRow[]
  let notes = noteRows.map(noteFromRow)
  // 过渡兼容：join 为空但 legacy note_id 仍在（迁移前数据 / 尚未双写 join 的写路径）→ 回退读 note_id。
  // 待所有写路径都写 evidence_set_notes 后可移除（#709 收尾）。
  if (notes.length === 0 && setRow.note_id) {
    const legacyNote = db.prepare(`SELECT * FROM notes WHERE id = ?`).get(setRow.note_id) as
      | NoteRow
      | undefined
    if (legacyNote && (includeDeleted || legacyNote.visibility !== 'deleted')) {
      notes = [noteFromRow(legacyNote)]
    }
  }
  // 兼容字段：note = 首条笔记（@deprecated，待 renderer 迁移到 notes[] 后移除）
  const note = notes[0] ?? null
  // ②' 容器标签
  const tags = (
    db
      .prepare(`SELECT tag FROM evidence_set_tags WHERE set_id = ? ORDER BY tag`)
      .all(setId) as Array<{ tag: string }>
  ).map((r) => r.tag)

  // ③ refs JOIN evidence_set_refs，按 position 升序
  const visClause = includeDeleted ? '' : `AND er.visibility != 'deleted'`
  const refRows = db
    .prepare(
      `SELECT er.*, esr.position AS _position
         FROM evidence_set_refs esr
         JOIN evidence_refs er ON er.id = esr.ref_id
        WHERE esr.set_id = ? ${visClause}
        ORDER BY esr.position`,
    )
    .all(setId) as Array<EvidenceRefRow & { _position: number }>

  // ④ batch papers（source.kind='paper' 的 ref）
  const sourcePaperIds = Array.from(
    new Set(refRows.filter((r) => r.source_kind === 'paper').map((r) => r.source_id)),
  )
  let paperById = new Map<string, PaperRow>()
  if (sourcePaperIds.length > 0) {
    const placeholders = sourcePaperIds.map(() => '?').join(',')
    const paperRows = db
      .prepare(`SELECT * FROM papers WHERE id IN (${placeholders})`)
      .all(...sourcePaperIds) as PaperRow[]
    paperById = new Map(paperRows.map((p) => [p.id, p]))
  }

  // ④' batch reviews（source.kind='review' 的 ref，2026-05-24 source 端多态化扩展后用）
  // 默认 includeDeleted=false → 仅取 visibility != 'deleted' 的 review；与 paper 端
  // wrapPaper 行为略不同（paper 软删保留 ResolvedRef.removed 给 UI"曾经存在"语义；
  // review 这边没有 wrap，软删直接不出现在 memberReviews —— 截图场景下"EVIDENCE ITEMS"
  // 区只需要展示存活的 source，足够）。未来如需要"review 已移除"占位再扩。
  const sourceReviewIds = Array.from(
    new Set(refRows.filter((r) => r.source_kind === 'review').map((r) => r.source_id)),
  )
  let reviewById = new Map<string, ReviewRow>()
  if (sourceReviewIds.length > 0) {
    const placeholders = sourceReviewIds.map(() => '?').join(',')
    const reviewVisClause = includeDeleted ? '' : `AND visibility != 'deleted'`
    const reviewRows = db
      .prepare(
        `SELECT * FROM reviews WHERE id IN (${placeholders}) ${reviewVisClause}`,
      )
      .all(...sourceReviewIds) as ReviewRow[]
    reviewById = new Map(reviewRows.map((r) => [r.id, r]))
  }

  // 组装 refs + sourcePaper 解析状态
  // 源 paper 软删时 wrapPaper 返回 state='removed'（保留"曾经存在"语义，不依赖
  // includeDeleted —— includeDeleted 仅控制 ref 自身的过滤）。
  // quote = anchor.snapshotText 经伪引文归一化的派生值（issue #446），消费侧统一读它。
  const noteBody = note?.body ?? ''
  const refs: EvidenceRefWithSource[] = refRows.map((row) => {
    const ref = evidenceRefFromRow(row)
    return {
      ref,
      sourcePaper: wrapPaper(paperById.get(row.source_id), row.source_id as ObjectId),
      quote: sanitizeQuoteForKind(row.source_kind, ref.source.anchor?.snapshotText ?? '', noteBody),
    }
  })

  // 派生 memberPapers：仅 present 的 paper，按 refs[] 首次出现序去重
  const seen = new Set<string>()
  const memberPapers: Paper[] = []
  for (const { sourcePaper } of refs) {
    if (sourcePaper.state !== 'present') continue
    if (seen.has(sourcePaper.ref.id)) continue
    seen.add(sourcePaper.ref.id)
    memberPapers.push(sourcePaper.ref)
  }

  // 派生 memberReviews：按 refs[] 首次出现序去重，仅 source_kind='review' 且 review 行存在
  const seenReviews = new Set<string>()
  const memberReviews: Review[] = []
  for (const row of refRows) {
    if (row.source_kind !== 'review') continue
    if (seenReviews.has(row.source_id)) continue
    const rRow = reviewById.get(row.source_id)
    if (!rRow) continue
    seenReviews.add(row.source_id)
    memberReviews.push(reviewFromRow(rRow))
  }

  // 派生 memberConversations：source_kind='conversation' 的 ref（按 position 升序，不去重）
  // session 标题从 agent-sessions.json 索引解析；session 已删则 sessionTitle=null（UI 据此禁用跳转）
  const hasConversationRef = refRows.some((row) => row.source_kind === 'conversation')
  let sessionTitleById = new Map<string, string>()
  if (hasConversationRef) {
    try {
      for (const meta of listAgentSessions()) {
        if (meta.title) sessionTitleById.set(meta.id, meta.title)
      }
    } catch (err) {
      console.warn('[query-service] listAgentSessions failed for conversation refs:', err)
    }
  }
  const memberConversations: ConversationEvidenceMember[] = []
  for (const row of refRows) {
    if (row.source_kind !== 'conversation') continue
    const ref = evidenceRefFromRow(row)
    memberConversations.push({
      ref,
      sessionId: row.source_id,
      sessionTitle: sessionTitleById.get(row.source_id) ?? null,
    })
  }

  // 派生 sourceReview：找到与本证据集关联的源综述，覆盖两种生成链路：
  //   ① 综述解析自身 §7 引用建出的 set —— reviews.source_evidence_set_id == setId 直接反查命中；
  //   ② 用户在综述生成会话里「+ Add to evidence set」建出的 set（source='agent-assembled' /
  //      含 conversation ref）—— 该 ref 的 source.id 即 agentSessionId，按 session 反查综述。
  // 始终排除 deleted 综述（不依赖 includeDeleted —— deleted 综述对用户无意义，不该再展示入口）。
  let sourceReview = getReviewBySourceEvidenceSetId(db, setId)
  if (!sourceReview) {
    for (const m of memberConversations) {
      const r = getReviewByAgentSessionId(db, m.sessionId)
      if (r) {
        sourceReview = r
        break
      }
    }
  }

  return {
    set: evidenceSetFromRow(
      setRow,
      refRows.map((r) => r.id as ObjectId),
    ),
    note,
    notes,
    tags,
    refs,
    memberPapers,
    memberReviews,
    memberConversations,
    sourceReview,
  }
}

/**
 * 列出所有 evidence_set 的精简摘要。用于：
 *   - "+ Add to evidence set" dialog 的下拉（默认 persistedOnly=true，临时集合不展示）
 *   - 未来的"我的证据集"列表页（persistedOnly=false 时含临时）
 *
 * 单 SQL 多 JOIN + 子查询拿 paperCount，按 created_at DESC 排。
 * paperCount 派生：去重 evidence_refs.source_id where source_kind='paper' AND visibility != 'deleted'。
 */
export function queryEvidenceSetSummaries(
  db: RepoDb,
  opts: { persistedOnly?: boolean; workspaceId: string; tagFilter?: string[] },
): EvidenceSetSummary[] {
  const persistedOnly = opts.persistedOnly ?? true
  const persistedClause = persistedOnly ? 'AND s.persisted = 1' : ''
  // tag 过滤（#709，多选 OR）：含任一选中 tag 即命中。空 / 缺省 = 不过滤。
  const tagFilter = (opts.tagFilter ?? []).map((t) => t.trim()).filter((t) => t.length > 0)
  const tagFilterClause =
    tagFilter.length > 0
      ? `AND s.id IN (SELECT set_id FROM evidence_set_tags WHERE tag IN (${tagFilter
          .map(() => '?')
          .join(',')}))`
      : ''
  // notePreview / noteCount 走 evidence_set_notes join（#709 容器化，不再读 s.note_id legacy 列）
  const rows = db
    .prepare(
      `SELECT
         s.id            AS s_id,
         s.name          AS s_name,
         s.persisted     AS s_persisted,
         s.created_at    AS s_created_at,
         COALESCE(
           (
             SELECT n.body FROM evidence_set_notes esn
               JOIN notes n ON n.id = esn.note_id
              WHERE esn.set_id = s.id AND n.visibility != 'deleted'
              ORDER BY esn.position LIMIT 1
           ),
           (SELECT body FROM notes WHERE id = s.note_id AND visibility != 'deleted')
         )               AS n_body,
         MAX(
           (
             SELECT COUNT(*) FROM evidence_set_notes esn
               JOIN notes n ON n.id = esn.note_id
              WHERE esn.set_id = s.id AND n.visibility != 'deleted'
           ),
           (SELECT CASE WHEN s.note_id IS NOT NULL AND EXISTS(
              SELECT 1 FROM notes WHERE id = s.note_id AND visibility != 'deleted') THEN 1 ELSE 0 END)
         )               AS s_note_count,
         (
           SELECT COUNT(DISTINCT er.source_id)
             FROM evidence_set_refs esr
             JOIN evidence_refs er ON er.id = esr.ref_id
            WHERE esr.set_id = s.id
              AND er.source_kind = 'paper'
              AND er.visibility != 'deleted'
         )               AS s_paper_count
       FROM evidence_sets s
       WHERE s.visibility != 'deleted'
         AND s.workspace_id = ?
         ${persistedClause}
         ${tagFilterClause}
       ORDER BY s.created_at DESC`,
    )
    .all(opts.workspaceId, ...tagFilter) as Array<{
      s_id: string
      s_name: string | null
      s_persisted: number
      s_created_at: string
      n_body: string | null
      s_note_count: number
      s_paper_count: number
    }>
  const setIds = rows.map((r) => r.s_id)
  const previewMap = fetchPaperPreviews(db, setIds)
  const tagsMap = fetchTags(db, setIds)
  return rows.map((r) => ({
    id: r.s_id as ObjectId,
    name: r.s_name,
    persisted: r.s_persisted === 1,
    notePreview: (r.n_body ?? '').slice(0, 100),
    paperCount: r.s_paper_count,
    paperPreview: previewMap.get(r.s_id) ?? [],
    createdAt: r.s_created_at,
    noteCount: r.s_note_count,
    tags: tagsMap.get(r.s_id) ?? [],
  }))
}

/** 给一批 set_id 批量拉各自的 tags（字典序），分组成 Map。空集合 → 不在 Map 中。 */
function fetchTags(db: RepoDb, setIds: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  if (setIds.length === 0) return map
  const placeholders = setIds.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT set_id, tag FROM evidence_set_tags
        WHERE set_id IN (${placeholders})
        ORDER BY set_id, tag`,
    )
    .all(...setIds) as Array<{ set_id: string; tag: string }>
  for (const r of rows) {
    const arr = map.get(r.set_id)
    if (arr) arr.push(r.tag)
    else map.set(r.set_id, [r.tag])
  }
  return map
}

/**
 * 给一批 set_id 拉每个集合前 N 篇 paper 的标题预览（按 position 升序）。
 *
 * 用于 EvidenceSetSummary.paperPreview —— dialog / CITED BY 区 disambiguation 用。
 * 单次查询拉所有 (set_id, title) 对再 JS 端按 set_id 分组截前 N，避免 SQLite 缺乏
 * "per-group LIMIT" 的窗口函数依赖；典型 N=3，调用方 sets 数量也小（<100）。
 */
const PAPER_PREVIEW_MAX = 3
function fetchPaperPreviews(db: RepoDb, setIds: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  if (setIds.length === 0) return map
  const placeholders = setIds.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT esr.set_id AS set_id, p.title AS title
         FROM evidence_set_refs esr
         JOIN evidence_refs er ON er.id = esr.ref_id
         JOIN papers p         ON p.id = er.source_id
        WHERE esr.set_id IN (${placeholders})
          AND er.source_kind = 'paper'
          AND er.visibility != 'deleted'
          AND p.visibility   != 'deleted'
        ORDER BY esr.set_id, esr.position ASC`,
    )
    .all(...setIds) as Array<{ set_id: string; title: string }>
  for (const r of rows) {
    const arr = map.get(r.set_id) ?? []
    if (arr.length < PAPER_PREVIEW_MAX) arr.push(r.title)
    map.set(r.set_id, arr)
  }
  return map
}

/**
 * 反查"包含指定 paper 的所有 evidence set 摘要" —— Library 详情面板 CITED BY 区数据源。
 *
 * 入参传 zoteroKey 是为了避免 renderer 维护 paper 双重身份；内部通过
 * findPaperByZoteroKey 解析到 paperId 再走聚合查询。未懒建 paper（DB 无此行） → 返回 []。
 *
 * SQL 路径（在 queryEvidenceSetSummaries 骨架上加 evidence_refs JOIN 限定到 paper）：
 *   evidence_refs(source_kind='paper', source_id=paperId, target_kind='evidence-set')
 *     → evidence_set_refs → evidence_sets → notes
 *
 * 索引契约：命中 idx_evidence_refs_source(source_kind, source_id)。
 * paperCount 子查询与 queryEvidenceSetSummaries 一致（去重 source_id, source_kind='paper'）。
 */
export function queryEvidenceSetSummariesByPaper(
  db: RepoDb,
  zoteroKey: string,
  workspaceId: string,
): EvidenceSetSummary[] {
  const paper = findPaperByZoteroKey(db, zoteroKey)
  if (!paper) return []
  const rows = db
    .prepare(
      `SELECT DISTINCT
         s.id            AS s_id,
         s.name          AS s_name,
         s.persisted     AS s_persisted,
         s.created_at    AS s_created_at,
         COALESCE(
           (
             SELECT n.body FROM evidence_set_notes esn
               JOIN notes n ON n.id = esn.note_id
              WHERE esn.set_id = s.id AND n.visibility != 'deleted'
              ORDER BY esn.position LIMIT 1
           ),
           (SELECT body FROM notes WHERE id = s.note_id AND visibility != 'deleted')
         )               AS n_body,
         MAX(
           (
             SELECT COUNT(*) FROM evidence_set_notes esn
               JOIN notes n ON n.id = esn.note_id
              WHERE esn.set_id = s.id AND n.visibility != 'deleted'
           ),
           (SELECT CASE WHEN s.note_id IS NOT NULL AND EXISTS(
              SELECT 1 FROM notes WHERE id = s.note_id AND visibility != 'deleted') THEN 1 ELSE 0 END)
         )               AS s_note_count,
         (
           SELECT COUNT(DISTINCT er.source_id)
             FROM evidence_set_refs esr
             JOIN evidence_refs er ON er.id = esr.ref_id
            WHERE esr.set_id = s.id
              AND er.source_kind = 'paper'
              AND er.visibility != 'deleted'
         )               AS s_paper_count
       FROM evidence_refs r
       JOIN evidence_set_refs sr ON sr.ref_id = r.id
       JOIN evidence_sets s      ON s.id = sr.set_id
       WHERE r.source_kind = 'paper'
         AND r.source_id   = ?
         AND r.target_kind = 'evidence-set'
         AND r.target_id   = s.id
         AND s.workspace_id = ?
         AND r.visibility != 'deleted'
         AND s.visibility != 'deleted'
       ORDER BY s.created_at DESC`,
    )
    .all(paper.id, workspaceId) as Array<{
      s_id: string
      s_name: string | null
      s_persisted: number
      s_created_at: string
      n_body: string | null
      s_note_count: number
      s_paper_count: number
    }>
  const setIds = rows.map((r) => r.s_id)
  const previewMap = fetchPaperPreviews(db, setIds)
  const tagsMap = fetchTags(db, setIds)
  return rows.map((r) => ({
    id: r.s_id as ObjectId,
    name: r.s_name,
    persisted: r.s_persisted === 1,
    notePreview: (r.n_body ?? '').slice(0, 100),
    paperCount: r.s_paper_count,
    paperPreview: previewMap.get(r.s_id) ?? [],
    createdAt: r.s_created_at,
    noteCount: r.s_note_count,
    tags: tagsMap.get(r.s_id) ?? [],
  }))
}
