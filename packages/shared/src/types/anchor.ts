/**
 * Anchor —— 通用的"如何定位 + 回忆一段源材料"值对象
 *
 * 用途：跨对象表述"某段被引用的内容来自哪里"。两个直接消费者：
 *   1. EvidenceRef.source.anchor —— 指向论文（PDF / wiki md / 任意源材料）里的一段
 *   2. EvidenceRef.target.anchor —— 指向综述（HTML fragment）里被引用的那一句/段
 *
 * 设计契约（不变量）：
 *   - **snapshotText 是 anchor 的灵魂**：verbatim 原文，永远必填。
 *     用于：高亮搜索 key / 跨副本兜底定位 / UI 展示 / dedup 身份。
 *   - **locationData 是加速器**：同副本下提供更快/精确的定位（CSS selector /
 *     byte offset / page+bbox），但**不是定位的必要条件**。任何 anchor 即便
 *     locationData 全空，靠 snapshotText 文本搜索也能用。
 *   - **type 决定 locationData 的解释方式**。AnchorLocation 是 discriminated
 *     union，按 kind 字段分发。
 *
 * 序列化：通过 anchor-codec.ts 的 serializeAnchor / deserializeAnchor 与
 * DB TEXT 列里的 JSON 互转。on-disk JSON 用 snake_case key，与 mappers.ts
 * 里 DB row 的命名风格一致。
 *
 * 版本演进：通过 Anchor.version 字段标识 schema 版本。codec 按 version 分发；
 * 老数据缺 version → 视为 v1。新增字段保持向后兼容（reader 容忍未知字段），
 * 结构性改动才递增 version + 在 codec 加分支。
 */

/** 源材料类型：决定如何解释 locationData。 */
export type AnchorType = 'html' | 'md' | 'pdf' | 'conversation'

/** HTML 类型源材料的结构化定位（如综述 HTML / 任意富文本文档） */
export interface HtmlLocation {
  kind: 'html'
  /** CSS 选择器（如 `#s2 > p:nth-of-type(3) > cite:nth-of-type(1)`），同 HTML 副本下直接 query */
  selector?: string
  /** 语义片段：section id（如 `s2`）—— 给人看 / log 用 */
  sectionId?: string
  /** 0-based 段落索引（在 section 内） */
  paragraphIndex?: number
  /** 0-based cite/inline 元素索引（在段落内）—— 仅 target 侧 cite 锚需要 */
  citeIndex?: number
}

/** Markdown 类型源材料的结构化定位（如 wiki 解析出来的 paper md） */
export interface MdLocation {
  kind: 'md'
  /** markdown 字节范围；与 papers_search_keywords / papers_read_context 对齐 */
  byteOffset?: { start: number; end: number }
  /** 1-based 行号 */
  lineNumber?: number
  /** 0-based 段落索引（按 `\n\n` 切分） */
  paragraphIndex?: number
}

/** PDF 类型源材料的结构化定位（未来支持） */
export interface PdfLocation {
  kind: 'pdf'
  /** 1-based 页码 */
  page?: number
  /** PDF 坐标系下的 bbox（高亮矩形框） */
  bbox?: { x: number; y: number; width: number; height: number }
}

/**
 * Agent 会话消息的结构化定位（v0.2.x，会话 Q&A 存为证据条目）。
 *
 * source.id 用 sessionId（agent-sessions.json 索引中的 id）；anchor 这里指向
 * 该 session 内的具体 assistant 消息 uuid，可选地携带触发该回复的 user 消息 uuid。
 * 会话被删 / 消息被 truncate 时 anchor 仍保留 snapshotText，UI 据此降级到"只读快照"。
 */
export interface ConversationLocation {
  kind: 'conversation'
  /** Agent session id（agent-sessions.json 索引 id） */
  sessionId: string
  /** assistant 消息 uuid（SDKMessage.uuid，fork/rewind 用同一字段） */
  messageUuid: string
  /** 对应触发该回复的 user 消息 uuid；可空（极端首条历史消息可能无 user） */
  userMessageUuid?: string
  /** 消息创建时间（ISO 8601）；UI 展示元信息用 */
  messageTimestamp?: string
}

/** Discriminated union：按 kind 分发到具体 location 类型 */
export type AnchorLocation = HtmlLocation | MdLocation | PdfLocation | ConversationLocation

/**
 * 一个 Anchor：定位 + 文本快照
 *
 * Discriminated by `type`：type 决定 locationData 的 kind。Schema 上允许
 * type 与 locationData.kind 不一致（如离线场景给 type='md' 但只填了
 * snapshotText），但 codec 在 build 阶段会拒绝不一致的组合。
 */
export interface Anchor {
  /** 源材料的格式（决定如何解释 locationData） */
  type: AnchorType
  /**
   * verbatim 原文快照 —— anchor 的"灵魂"。
   * 用于：高亮文本搜索 key / UI 展示 / dedup 身份 / 跨副本兜底定位。
   * 不限长度（SQLite TEXT 不收 size 费），但 codec 层超长会 log warn。
   */
  snapshotText: string
  /** 结构化定位；按 `type` 选具体 kind。可空：仅靠 snapshotText 文本搜索也能工作 */
  locationData?: AnchorLocation
  /** schema 版本；未设定 → 解析层视为 1。v1 起初是这套字段定义 */
  version?: number
}
