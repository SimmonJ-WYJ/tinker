/**
 * Zotero Web API v3 响应类型（本地 API 复用同一协议）
 *
 * 只保留 ASCI V1 需要消费的字段。完整 schema 见
 * https://www.zotero.org/support/dev/web_api/v3/types_and_fields
 */

export interface ZoteroCreator {
  creatorType: string
  firstName?: string
  lastName?: string
  name?: string
}

export interface ZoteroItemData {
  itemType: string
  title?: string
  creators?: ZoteroCreator[]
  date?: string
  tags?: Array<{ tag: string; type?: number }>
  collections?: string[]
  abstractNote?: string
  DOI?: string
  url?: string
  /** 附件专用字段 */
  filename?: string
  contentType?: string
  linkMode?: 'imported_file' | 'imported_url' | 'linked_file' | 'linked_url'
  md5?: string
  [key: string]: unknown
}

export interface ZoteroItem {
  key: string
  version: number
  data: ZoteroItemData
}

/** 附件子 item（linkMode + 文件信息齐全） */
export interface ZoteroAttachment extends ZoteroItem {
  data: ZoteroItemData & {
    itemType: 'attachment'
    filename: string
    contentType: string
    linkMode: NonNullable<ZoteroItemData['linkMode']>
  }
}

export interface ZoteroCollection {
  key: string
  version: number
  data: {
    name: string
    parentCollection: string | false
  }
}

export function isZoteroItem(value: unknown): value is ZoteroItem {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (typeof v.key !== 'string') return false
  if (typeof v.version !== 'number') return false
  if (typeof v.data !== 'object' || v.data === null) return false
  const data = v.data as Record<string, unknown>
  return typeof data.itemType === 'string'
}

const VALID_LINK_MODES: ReadonlySet<string> = new Set([
  'imported_file',
  'imported_url',
  'linked_file',
  'linked_url',
])

export function isAttachmentItem(item: ZoteroItem): item is ZoteroAttachment {
  return item.data.itemType === 'attachment'
    && typeof item.data.filename === 'string'
    && typeof item.data.contentType === 'string'
    && typeof item.data.linkMode === 'string'
    && VALID_LINK_MODES.has(item.data.linkMode)
}
