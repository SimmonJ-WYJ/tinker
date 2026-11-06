/**
 * EvidenceSets IPC 通道与类型 —— v0.2 证据列表聚合查询
 *
 * 渲染端通过 `window.electronAPI.evidenceSets.*` 调用，主进程 ipcMain.handle 注册
 * 同名通道；业务逻辑落到 apps/electron/src/main/lib/objects/query-service.ts。
 *
 * --- 设计目标 ---
 *
 * UI 渲染证据集详情时需要：set 主表 + 绑定的 note + 集合内所有 ref + 涉及的 paper。
 * 单表查询版本需要 4~5 次 IPC + 客户端拼装；本通道把聚合一次性吐出，渲染端只读一个
 * `EvidenceSetDetail` 对象即可。
 *
 * 见 docs/superpowers/specs/2026-05-24-evidence-set-aggregate-query-design.md
 */

import type { EvidenceRef, EvidenceSetDetail, ObjectId } from './objects/index.ts'
import type { NotesPaperFallback } from './notes.ts'

export const EVIDENCE_SETS_IPC_CHANNELS = {
  /** 拿单个证据集的完整聚合详情（用于详情面板 / EvidenceSetDetailSheet） */
  GET_DETAIL: 'evidenceSets:getDetail',
  /**
   * 列出所有证据集 + 每条简要信息（id / name / notePreview / paperCount / createdAt）。
   * 用于 "+ Add to evidence set" dialog 的下拉，或未来的"我的证据集"列表页。
   */
  LIST_SUMMARY: 'evidenceSets:listSummary',
  /** 把 paper 加入既有 evidence_set（"+ Add to evidence set → 选已有"入口） */
  ADD_PAPER: 'evidenceSets:addPaper',
  /** 新建 evidence_set + 同时挂 paper（"+ Add to evidence set → 新建"入口） */
  CREATE_WITH_PAPER: 'evidenceSets:createWithPaper',
  /**
   * 查"包含此 paper 的 evidence set 列表" —— Library 详情面板 CITED BY 区数据源。
   * 入参 zoteroKey，主进程内部 findPaperByZoteroKey 解析为 paperId；
   * 未懒建 paper（DB 无此行） → 返回 []
   */
  LIST_BY_PAPER: 'evidenceSets:listByPaper',
  /**
   * 查当前 agent session 最近一份 review 的 EvidenceSet 状态（B5）。
   * 用于 Agent 消息上 BookmarkPlus 按钮 popover 决定显示态。
   */
  GET_LATEST_FOR_SESSION: 'evidenceSets:getLatestForSession',
  /**
   * 把综述自动建出的临时 set（persisted=0）提升为正式命名 set（persisted=1）。
   * 入参 setId（由 GET_LATEST_FOR_SESSION 取到）+ name（用户在 popover 输入）。
   */
  PROMOTE_FROM_REVIEW: 'evidenceSets:promoteFromReview',
  /**
   * 重命名已 persisted=1 的证据集。
   * 入参 setId + 新 name；服务侧仅允许对 persisted=1 的 set 操作（临时 set 应走 PROMOTE_FROM_REVIEW）。
   */
  RENAME: 'evidenceSets:rename',
  /**
   * 兜底：独立建一个命名 set（无 refs），用于 review 没有挂临时 set 的异常路径。
   * 入参仅 name；服务侧建占位 note + 持久化 set。
   */
  CREATE_NAMED: 'evidenceSets:createNamed',
  /**
   * 综述兜底：review 已经入库但 source_evidence_set_id=null（自动 hook 抽取失败 / 历史脏数据）
   * 时，先按需触发 parseAndAttachReviewCitations 把 cite 抽出 + 建临时 set，
   * 再 promote 成 persisted=1 命名 set。
   *
   * 重复调用幂等：review 已经有 persisted=1 的 set → 直接走 rename，不重抽。
   */
  ENSURE_AND_PROMOTE_FROM_REVIEW: 'evidenceSets:ensureAndPromoteFromReview',
  /**
   * 把当前 Agent session 的「最近一次问答」作为 conversation 类型证据条目挂入既有证据集
   * （SDKMessageRenderer 弹层「点击已有集合」入口）。幂等：同 (setId, sessionId, messageUuid)
   * 已存在则复用既有 ref，created=false。
   */
  ADD_CONVERSATION_MESSAGE: 'evidenceSets:addConversationMessage',
  /**
   * 新建命名 set 并同时挂当前 Q&A（SDKMessageRenderer 弹层「+ New evidence set」入口）。
   * 自动建占位 note（body 默认取集合名）；返回 set / note / ref id。
   */
  CREATE_WITH_CONVERSATION_MESSAGE: 'evidenceSets:createWithConversationMessage',
  /**
   * 只读预览：本条问答能抽出多少条论文证据候选（去重后），不落库。
   * 用于「加入证据集」popover 打开时判空 —— 候选为 0 时展示「无相关证据」提示并禁用添加，
   * 避免把不含任何被引论文的纯对话存成空证据集。
   */
  PREVIEW_CONVERSATION: 'evidenceSets:previewConversation',
  /**
   * 列出某会话内可加入证据集的 Q&A 回合候选（#709「补证据 · 历史对话」picker 用）。
   * 主进程读 session 的 SDKMessage 流切回合，回合的 snapshotText 在主进程拼好（同
   * 聊天界面「加入证据集」口径）。落库仍走 ADD_CONVERSATION_MESSAGE。
   */
  LIST_CONVERSATION_TURNS: 'evidenceSets:listConversationTurns',
  // ---------- #709 主题容器：笔记 / 证据 co-member 增删 + 标签 ----------
  /** 容器内建一条自由笔记并挂入（EN1/EN2，建 note + 写 evidence_set_notes join） */
  ADD_NOTE: 'evidenceSets:addNote',
  /** 从容器移除一条笔记（EN4，软删 note + 删 join 行） */
  REMOVE_NOTE: 'evidenceSets:removeNote',
  /** 补证据：对象级引用一个库对象进容器（EN1/EN3，建 object-level ref + 挂入） */
  ADD_EVIDENCE: 'evidenceSets:addEvidence',
  /** 从容器移除一条证据（EN4，删 join；孤儿 ref 软删，来源对象留库） */
  REMOVE_EVIDENCE: 'evidenceSets:removeEvidence',
  /** 整体替换容器标签（#709，去空白去重，空数组清空） */
  SET_TAGS: 'evidenceSets:setTags',
} as const

