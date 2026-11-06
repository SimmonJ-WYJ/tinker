/**
 * Anchor 序列化 / 反序列化 / 构造 / 比较工具
 *
 * 一组纯函数，负责 Anchor 与 DB JSON 之间的转换：
 *   - serializeAnchor(a) → JSON string（DB TEXT 列存这个）
 *   - deserializeAnchor(json) → Anchor | null（解析失败 / null 输入返回 null）
 *   - 兜底兼容：DB 里非 JSON 的旧字符串（pre-launch 之前手塞的简单 anchor）被
 *     当作 { type: 'html', snapshotText: rawString } 兜底解析，不抛错
 *
 * JSON on-disk 用 **snake_case**（与 DB 行命名一致 + 跨语言可读），TS 内存对象
 * 用 **camelCase**。两者由本模块负责互转。
 *
 * 序列化时**字段顺序固定**（type → snapshot_text → location_data → version），
 * 让 JSON.stringify 出来的字符串在同输入下 byte-exact 一致，方便 dedup 比较。
 */

import type {
  Anchor,
  AnchorLocation,
  AnchorType,
  ConversationLocation,
  HtmlLocation,
  MdLocation,
  PdfLocation,
} from '@asci/shared'

import { createHash } from 'node:crypto'

const ANCHOR_VERSION = 1

/** 超过此长度的 snapshotText 在 build 时 warn —— 不限制，但提醒可能过大 */
const SNAPSHOT_TEXT_WARN_BYTES = 4 * 1024

// ============================================================================
// 构造器：建 Anchor 时强制 kind 与 type 对齐，并兜住 snapshotText 不为空
// ============================================================================

export function buildHtmlAnchor(opts: {
  snapshotText: string
  selector?: string
  sectionId?: string
  paragraphIndex?: number
  citeIndex?: number
}): Anchor {
  warnIfLongSnapshot(opts.snapshotText)
  const locationData: HtmlLocation = { kind: 'html' }
  if (opts.selector !== undefined) locationData.selector = opts.selector
  if (opts.sectionId !== undefined) locationData.sectionId = opts.sectionId
  if (opts.paragraphIndex !== undefined) locationData.paragraphIndex = opts.paragraphIndex
  if (opts.citeIndex !== undefined) locationData.citeIndex = opts.citeIndex
  return {
    type: 'html',
    snapshotText: opts.snapshotText,
    locationData,
    version: ANCHOR_VERSION,
  }
}

export function buildMdAnchor(opts: {
  snapshotText: string
  byteOffset?: { start: number; end: number }
  lineNumber?: number
  paragraphIndex?: number
}): Anchor {
  warnIfLongSnapshot(opts.snapshotText)
  const locationData: MdLocation = { kind: 'md' }
  if (opts.byteOffset !== undefined) locationData.byteOffset = opts.byteOffset
  if (opts.lineNumber !== undefined) locationData.lineNumber = opts.lineNumber
  if (opts.paragraphIndex !== undefined) locationData.paragraphIndex = opts.paragraphIndex
  // 没有任何 location data 时不附 locationData，保持 JSON 干净
  const hasAny =
    locationData.byteOffset !== undefined ||
    locationData.lineNumber !== undefined ||
    locationData.paragraphIndex !== undefined
  return {
    type: 'md',
    snapshotText: opts.snapshotText,
    ...(hasAny ? { locationData } : {}),
    version: ANCHOR_VERSION,
  }
}

export function buildPdfAnchor(opts: {
  snapshotText: string
  page?: number
  bbox?: { x: number; y: number; width: number; height: number }
}): Anchor {
  warnIfLongSnapshot(opts.snapshotText)
  const locationData: PdfLocation = { kind: 'pdf' }
  if (opts.page !== undefined) locationData.page = opts.page
  if (opts.bbox !== undefined) locationData.bbox = opts.bbox
  const hasAny = locationData.page !== undefined || locationData.bbox !== undefined
  return {
    type: 'pdf',
    snapshotText: opts.snapshotText,
    ...(hasAny ? { locationData } : {}),
    version: ANCHOR_VERSION,
  }
}

/**
 * 会话 Q&A 锚点：sessionId + messageUuid 是必填的精确定位手柄；
 * userMessageUuid / messageTimestamp 为可选元信息。
 */
