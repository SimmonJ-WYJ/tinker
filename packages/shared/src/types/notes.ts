/**
 * Notes IPC 通道与类型 —— v0.2 证据列表重构版
 *
 * 渲染端通过 `window.electronAPI.notes.*` 调用，主进程 ipcMain.handle 注册同名通道；
 * 业务逻辑落到 apps/electron/src/main/lib/notes-service.ts。
 *
 * --- v0.2 重构后的数据通路 ---
 *
 * 旧版本：notes.target_kind / target_id 直接把 note 挂在 paper / evidence-set 上。
 * 新版本：note 是纯文本对象，所属关系全部反向解析。
 *
 *   "在 paper 中划词写 note" → 单事务 4 步：
 *     1. INSERT notes
 *     2. INSERT evidence_sets (note_id=1.id, persisted=0)
 *     3. INSERT evidence_refs (source_kind='paper', target_kind='evidence-set')
 *     4. INSERT evidence_set_refs (set_id=2.id, ref_id=3.id, position=0)
 *
 *   "列出某 paper 的 note" → 反查路径：
 *     paper.id → evidence_refs(source_id, target_kind='evidence-set')
 *              → evidence_sets(id=ref.target_id)
 *              → notes(id=set.note_id)
 *
 * 设计要点（保持与旧版本一致的部分）：
 *   - 渲染端不直接传 Paper.ObjectId —— 因为 0.1 的库视图只持有 Zotero item key；
 *     由主进程通过 `findOrCreatePaperByZoteroKey()` 懒物化一行 Paper，再走划词建注流程。
 *   - `paperFallback` 在 create 通道携带；listByPaper 不需要 fallback（找不到 paper
 *     直接返回空数组，与"还没写过 Note"语义一致）。
 *
 * 参见 docs/superpowers/specs/2026-05-22-evidence-list-data-model-design.md
 */

import type { Anchor } from './anchor.ts'
import type { Note, ObjectId } from './objects/index.ts'

export const NOTES_IPC_CHANNELS = {
  /**
   * 在 paper 中划词建 note —— 单事务 4 步：
   *   note → evidence_set (1:1) → evidence_ref (source=paper段落, target=set) → evidence_set_refs。
   * 主进程先 lazy upsert Paper（findOrCreatePaperByZoteroKey）再开事务。
   */
  CREATE_FROM_PAPER_HIGHLIGHT: 'notes:createFromPaperHighlight',
  /**
   * 在综述中点 Evidence trace "+ Add note here" 建 note —— 单事务 4 步：
   *   note → evidence_set (1:1) → evidence_ref (source=review句子, target=set) → evidence_set_refs。
   * 与 paper 链路对偶；区别仅 source_kind='review'，source_anchor 是 HTML 锚点。
   * 不做 review 懒物化（review 已在 DB 才能被点）。
   */
  CREATE_FROM_REVIEW_HIGHLIGHT: 'notes:createFromReviewHighlight',
  /** 反查当前 Paper 的全部 Note（按 createdAt DESC）—— 经 evidence_refs → evidence_sets → notes */
  LIST_BY_PAPER: 'notes:listByPaper',
  /** 全局列出 Note + 关联 paper 标题（V6a Notes 视图用） */
  LIST_ALL: 'notes:listAll',
  /** 修改既有 Note 的 body */
  UPDATE_BODY: 'notes:updateBody',
  /** 软删 Note（visibility='deleted'）—— 同时软删关联的 evidence_set 及其 refs（应用层链） */
  SOFT_DELETE: 'notes:softDelete',
} as const

/** Paper 懒创建时的兜底元数据：来自 renderer 端 libraryItemDetailAtom */
export interface NotesPaperFallback {
  title: string
  authors: string[]
  abstract?: string
  year?: number
  venue?: string
  doi?: string
  url?: string
}

export interface NotesCreateFromPaperHighlightInput {
  /** Markdown body —— 用户备注全文（B3 起不再混入 `> quote` 前缀） */
  body: string
  /** 懒创建 Paper 的输入：zoteroKey + fallback 元数据 */
  paper: {
    zoteroKey: string
    fallback: NotesPaperFallback
  }
  /**
   * 论文侧划词锚点 —— 定位本 note 锁定的论文段落。
   * snapshotText 是必填灵魂：即便没有结构化 locationData，靠它也能跨副本兜底定位。
   * 若 UI 暂无真实划词（自由文本笔记），调用方可传 snapshotText='' 占位，但仍需走 anchor。
   */
  sourceAnchor: Anchor
  /** 所属 workspace id（issue #457）；新建证据集必须 scope 到当前 workspace。 */
  workspaceId: string
}

export interface NotesListByPaperInput {
  zoteroKey: string
  /** 当前 workspace id（issue #457）；只返回该 workspace 内引用本 paper 的 note。 */
  workspaceId: string
}

/** 全局 Note 列表入参（issue #457）：scope 到当前 workspace。 */
export interface NotesListAllInput {
  workspaceId: string
}

/**
 * listByPaper 的单项返回（B3 起）：Note + 与本 Paper 关联那条 EvidenceRef 的引文。
 *
 * B3 之前 quote 编码进 `Note.body` 的 blockquote 前缀；现在 quote 改为：
 *   - 数据源：EvidenceRef.anchor.snapshotText（与本 paper 关联的那条 ref）
 *   - 同步随 Note 返回，避免渲染端再发一次反查
 *
 * 一个 Note ↔ 一个 EvidenceSet ↔ 多条 EvidenceRef；针对 listByPaper 的过滤上下文，
 * 命中本 paper 的 ref（一般只有一条）的 anchor.snapshotText 就是 UI 要展示的"原文"。
 *
 * 若该 paper 在 set 中没有对应 ref（理论极端情况） → quote='' 。
 */