export interface EvidenceSetsGetDetailInput {
  id: ObjectId
  /**
   * 是否包含 visibility='deleted' 的 ref / paper 行；默认 false。
   * 审计 / 回收站场景置 true；常规 UI 用默认值。
   */
  includeDeleted?: boolean
}

/** 找不到 set（或 set 被硬删）时返回 null */
export type EvidenceSetsGetDetailResult = EvidenceSetDetail | null

/**
 * 证据集列表项（精简）：用于 dialog 下拉 / 未来的列表页。
 * - persisted=true 时 name 必有；persisted=false 时 name=null（临时集合 —— 一般不展示在选择列表里）
 * - notePreview：绑定 note.body 的前 N 字符
 * - paperCount：set 内不同 source 的 paper 数（去重 source_id, source_kind='paper'，排除 deleted ref）
 */
export interface EvidenceSetSummary {
  id: ObjectId
  name: string | null
  persisted: boolean
  notePreview: string
  paperCount: number
  /** 集合内前 3 篇 paper 的标题预览（按 evidence_set_refs.position 升序）；空集合 → [] */
  paperPreview: string[]
  createdAt: string
  /** 容器内笔记数（M:N，#709 主题容器化；走 evidence_set_notes join） */
  noteCount: number
  /** 容器级标签（字典序，#709）；无标签 → [] */
  tags: string[]
}

