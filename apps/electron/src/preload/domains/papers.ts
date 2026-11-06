/**
 * Preload · papers domain 片段
 *
 * 论文 / 证据相关 namespace：工作区论文库（workspacePapers）、Notes、
 * EvidenceSets、OutputFeedback、Reviews 反查、Papers 反查、引用图谱（citationGraph）。
 * 每个 namespace 各导出一个独立类型化片段。
 */
import { ipcRenderer } from 'electron'
import {
  WORKSPACE_PAPERS_IPC_CHANNELS,
  CITATION_GRAPH_IPC_CHANNELS,
  NOTES_IPC_CHANNELS,
  EVIDENCE_SETS_IPC_CHANNELS,
  OUTPUT_FEEDBACK_IPC_CHANNELS,
  REVIEWS_IPC_CHANNELS,
  PAPERS_IPC_CHANNELS,
} from '@asci/shared'
import type {
  LinkZoteroOpts,
  LinkZoteroResult,
  WorkspacePaperEntry,
  WorkspacePapersFilter,
  WorkspacePaperPatch,
  CitationGraphBuildRequest,
  CitationGraphBuildAck,
  CitationGraphStreamEvent,
  CitationGraphClearCacheInput,
  CitationGraphClearCacheResult,
  CitationGraphAddToZoteroInput,
  CitationGraphAddToZoteroResult,
  EvidenceSetsAddConversationMessageInput,
  EvidenceSetsAddConversationMessageResult,
  EvidenceSetsAddPaperInput,
  EvidenceSetsAddPaperResult,
  EvidenceSetsCreateWithConversationMessageInput,
  EvidenceSetsCreateWithConversationMessageResult,
  EvidenceSetsPreviewConversationInput,
  EvidenceSetsPreviewConversationResult,
  EvidenceSetsListConversationTurnsInput,
  EvidenceSetsListConversationTurnsResult,
  EvidenceSetsCreateWithPaperInput,
  EvidenceSetsCreateWithPaperResult,
  EvidenceSetsGetDetailInput,
  EvidenceSetsGetDetailResult,
  EvidenceSetsGetLatestForSessionInput,
  EvidenceSetsGetLatestForSessionResult,
  EvidenceSetsListByPaperInput,
  EvidenceSetsListByPaperResult,
  EvidenceSetsListSummaryInput,
  EvidenceSetsListSummaryResult,
  EvidenceSetsPromoteFromReviewInput,
  EvidenceSetsPromoteFromReviewResult,
  EvidenceSetsCreateNamedInput,
  EvidenceSetsCreateNamedResult,
  EvidenceSetsEnsureAndPromoteFromReviewInput,
  EvidenceSetsEnsureAndPromoteFromReviewResult,
  EvidenceSetsRenameInput,
  EvidenceSetsRenameResult,
  EvidenceSetsAddNoteInput,
  EvidenceSetsAddNoteResult,
  EvidenceSetsRemoveNoteInput,
  EvidenceSetsAddEvidenceInput,
  EvidenceSetsAddEvidenceResult,
  EvidenceSetsRemoveEvidenceInput,
  EvidenceSetsSetTagsInput,
  OutputFeedbackSetInput,
  OutputFeedbackSetResult,
  OutputFeedbackGetForSessionInput,
  OutputFeedbackGetForSessionResult,
  ReviewsResolveByBodyPathInput,
  ReviewsResolveByBodyPathResult,
  ReviewsListResult,
  Note,
  NotesCreateFromPaperHighlightInput,
  NotesCreateFromPaperHighlightResult,
  NotesCreateFromReviewHighlightInput,
  NotesCreateFromReviewHighlightResult,
  NoteWithQuote,
  NotesListAllItem,
  NotesListAllInput,
  NotesListByPaperInput,
  NotesSoftDeleteInput,
  NotesUpdateBodyInput,
  PapersGetByDoiInput,
  PapersGetByIdInput,
  PapersGetResult,
  PapersResolveZoteroKeyInput,
  PapersResolveZoteroKeyResult,
  PapersLookupDoiMetadataInput,
  PapersLookupDoiMetadataResult,
  WorkspacePapersChangedEvent,
  PaperRecord,
} from '@asci/shared'
import { subscribe } from '../helpers'