export function buildConversationAnchor(opts: {
  snapshotText: string
  sessionId: string
  messageUuid: string
  userMessageUuid?: string
  messageTimestamp?: string
}): Anchor {
  warnIfLongSnapshot(opts.snapshotText)
  const locationData: ConversationLocation = {
    kind: 'conversation',
    sessionId: opts.sessionId,
    messageUuid: opts.messageUuid,
  }
  if (opts.userMessageUuid !== undefined) locationData.userMessageUuid = opts.userMessageUuid
  if (opts.messageTimestamp !== undefined) locationData.messageTimestamp = opts.messageTimestamp
  return {
    type: 'conversation',
    snapshotText: opts.snapshotText,
    locationData,
    version: ANCHOR_VERSION,
  }
}

function warnIfLongSnapshot(text: string): void {
  // SQLite TEXT 不收 size 费，但超过几 KB 一般是契约偏离（quote 不应这么长）
  if (text.length > SNAPSHOT_TEXT_WARN_BYTES) {
    console.warn(
      `[anchor-codec] snapshotText 长度 ${text.length} 超过 ${SNAPSHOT_TEXT_WARN_BYTES}；可能是契约偏离`,
    )
  }
}

// ============================================================================
// 序列化：Anchor → JSON string（snake_case，字段顺序固定）
// ============================================================================

/**
 * 把 Anchor 序列化成 DB 可存的 JSON 字符串。
 * 字段顺序固定为 type → snapshot_text → location_data → version，保证同输入
 * byte-exact 一致（dedup 友好）。
 */
export function serializeAnchor(anchor: Anchor): string {
  const obj: Record<string, unknown> = {
    type: anchor.type,
    snapshot_text: anchor.snapshotText,
  }
  if (anchor.locationData !== undefined) {
    obj.location_data = locationToSnakeCase(anchor.locationData)
  }
  obj.version = anchor.version ?? ANCHOR_VERSION
  return JSON.stringify(obj)
}

function locationToSnakeCase(loc: AnchorLocation): Record<string, unknown> {
  switch (loc.kind) {
    case 'html': {
      const out: Record<string, unknown> = { kind: 'html' }
      if (loc.selector !== undefined) out.selector = loc.selector
      if (loc.sectionId !== undefined) out.section_id = loc.sectionId
      if (loc.paragraphIndex !== undefined) out.paragraph_index = loc.paragraphIndex
      if (loc.citeIndex !== undefined) out.cite_index = loc.citeIndex
      return out
    }
    case 'md': {
      const out: Record<string, unknown> = { kind: 'md' }
      if (loc.byteOffset !== undefined) out.byte_offset = loc.byteOffset
      if (loc.lineNumber !== undefined) out.line_number = loc.lineNumber
      if (loc.paragraphIndex !== undefined) out.paragraph_index = loc.paragraphIndex
      return out
    }
    case 'pdf': {
      const out: Record<string, unknown> = { kind: 'pdf' }
      if (loc.page !== undefined) out.page = loc.page
      if (loc.bbox !== undefined) out.bbox = loc.bbox
      return out
    }
    case 'conversation': {
      const out: Record<string, unknown> = {
        kind: 'conversation',
        session_id: loc.sessionId,
        message_uuid: loc.messageUuid,
      }
      if (loc.userMessageUuid !== undefined) out.user_message_uuid = loc.userMessageUuid
      if (loc.messageTimestamp !== undefined) out.message_timestamp = loc.messageTimestamp
      return out
    }
  }
}

// ============================================================================
// 反序列化：DB JSON / 老字符串 → Anchor
// ============================================================================

/**
 * DB 列 → Anchor。容忍三种输入：
 *   1. 合法 Anchor JSON → 正常解析
 *   2. 老 / 异常字符串（pre-launch 之前手塞的简单 anchor）→ 兜底为
 *      `{ type: 'html', snapshotText: <raw>, version: 1 }`
 *   3. null / 空串 → null
 */