export interface NoteWithQuote {
  note: Note
  /** EvidenceRef.anchor.snapshotText —— 与本 Paper 关联的引文片段（可空字符串） */
  quote: string
  /**
   * PDF 锚点页码（1-based，issue #452）—— 划词建注时捕获的选区所在页。
   * 仅 type='pdf' 的 anchor 有值；文本匹配 miss 时 PdfRenderer 据此回退翻页。
   */
  page?: number
}

export interface NotesUpdateBodyInput {
  id: ObjectId
  body: string
}

export interface NotesSoftDeleteInput {
  id: ObjectId
}

/**
 * 创建结果：返回 4 步事务的所有产出物 id，方便 renderer 端缓存 / 后续操作。
 * paperId 是物化（或复用）的 Paper id；evidenceSetId 与 evidenceRefId 是新建的对象 id。
 */
export interface NotesCreateFromPaperHighlightResult {
  note: Note
  paperId: ObjectId
  evidenceSetId: ObjectId
  evidenceRefId: ObjectId
}

/**
 * 综述侧建注入参 —— 在综述里点 Evidence trace "+ Add note here" 时调用。
 * 与 paper 版本对偶；不带 lazy upsert（review 已在 DB 才能被点）。
 */
export interface NotesCreateFromReviewHighlightInput {
  /** 综述 id（reviews.id） */
  reviewId: ObjectId
  /** Markdown body —— 用户备注全文（B3 起不再混入 `> quote` 前缀） */
  body: string
  /**
   * 综述侧锚点 —— 定位本 note 标注的综述位置。
   * type='html'，locationData 通常含 sectionId / paragraphIndex / citeIndex；
   * snapshotText 是必填灵魂：即便没有结构化 locationData，靠它也能跨副本兜底定位。
   */
  sourceAnchor: Anchor
  /** 所属 workspace id（issue #457）；新建证据集必须 scope 到当前 workspace。 */
  workspaceId: string
}

/** 综述侧建注结果 —— 不返回 paperId（语义上本流程不涉及 paper） */
export interface NotesCreateFromReviewHighlightResult {
  note: Note
  evidenceSetId: ObjectId
  evidenceRefId: ObjectId
}

/**
 * 全局 Note 列表项：Note + 首条 ref 关联的 paper / review（取一）。
 *
 * v0.2 重构后的反查路径：notes → evidence_sets(note_id) → evidence_refs(target_id)
 *                                 → papers / reviews（按 source_kind 分两条）。
 * 列表项只取**首条 ref**（按 evidence_set_refs.position 升序）作为"主要来源"展示：
 *   - 首条 ref 是 source_kind='paper'  → paper 字段填，review 为 null
 *   - 首条 ref 是 source_kind='review' → review 字段填，paper 为 null
 *   - set 暂无 ref / 源已软删 → 两者都 null（UI 显示 "(unlinked note)" 占位）
 *
 * 同时附带 evidenceSetId（note ↔ set 是 1:1 强绑定，几乎必有；理论极端情况下
 * note 没有 set 时为 null）—— renderer 选中条目后直接拿 setId 调
 * `evidenceSets:getDetail` 获完整详情，避免多调一次反查 IPC。
 */
export interface NotesListAllItem {
  note: Note
  paper: {
    id: ObjectId
    title: string
    zoteroKey: string | null
  } | null
  review: {
    id: ObjectId
    title: string
    /** 综述 HTML 文件绝对路径；用于 UI 跳转到右侧面板预览（可空） */
    bodyPath: string | null
  } | null
  /**
   * 首条 ref 是 conversation 来源（source_kind='conversation'）时的会话信息；否则 null。
   * 用于把"自由对话创建的证据集"在 UI 上显示成"会话名 + 问答问题"，替代 "(unlinked note)"。
   *   - sessionId：agent session id
   *   - sessionTitle：会话标题（session 已删则 null）
   *   - question：从 anchor.snapshotText（`Q: ...\n\nA: ...`）剥出的问题原文（未截断）
   */
  conversation: {
    sessionId: string
    sessionTitle: string | null
    question: string
  } | null
  /** 1:1 绑定的 evidence_set.id；EvidenceSetsView 选中后用它调 getDetail */
  evidenceSetId: ObjectId | null
  /**
   * 首条 ref（按 evidence_set_refs.position 升序）anchor.snapshotText —— UI 列表展示的"引文片段"。
   * B3 前由 renderer splitBody 解析 Note.body 的 blockquote 前缀获取；现改由 query-service
   * 直接 JOIN 取自 ref，避免双源不一致。set 暂无 ref / 源已软删 → 空字符串。
   */
  quote: string
  /**
   * 绑定 evidence_set 的 name（命名集合时非空，临时集合 / agent-assembled 为 null）。
   * 用于 NotesView 列表卡片：note.body 空时 fallback 用 setName 作主标题，
   * 避免"用户只填 name 没填 note → 卡片空白"的退化。
   */
  setName: string | null
  /**
   * 绑定 evidence_set 内 paper 数（去重 source_id，仅 source_kind='paper' 且 visibility != 'deleted'）。
   * 用于 NotesView 列表卡片"N 篇论文" badge，与 PaperContainingEvidenceSetsPanel 视觉同源。
   */
  setPaperCount: number
}