/** 工作区论文库 */
export interface WorkspacePapersApi {
  list: (workspaceId: string, filter: WorkspacePapersFilter) => Promise<WorkspacePaperEntry[]>
  get: (workspaceId: string, key: string) => Promise<WorkspacePaperEntry | null>
  update: (workspaceId: string, key: string, patch: WorkspacePaperPatch) => Promise<WorkspacePaperEntry>
  batchUpdate: (workspaceId: string, keys: string[], patch: WorkspacePaperPatch) => Promise<WorkspacePaperEntry[]>
  linkZotero: (workspaceId: string, key: string, opts: LinkZoteroOpts) => Promise<LinkZoteroResult>
  downloadPdf: (workspaceId: string, key: string, url?: string) => Promise<WorkspacePaperEntry>
  createNote: (workspaceId: string, key: string, initialContent?: string) => Promise<WorkspacePaperEntry>
  /** 用户主动把 session-level PaperRecord 合并进 workspace-papers；返回被改动的 entries */
  ingestRecords: (workspaceId: string, records: PaperRecord[], sessionId: string) => Promise<WorkspacePaperEntry[]>
  onChanged: (cb: (e: WorkspacePapersChangedEvent) => void) => () => void
}

/** Notes (v0.2 证据列表重构后)：划词建注 + 笔记列表 + 全局聚合 */
export interface NotesApi {
  /**
   * 在 paper 中划词建 note —— 主进程单事务 4 步：
   *   note → evidence_set (1:1) → evidence_ref (source=paper, target=set) → evidence_set_refs。
   */
  createFromPaperHighlight: (
    input: NotesCreateFromPaperHighlightInput,
  ) => Promise<NotesCreateFromPaperHighlightResult>
  /**
   * 在综述里点 Evidence trace "+ Add note here" 建 note —— 与 paper 链路对偶，
   * 区别仅 source_kind='review' + 不做 review 懒物化。
   */
  createFromReviewHighlight: (
    input: NotesCreateFromReviewHighlightInput,
  ) => Promise<NotesCreateFromReviewHighlightResult>
  listByPaper: (input: NotesListByPaperInput) => Promise<NoteWithQuote[]>
  /** V6a：全局聚合所有 Note（含关联 paper 标题）；issue #457 起按 workspace scope */
  listAll: (input: NotesListAllInput) => Promise<NotesListAllItem[]>
  updateBody: (input: NotesUpdateBodyInput) => Promise<Note>
  softDelete: (input: NotesSoftDeleteInput) => Promise<void>
}