export interface EvidenceSetsListSummaryInput {
  /** 是否只返回 persisted=true 的命名集合；默认 true（dialog 用） */
  persistedOnly?: boolean
  /** 当前 workspace id（issue #457）；只返回该 workspace 内的证据集。 */
  workspaceId: string
  /**
   * 可选 tag 过滤（#709，多选 OR 语义）：只返回含其中**任一** tag 的容器；
   * 空数组 / 缺省 = 不过滤。
   */
  tagFilter?: string[]
}

export type EvidenceSetsListSummaryResult = EvidenceSetSummary[]

/**
 * "+ Add to evidence set → 选已有" 入参 —— 给指定 set 挂 paper（lazy upsert paper 行）。
 *
 * 幂等：若 paper 已在 set 内（同向 ref 且未软删）则复用既有 ref 不重复创建；
 * 返回 created=false 标记给 UI 区分。
 */
export interface EvidenceSetsAddPaperInput {
  setId: ObjectId
  /** 懒创建 Paper 的输入：zoteroKey + fallback 元数据（与 notes:createFromPaperHighlight 对齐） */
  paper: {
    zoteroKey: string
    fallback: NotesPaperFallback
  }
  /**
   * 可选追加到集合 note.body 末尾的"补充说明"文本（dialog 用户在 textarea 写的内容）。
   * 空字符串 / undefined → 不动 note；非空 → fetch 现有 body 后追加（空行分隔），save。
   * set.note_id IS NULL（agent-assembled set 允许无 note）→ 静默忽略，不抛错。
   */
  noteAddendum?: string
}

export interface EvidenceSetsAddPaperResult {
  paperId: ObjectId
  evidenceRefId: ObjectId
  /** true = 新建了 ref；false = paper 本来就在 set 里，复用既有 ref */
  created: boolean
}

/**
 * "+ Add to evidence set → 新建" 入参 —— 新建命名 set 并同时挂当前 paper。
 *
 * 自动建一条占位 note（kind='note'，body 默认取集合名）作为 set 的 1:1 绑定 note。
 * 用户后续可在 Evidence Sets 视图编辑 note body。
 */
export interface EvidenceSetsCreateWithPaperInput {
  /** 集合名（必填） */
  name: string
  /** 占位 note 的 body；不传则用 name */
  noteBody?: string
  paper: {
    zoteroKey: string
    fallback: NotesPaperFallback
  }
  /** 所属 workspace id（issue #457）；新建证据集必须 scope 到当前 workspace。 */
  workspaceId: string
}

export interface EvidenceSetsCreateWithPaperResult {
  paperId: ObjectId
  noteId: ObjectId
  evidenceSetId: ObjectId
  evidenceRefId: ObjectId
}

/**
 * "包含此 paper 的 evidence set 列表" 入参 —— Library 详情面板 CITED BY 区数据源。
 *
 * 传 zoteroKey 是为了避免 renderer 维护 paper 双重身份（ObjectId vs Zotero key）；
 * 主进程内部 findPaperByZoteroKey 解析；未懒建 paper 直接返回 []。
 */
export interface EvidenceSetsListByPaperInput {
  zoteroKey: string
  /** 当前 workspace id（issue #457）；只返回该 workspace 内引用本 paper 的证据集。 */
  workspaceId: string
}

export type EvidenceSetsListByPaperResult = EvidenceSetSummary[]

// ---------- B5: 综述场景，临时 set → 正式 set ----------

/**
 * 当前 agent session 最近一份 review 的 EvidenceSet 状态。
 *
 *   - reviewId=null：会话尚无 review（popover 显示"暂无可保存的证据集"提示）
 *   - setId=null：review 存在但没挂 set（cite 为空 / 抽取失败） → 同样无可保存
 *   - setPersisted=false：可保存（popover 显示输入框 + 保存按钮，默认填 reviewTitle）
 *   - setPersisted=true：已保存（popover 显示"已保存 · setName" + 详情链接）
 */
export interface EvidenceSetsGetLatestForSessionInput {
  agentSessionId: string
}

export interface EvidenceSetsGetLatestForSessionResult {
  reviewId: ObjectId | null
  reviewTitle: string | null
  setId: ObjectId | null
  setPersisted: boolean
  setName: string | null
}