export function deserializeAnchor(raw: string | null | undefined): Anchor | null {
  if (raw == null) return null
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null

  // 兜底：非 JSON 起头 → 当作老字符串 anchor
  if (!trimmed.startsWith('{')) {
    return { type: 'html', snapshotText: raw, version: ANCHOR_VERSION }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    // JSON 解析失败也兜底
    return { type: 'html', snapshotText: raw, version: ANCHOR_VERSION }
  }

  if (!parsed || typeof parsed !== 'object') {
    return { type: 'html', snapshotText: raw, version: ANCHOR_VERSION }
  }

  const obj = parsed as Record<string, unknown>
  const type = obj.type
  const snapshotText = obj.snapshot_text
  if (
    typeof snapshotText !== 'string' ||
    (type !== 'html' && type !== 'md' && type !== 'pdf' && type !== 'conversation')
  ) {
    return { type: 'html', snapshotText: raw, version: ANCHOR_VERSION }
  }

  const anchor: Anchor = {
    type: type as AnchorType,
    snapshotText,
    version: typeof obj.version === 'number' ? obj.version : ANCHOR_VERSION,
  }

  const loc = obj.location_data
  if (loc && typeof loc === 'object') {
    const parsedLoc = locationFromSnakeCase(loc as Record<string, unknown>, type)
    if (parsedLoc) anchor.locationData = parsedLoc
  }

  return anchor
}

function locationFromSnakeCase(
  obj: Record<string, unknown>,
  expectedType: 'html' | 'md' | 'pdf' | 'conversation',
): AnchorLocation | null {
  const kind = obj.kind
  if (kind !== expectedType) {
    // type 与 kind 不一致 → 视为 location 不可用（snapshotText 仍有效）
    return null
  }
  switch (kind) {
    case 'html': {
      const loc: HtmlLocation = { kind: 'html' }
      if (typeof obj.selector === 'string') loc.selector = obj.selector
      if (typeof obj.section_id === 'string') loc.sectionId = obj.section_id
      if (typeof obj.paragraph_index === 'number') loc.paragraphIndex = obj.paragraph_index
      if (typeof obj.cite_index === 'number') loc.citeIndex = obj.cite_index
      return loc
    }
    case 'md': {
      const loc: MdLocation = { kind: 'md' }
      const byteOffset = obj.byte_offset
      if (
        byteOffset &&
        typeof byteOffset === 'object' &&
        'start' in byteOffset &&
        'end' in byteOffset &&
        typeof (byteOffset as { start: unknown }).start === 'number' &&
        typeof (byteOffset as { end: unknown }).end === 'number'
      ) {
        const bo = byteOffset as { start: number; end: number }
        loc.byteOffset = { start: bo.start, end: bo.end }
      }
      if (typeof obj.line_number === 'number') loc.lineNumber = obj.line_number
      if (typeof obj.paragraph_index === 'number') loc.paragraphIndex = obj.paragraph_index
      return loc
    }
    case 'pdf': {
      const loc: PdfLocation = { kind: 'pdf' }
      if (typeof obj.page === 'number') loc.page = obj.page
      const bbox = obj.bbox
      if (
        bbox &&
        typeof bbox === 'object' &&
        ['x', 'y', 'width', 'height'].every(
          (k) => typeof (bbox as Record<string, unknown>)[k] === 'number',
        )
      ) {
        const b = bbox as { x: number; y: number; width: number; height: number }
        loc.bbox = { x: b.x, y: b.y, width: b.width, height: b.height }
      }
      return loc
    }
    case 'conversation': {
      const sessionId = obj.session_id
      const messageUuid = obj.message_uuid
      if (typeof sessionId !== 'string' || typeof messageUuid !== 'string') return null
      const loc: ConversationLocation = {
        kind: 'conversation',
        sessionId,
        messageUuid,
      }
      if (typeof obj.user_message_uuid === 'string') loc.userMessageUuid = obj.user_message_uuid
      if (typeof obj.message_timestamp === 'string') loc.messageTimestamp = obj.message_timestamp
      return loc
    }
    default:
      return null
  }
}

// ============================================================================
// 内容 hash / 相等比较：dedup 用
// ============================================================================

/**
 * 基于 snapshotText 的内容指纹（sha256 前 16 hex）。
 * locationData 不参与 hash —— anchor 的"身份"就是 snapshotText。
 */
export function anchorContentHash(anchor: Anchor): string {
  return createHash('sha256').update(anchor.snapshotText).digest('hex').slice(0, 16)
}

/**
 * 两个 anchor 是不是同一份内容（按 snapshotText 比较，不看 location）。
 * 给上游做 dedup 用：locationData 不同但 snapshotText 相同 → 视为同一份。
 */
export function anchorsContentEqual(a: Anchor, b: Anchor): boolean {
  return a.snapshotText === b.snapshotText && a.type === b.type
}