/** EvidenceSets：聚合查询 + 关联操作 */
export interface EvidenceSetsApi {
  /**
   * 拿单个证据集的完整聚合详情：set + 绑定 note + 所有 ref + 派生 memberPapers。
   * 详情面板渲染时调一次即可，无需多次 IPC 拼装。
   */
  getDetail: (input: EvidenceSetsGetDetailInput) => Promise<EvidenceSetsGetDetailResult>
  /** 列出所有证据集精简摘要（dialog 下拉 / 列表页用）；issue #457 起按 workspace scope */
  listSummary: (
    input: EvidenceSetsListSummaryInput,
  ) => Promise<EvidenceSetsListSummaryResult>
  /** "+ Add to evidence set → 选已有"：把 paper 加入既有 set（幂等） */
  addPaper: (input: EvidenceSetsAddPaperInput) => Promise<EvidenceSetsAddPaperResult>
  /** "+ Add to evidence set → 新建"：新建命名 set 并挂 paper */
  createWithPaper: (
    input: EvidenceSetsCreateWithPaperInput,
  ) => Promise<EvidenceSetsCreateWithPaperResult>
  /** 反查"包含此 paper 的 evidence set 列表"（Library 详情面板 CITED BY 区数据源） */
  listByPaper: (
    input: EvidenceSetsListByPaperInput,
  ) => Promise<EvidenceSetsListByPaperResult>
  /** B5：拿当前 agent session 最近一份 review 的 EvidenceSet 状态（BookmarkPlus popover 用） */
  getLatestForSession: (
    input: EvidenceSetsGetLatestForSessionInput,
  ) => Promise<EvidenceSetsGetLatestForSessionResult>
  /** B5：把综述自动建出的临时 set 提升为正式（persisted=1 + name + saved_at） */
  promoteFromReview: (
    input: EvidenceSetsPromoteFromReviewInput,
  ) => Promise<EvidenceSetsPromoteFromReviewResult>
  /** B5 follow-up：重命名已保存的证据集（popover 已保存态的 Rename 按钮） */
  rename: (input: EvidenceSetsRenameInput) => Promise<EvidenceSetsRenameResult>
  /** B5 follow-up：兜底独立建命名 set —— review 无临时 set 时使用 */
  createNamed: (
    input: EvidenceSetsCreateNamedInput,
  ) => Promise<EvidenceSetsCreateNamedResult>
  /**
   * B5 follow-up：综述兜底入口 —— review 没挂 set 时先 parse 建临时 set 再 promote；
   * 已挂临时 set 直接 promote；已 persisted=1 则 rename。重复调用幂等。
   */
  ensureAndPromoteFromReview: (
    input: EvidenceSetsEnsureAndPromoteFromReviewInput,
  ) => Promise<EvidenceSetsEnsureAndPromoteFromReviewResult>
  /** v0.2.x：把当前会话 Q&A 加入既有证据集（conversation 源；幂等） */
  addConversationMessage: (
    input: EvidenceSetsAddConversationMessageInput,
  ) => Promise<EvidenceSetsAddConversationMessageResult>
  /** v0.2.x：新建命名集合并同时挂入当前 Q&A */
  createWithConversationMessage: (
    input: EvidenceSetsCreateWithConversationMessageInput,
  ) => Promise<EvidenceSetsCreateWithConversationMessageResult>
  /** v0.2.x：只读预览本条问答的论文证据候选数（popover 判空，不落库） */
  previewConversation: (
    input: EvidenceSetsPreviewConversationInput,
  ) => Promise<EvidenceSetsPreviewConversationResult>
  /** #709「补证据 · 历史对话」picker：列某会话内可加入的 Q&A 回合候选（只读） */
  listConversationTurns: (
    input: EvidenceSetsListConversationTurnsInput,
  ) => Promise<EvidenceSetsListConversationTurnsResult>
  /** #709：详情页内联补一条自由笔记并挂入容器 */
  addNote: (input: EvidenceSetsAddNoteInput) => Promise<EvidenceSetsAddNoteResult>
  /** #709：从容器移除一条笔记（软删 note + 删 join） */
  removeNote: (input: EvidenceSetsRemoveNoteInput) => Promise<void>
  /** #709：补证据（对象级引用库对象进容器） */
  addEvidence: (input: EvidenceSetsAddEvidenceInput) => Promise<EvidenceSetsAddEvidenceResult>
  /** #709：从容器移除一条证据（删 join；孤儿 ref 软删，来源留库） */
  removeEvidence: (input: EvidenceSetsRemoveEvidenceInput) => Promise<void>
  /** #709：整体替换容器标签 */
  setTags: (input: EvidenceSetsSetTagsInput) => Promise<void>
}

/** OutputFeedback：助手输出 👍/👎 直观反馈采集（issue #477） */
export interface OutputFeedbackApi {
  /** 写入/切换/取消一条反馈，返回折叠后的当前态 */
  set: (input: OutputFeedbackSetInput) => Promise<OutputFeedbackSetResult>
  /** 拉取某 session 的回显 map（messageUuid → 'up' | 'down'） */
  getForSession: (
    input: OutputFeedbackGetForSessionInput,
  ) => Promise<OutputFeedbackGetForSessionResult>
}

/** Reviews：辅助反查（综述 HTML 预览组件按 path 加载 → 反查 reviewId 启用 Add note here） */
export interface ReviewsApi {
  resolveByBodyPath: (
    input: ReviewsResolveByBodyPathInput,
  ) => Promise<ReviewsResolveByBodyPathResult>
  /** 列出所有非 deleted 综述（id+title）—— 补证据 · 综述选择器候选（#709） */
  list: () => Promise<ReviewsListResult>
}

/** Papers 反查（综述引文 → Library 联动用） */
export interface PapersApi {
  getByDoi: (input: PapersGetByDoiInput) => Promise<PapersGetResult>
  getById: (input: PapersGetByIdInput) => Promise<PapersGetResult>
  /**
   * 主进程一次性解析 paper 标识 → zoteroKey（SQLite + workspace papers.jsonl 冷热级联）；
   * 比 getByDoi/getById 更适合 EvidenceTraceCard 的"Open in Library"按钮链路。
   */
  resolveZoteroKey: (input: PapersResolveZoteroKeyInput) => Promise<PapersResolveZoteroKeyResult>
  /** DOI 点击未命中本次检索 → crossref 即时查元数据（主进程 5s 超时，永不 reject） */
  lookupDoiMetadata: (input: PapersLookupDoiMetadataInput) => Promise<PapersLookupDoiMetadataResult>
}