export interface EvidenceSetsPromoteFromReviewInput {
  setId: ObjectId
  /** 用户输入的集合名；服务侧会 trim 后再校验非空 */
  name: string
}

export interface EvidenceSetsPromoteFromReviewResult {
  setId: ObjectId
  name: string
  savedAt: string
}

/** 重命名已 persisted=1 的证据集（B5 follow-up）：popover 已保存态的输入框 + Rename 按钮 */
export interface EvidenceSetsRenameInput {
  setId: ObjectId
  /** 新名字；服务侧 trim 后校验非空 */
  name: string
}

export interface EvidenceSetsRenameResult {
  setId: ObjectId
  name: string
}

/** 兜底创建独立命名 set —— 无 refs，待后续手动加 paper */
export interface EvidenceSetsCreateNamedInput {
  name: string
  /** 所属 workspace id（issue #457）；新建证据集必须 scope 到当前 workspace。 */
  workspaceId: string
}

export interface EvidenceSetsCreateNamedResult {
  setId: ObjectId
  name: string
}

/**
 * 综述兜底入口（B5 follow-up）：
 *   - review.sourceEvidenceSetId 已存在 → 直接 promote（persisted=0 → 1）或 rename（已 persisted=1）
 *   - review.sourceEvidenceSetId=null → 读 review.bodyPath 触发一次 parseAndAttachReviewCitations
 *     建出（可能为空的）临时 set 再 promote
 *
 * 失败语义：review 不存在 / bodyPath 缺失 / 文件读取失败 → 抛业务错，UI 提示原因。
 */
export interface EvidenceSetsEnsureAndPromoteFromReviewInput {
  reviewId: ObjectId
  /** 用户输入的集合名；服务侧会 trim 后再校验非空 */
  name: string
}

export interface EvidenceSetsEnsureAndPromoteFromReviewResult {
  setId: ObjectId
  name: string
  savedAt: string
}

// ---------- conversation 源：会话 Q&A 存为证据条目 ----------

/**
 * 共享字段：定位会话内某条 assistant 消息 + 该次 Q&A 的快照文本。
 *
 * snapshotText 约定形态：
 *   Q: <userText>
 *
 *   A: <assistantText>
 *
 * 由 renderer 在弹层入口拼接；脱离 session 也读得懂。
 */
export interface ConversationEvidencePayload {
  /** Agent session id（agent-sessions.json 索引 id） */
  sessionId: string
  /** assistant 消息 uuid（SDKMessage.uuid） */
  messageUuid: string
  /** 触发该回复的 user 消息 uuid；可空 */
  userMessageUuid?: string
  /** 消息创建时间 ISO 8601（来自 SDKMessage 时间戳）；可空 */
  messageTimestamp?: string
  /** verbatim 快照文本（Q&A 拼接）；服务侧 trim 后校验非空 */
  snapshotText: string
  /**
   * 是否把 session 关联综述里的被引论文一并落成 paper ref 加入集合。
   *
   * - `true`：UI 已确认本次添加的 messageUuid 是综述生成那条 assistant message（典型信号：
   *   turn 内有 Write 工具调用，写入路径在 cwd/reviews/*.html）。服务端会调用
   *   attachReviewPaperRefsForSession，按综述 HTML 的 <cite><q> 抽出被引论文落 paper ref。
   * - `false` / 缺省（默认）：仅落 conversation 类型 ref + 兜底扫消息工具调用里的论文引用；
   *   **不**带入综述的被引论文。
   *
   * 这条 flag 在 v0.2.x 引入，修复"同 session 普通 Q&A 被加入证据集时也错误拖入综述论文"
   * 的 bug —— 原 review-first 路径仅按 sessionId 判定，不区分消息粒度，跨消息误伤。
   */
  includeReviewCitations?: boolean
}

export interface EvidenceSetsAddConversationMessageInput extends ConversationEvidencePayload {
  setId: ObjectId
}

export interface EvidenceSetsAddConversationMessageResult {
  ref: EvidenceRef
  /** true = 新建了 ref；false = 同 (setId, sessionId, messageUuid) 已存在，复用既有 ref */
  created: boolean
}

export interface EvidenceSetsCreateWithConversationMessageInput extends ConversationEvidencePayload {
  /** 集合名（必填，服务侧 trim 后校验非空） */
  name: string
  /** 占位 note 的 body；不传则用 name */
  noteBody?: string
}

export interface EvidenceSetsCreateWithConversationMessageResult {
  evidenceSetId: ObjectId
  noteId: ObjectId
  ref: EvidenceRef
}

/**
 * 只读预览入参：复用 conversation 抽取口径（answer 正文标识 + 工具调用 + 可选综述被引），
 * 但不落库，仅统计去重后的论文候选数。
 */
export interface EvidenceSetsPreviewConversationInput {
  sessionId: string
  messageUuid: string
  /** true 时一并统计 session 关联综述 HTML 的被引论文（与 add 路径同口径） */
  includeReviewCitations?: boolean
}

export interface EvidenceSetsPreviewConversationResult {
  /** 去重后的论文证据候选数；0 表示本条问答没有可加入证据集的相关证据 */
  paperCandidateCount: number
}

/**
 * 「补证据 · 历史对话」picker：列某会话内可加入的 Q&A 回合候选。
 */
export interface EvidenceSetsListConversationTurnsInput {
  /** Agent session id（agent-sessions.json 索引 id） */
  sessionId: string
}

/**
 * 单个会话回合候选 —— 每条含 text 的 assistant 消息为一个回合，回溯到它前面最近的
 * 人类 user 消息作为问句。snapshotText 已在主进程按 buildQaSnapshot 拼好，落库直接用。
 * 幂等键 = (setId, sessionId, messageUuid)，与 ADD_CONVERSATION_MESSAGE 一致。
 */
export interface ConversationTurnCandidate {
  /** assistant 消息 uuid（SDKMessage.uuid）；回合唯一标识 + anchor.messageUuid */
  messageUuid: string
  /** 触发该回复的人类 user 消息 uuid；可空（极端首条历史消息无配对 user） */
  userMessageUuid?: string
  /** 问句预览（截断展示用）；无配对 user 时为空串 */
  questionPreview: string
  /** 回答预览（截断展示用） */
  answerPreview: string
  /** verbatim 快照（Q&A 拼接，buildQaSnapshot），落库直接传给 addConversationMessage */
  snapshotText: string
  /** 回合时间 ISO 8601（assistant 消息时间戳）；可空 */
  messageTimestamp?: string
}

export type EvidenceSetsListConversationTurnsResult = ConversationTurnCandidate[]

// ---------- #709 主题容器：笔记 / 证据 co-member 增删 + 标签 ----------

export interface EvidenceSetsAddNoteInput {
  setId: ObjectId
  /** 自由笔记正文；服务侧 trim 后校验非空 */
  body: string
}

export interface EvidenceSetsAddNoteResult {
  noteId: ObjectId
}

export interface EvidenceSetsRemoveNoteInput {
  setId: ObjectId
  noteId: ObjectId
}

export interface EvidenceSetsAddEvidenceInput {
  setId: ObjectId
  /** 对象级引用的来源类型（conversation 走 ADD_CONVERSATION_MESSAGE，不在此） */
  sourceKind: 'paper' | 'review'
  /** 来源对象 id（paper / review 的 ObjectId） */
  sourceId: ObjectId
  /**
   * 可选 verbatim 引文。整篇**对象级**引用没有具体段落 → 留空（snapshotText=''），
   * 证据卡只显示来源标题、不显示引文（#709 C1）；精确段落仍走划词。
   */
  snapshotText?: string
}

export interface EvidenceSetsAddEvidenceResult {
  refId: ObjectId
}

export interface EvidenceSetsRemoveEvidenceInput {
  setId: ObjectId
  refId: ObjectId
}

export interface EvidenceSetsSetTagsInput {
  setId: ObjectId
  /** 整体替换的标签集合；服务侧去空白去重，空数组 = 清空 */
  tags: string[]
}