/** 引用图谱（Citation Graph） */
export interface CitationGraphApi {
  build: (req: CitationGraphBuildRequest) => Promise<CitationGraphBuildAck>
  cancel: (requestId: string) => Promise<{ cancelled: boolean }>
  /** 订阅流式事件；返回取消订阅函数 */
  onStreamEvent: (cb: (event: CitationGraphStreamEvent) => void) => () => void
  /** 清除缓存（scope='all' 清空 / 'one' 清单条） */
  clearCache: (input: CitationGraphClearCacheInput) => Promise<CitationGraphClearCacheResult>
  /** 直接把图谱节点写入 Zotero（不依赖工作区论文库） */
  addToZotero: (input: CitationGraphAddToZoteroInput) => Promise<CitationGraphAddToZoteroResult>
}

// 工作区论文库
export const workspacePapersApi: WorkspacePapersApi = {
  list: (workspaceId, filter) =>
    ipcRenderer.invoke(WORKSPACE_PAPERS_IPC_CHANNELS.LIST, workspaceId, filter),
  get: (workspaceId, key) =>
    ipcRenderer.invoke(WORKSPACE_PAPERS_IPC_CHANNELS.GET, workspaceId, key),
  update: (workspaceId, key, patch) =>
    ipcRenderer.invoke(WORKSPACE_PAPERS_IPC_CHANNELS.UPDATE, workspaceId, key, patch),
  batchUpdate: (workspaceId, keys, patch) =>
    ipcRenderer.invoke(WORKSPACE_PAPERS_IPC_CHANNELS.BATCH_UPDATE, workspaceId, keys, patch),
  linkZotero: (workspaceId, key, opts) =>
    ipcRenderer.invoke(WORKSPACE_PAPERS_IPC_CHANNELS.LINK_ZOTERO, workspaceId, key, opts),
  downloadPdf: (workspaceId, key, url) =>
    ipcRenderer.invoke(WORKSPACE_PAPERS_IPC_CHANNELS.DOWNLOAD_PDF, workspaceId, key, url),
  createNote: (workspaceId, key, initialContent) =>
    ipcRenderer.invoke(WORKSPACE_PAPERS_IPC_CHANNELS.CREATE_NOTE, workspaceId, key, initialContent),
  ingestRecords: (workspaceId, records, sessionId) =>
    ipcRenderer.invoke(WORKSPACE_PAPERS_IPC_CHANNELS.INGEST_RECORDS, workspaceId, records, sessionId),
  onChanged: (cb) => {
    return subscribe(WORKSPACE_PAPERS_IPC_CHANNELS.CHANGED_EVENT, cb)
  },
}

// Notes (v0.2 证据列表重构后)
export const notesApi: NotesApi = {
  createFromPaperHighlight: (input) =>
    ipcRenderer.invoke(NOTES_IPC_CHANNELS.CREATE_FROM_PAPER_HIGHLIGHT, input),
  createFromReviewHighlight: (input) =>
    ipcRenderer.invoke(NOTES_IPC_CHANNELS.CREATE_FROM_REVIEW_HIGHLIGHT, input),
  listByPaper: (input) => ipcRenderer.invoke(NOTES_IPC_CHANNELS.LIST_BY_PAPER, input),
  listAll: (input) => ipcRenderer.invoke(NOTES_IPC_CHANNELS.LIST_ALL, input),
  updateBody: (input) => ipcRenderer.invoke(NOTES_IPC_CHANNELS.UPDATE_BODY, input),
  softDelete: (input) => ipcRenderer.invoke(NOTES_IPC_CHANNELS.SOFT_DELETE, input),
}

// EvidenceSets 聚合查询 + 关联操作
export const evidenceSetsApi: EvidenceSetsApi = {
  getDetail: (input) => ipcRenderer.invoke(EVIDENCE_SETS_IPC_CHANNELS.GET_DETAIL, input),
  listSummary: (input) =>
    ipcRenderer.invoke(EVIDENCE_SETS_IPC_CHANNELS.LIST_SUMMARY, input),
  addPaper: (input) => ipcRenderer.invoke(EVIDENCE_SETS_IPC_CHANNELS.ADD_PAPER, input),
  createWithPaper: (input) =>
    ipcRenderer.invoke(EVIDENCE_SETS_IPC_CHANNELS.CREATE_WITH_PAPER, input),
  listByPaper: (input) =>
    ipcRenderer.invoke(EVIDENCE_SETS_IPC_CHANNELS.LIST_BY_PAPER, input),
  getLatestForSession: (input) =>
    ipcRenderer.invoke(EVIDENCE_SETS_IPC_CHANNELS.GET_LATEST_FOR_SESSION, input),
  promoteFromReview: (input) =>
    ipcRenderer.invoke(EVIDENCE_SETS_IPC_CHANNELS.PROMOTE_FROM_REVIEW, input),
  rename: (input) => ipcRenderer.invoke(EVIDENCE_SETS_IPC_CHANNELS.RENAME, input),
  createNamed: (input) =>
    ipcRenderer.invoke(EVIDENCE_SETS_IPC_CHANNELS.CREATE_NAMED, input),
  ensureAndPromoteFromReview: (input) =>
    ipcRenderer.invoke(EVIDENCE_SETS_IPC_CHANNELS.ENSURE_AND_PROMOTE_FROM_REVIEW, input),
  addConversationMessage: (input) =>
    ipcRenderer.invoke(EVIDENCE_SETS_IPC_CHANNELS.ADD_CONVERSATION_MESSAGE, input),
  createWithConversationMessage: (input) =>
    ipcRenderer.invoke(EVIDENCE_SETS_IPC_CHANNELS.CREATE_WITH_CONVERSATION_MESSAGE, input),
  previewConversation: (input) =>
    ipcRenderer.invoke(EVIDENCE_SETS_IPC_CHANNELS.PREVIEW_CONVERSATION, input),
  listConversationTurns: (input) =>
    ipcRenderer.invoke(EVIDENCE_SETS_IPC_CHANNELS.LIST_CONVERSATION_TURNS, input),
  addNote: (input) => ipcRenderer.invoke(EVIDENCE_SETS_IPC_CHANNELS.ADD_NOTE, input),
  removeNote: (input) => ipcRenderer.invoke(EVIDENCE_SETS_IPC_CHANNELS.REMOVE_NOTE, input),
  addEvidence: (input) => ipcRenderer.invoke(EVIDENCE_SETS_IPC_CHANNELS.ADD_EVIDENCE, input),
  removeEvidence: (input) =>
    ipcRenderer.invoke(EVIDENCE_SETS_IPC_CHANNELS.REMOVE_EVIDENCE, input),
  setTags: (input) => ipcRenderer.invoke(EVIDENCE_SETS_IPC_CHANNELS.SET_TAGS, input),
}

// OutputFeedback：助手输出 👍/👎 直观反馈采集（issue #477）
export const outputFeedbackApi: OutputFeedbackApi = {
  set: (input) => ipcRenderer.invoke(OUTPUT_FEEDBACK_IPC_CHANNELS.SET, input),
  getForSession: (input) =>
    ipcRenderer.invoke(OUTPUT_FEEDBACK_IPC_CHANNELS.GET_FOR_SESSION, input),
}

// Reviews 辅助反查
export const reviewsApi: ReviewsApi = {
  resolveByBodyPath: (input) =>
    ipcRenderer.invoke(REVIEWS_IPC_CHANNELS.RESOLVE_BY_BODY_PATH, input),
  list: () => ipcRenderer.invoke(REVIEWS_IPC_CHANNELS.LIST),
}

// Papers 反查（综述引文 → Library 联动）
export const papersApi: PapersApi = {
  getByDoi: (input) => ipcRenderer.invoke(PAPERS_IPC_CHANNELS.GET_BY_DOI, input),
  getById: (input) => ipcRenderer.invoke(PAPERS_IPC_CHANNELS.GET_BY_ID, input),
  resolveZoteroKey: (input) =>
    ipcRenderer.invoke(PAPERS_IPC_CHANNELS.RESOLVE_ZOTERO_KEY, input),
  lookupDoiMetadata: (input) =>
    ipcRenderer.invoke(PAPERS_IPC_CHANNELS.LOOKUP_DOI_METADATA, input),
}

// 引用图谱
export const citationGraphApi: CitationGraphApi = {
  build: (req) => ipcRenderer.invoke(CITATION_GRAPH_IPC_CHANNELS.BUILD, req),
  cancel: (requestId) => ipcRenderer.invoke(CITATION_GRAPH_IPC_CHANNELS.CANCEL, requestId),
  onStreamEvent: (cb) => {
    return subscribe(CITATION_GRAPH_IPC_CHANNELS.STREAM_EVENT, cb)
  },
  clearCache: (input) => ipcRenderer.invoke(CITATION_GRAPH_IPC_CHANNELS.CLEAR_CACHE, input),
  addToZotero: (input) => ipcRenderer.invoke(CITATION_GRAPH_IPC_CHANNELS.ADD_TO_ZOTERO, input),
}
