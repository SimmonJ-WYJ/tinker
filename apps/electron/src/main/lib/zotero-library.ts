/**
 * 主进程 Zotero 文献库数据服务
 *
 * 对应 V2 文献库 UI 的 5 个只读 IPC。每个函数调 Zotero 本地 HTTP API
 * 并用共享的 summarizer 做映射，返回精简后的 DTO。
 *
 * 所有错误 throw ZoteroError；IPC 层捕获后转结构化响应。
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { normalize, sep } from 'node:path'
import { fetchZotero } from './zotero-client/api-client.ts'
import { ZoteroError } from './zotero-client/errors.ts'
import { buildAttachmentPath, getZoteroDataDir } from './zotero-client/data-dir.ts'
import { isAttachmentItem } from '@asci/core/zotero'
import type { ZoteroItem, ZoteroCollection } from '@asci/core/zotero'
import {
  summarizeItem,
  detailItem,
  summarizeCollection,
} from '@asci/core/zotero'
import type {
  ItemSummary,
  ItemDetail,
  CollectionSummary,
  CachedPaperMeta,
  ZoteroGetItemResult,
  GetAttachmentPathResult,
} from '@asci/core/zotero'
import { getDb as getObjectsDb } from './objects/object-store.ts'
import { findPaperByZoteroKey } from './objects/repositories/paper-repository.ts'

// ===== 导出类型供 IPC 层使用 =====

export type {
  ItemSummary,
  ItemDetail,
  CollectionSummary,
  CachedPaperMeta,
  ZoteroGetItemResult,
  GetAttachmentPathResult,
}

// ===== 列出所有 collection =====

export async function listCollections(): Promise<CollectionSummary[]> {
  const raw = await fetchZotero<ZoteroCollection[]>('/users/0/collections?format=json')
  return raw.map(summarizeCollection)
}

// ===== 全文搜索 =====

export interface SearchItemsInput {
  query: string
  limit?: number
  offset?: number
}

export async function searchItems(input: SearchItemsInput): Promise<ItemSummary[]> {
  const limit = input.limit ?? 100
  const offset = input.offset ?? 0
  const params = new URLSearchParams({
    q: input.query,
    qmode: 'everything',
    limit: String(limit),
    start: String(offset),
    format: 'json',
  })
  const items = await fetchZotero<ZoteroItem[]>(`/users/0/items?${params.toString()}`)
  return items.filter(isListableItem).map(summarizeItem)
}

// ===== 获取 collection 内条目（或顶层全部条目）=====

export interface GetCollectionItemsInput {
  /** null 表示"所有条目"（Zotero 用户库顶层） */
  collectionKey: string | null
  limit?: number
  offset?: number
}

export async function getCollectionItems(input: GetCollectionItemsInput): Promise<ItemSummary[]> {
  const limit = input.limit ?? 100
  const offset = input.offset ?? 0
  const params = new URLSearchParams({
    limit: String(limit),
    start: String(offset),
    format: 'json',
  })
  // 两端都用 /top：只返回顶层条目（排除子附件、子笔记）
  const path = input.collectionKey === null
    ? `/users/0/items/top?${params.toString()}`
    : `/users/0/collections/${input.collectionKey}/items/top?${params.toString()}`
  const items = await fetchZotero<ZoteroItem[]>(path)
  // 再次过滤掉 standalone 的 attachment/note（用户库里可能存在不挂父条目的独立 PDF）
  return items.filter(isListableItem).map(summarizeItem)
}

/** 列表是否应展示：排除 attachment / note，只保留文献条目 */
function isListableItem(item: ZoteroItem): boolean {
  const type = item.data.itemType
  return type !== 'attachment' && type !== 'note'
}

// ===== 获取单条目详情 =====

export interface GetItemInput {
  itemKey: string
}

/**
 * 取单条目详情（issue #462：返回判别联合而非笼统 throw）。
 *
 *   - 命中 → { status: 'ok', detail }
 *   - Zotero 404（条目已删除）→ { status: 'deleted', cachedMeta }，
 *     cachedMeta 取本地 SQLite papers 行（即使 Zotero 已删，本地行仍刻意保留）；无则 null
 *   - 其它 ZoteroError（没在跑 / 连接被禁 / 端口冲突等）→ { status: 'error', errorType }
 *
 * 不再向上 throw —— 让右侧面板能据此渲染"源已删除"降级占位，区别于"加载失败请重试"。
 */
export async function getItem(input: GetItemInput): Promise<ZoteroGetItemResult> {
  try {
    const item = await fetchZotero<ZoteroItem>(`/users/0/items/${input.itemKey}?format=json`)
    return { status: 'ok', detail: detailItem(item) }
  } catch (err) {
    if (err instanceof ZoteroError && err.type === 'not_found') {
      return { status: 'deleted', cachedMeta: lookupCachedPaperMeta(input.itemKey) }
    }
    const errorType = err instanceof ZoteroError ? err.type : 'unexpected'
    return { status: 'error', errorType }
  }
}

/** 从本地 SQLite papers 行取已删除条目的缓存元数据；查不到 / DB 异常 → null。 */
function lookupCachedPaperMeta(zoteroKey: string): CachedPaperMeta | null {
  try {
    const paper = findPaperByZoteroKey(getObjectsDb(), zoteroKey)
    if (!paper) return null
    return {
      title: paper.title,
      authors: paper.authors,
      doi: paper.doi,
      url: paper.url,
      abstract: paper.abstract,
      venue: paper.venue,
      year: paper.year,
    }
  } catch (err) {
    console.warn('[zotero-library] getItem 删除分支取本地缓存元数据失败（降级为 null）:', err)
    return null
  }
}

// ===== 获取附件本地路径 =====

export interface GetAttachmentPathInput {
  itemKey: string
}

export async function getAttachmentPath(input: GetAttachmentPathInput): Promise<GetAttachmentPathResult> {
  const children = await fetchZotero<ZoteroItem[]>(`/users/0/items/${input.itemKey}/children?format=json`)
  const attachments = children.filter(isAttachmentItem)
  if (attachments.length === 0) return { found: false }

  // 优先取 imported PDF（imported_file / imported_url）
  const pdf = attachments.find((a) =>
    a.data.contentType === 'application/pdf'
    && (a.data.linkMode === 'imported_file' || a.data.linkMode === 'imported_url'),
  )
  if (!pdf) return { found: false, reason: 'unsupported_type' }

  return {
    found: true,
    path: buildAttachmentPath(pdf.key, pdf.data.filename),
    filename: pdf.data.filename,
    contentType: pdf.data.contentType,
  }
}

// ===== 读取 Zotero PDF 为 base64（供 @ mention 附挂用） =====

export interface ReadPdfAsBase64Input {
  /** PDF 绝对路径（必须在 <ZOTERO_DATA_DIR>/storage/ 下） */
  path: string
}

export function readPdfAsBase64(input: ReadPdfAsBase64Input): string {
  if (!existsSync(input.path)) {
    throw new Error(`文件不存在: ${input.path}`)
  }
  const resolved = realpathSync(input.path)
  const storageRoot = realpathSync(normalize(getZoteroDataDir()) + sep + 'storage') + sep
  if (!resolved.startsWith(storageRoot)) {
    throw new Error(`路径不在 Zotero 数据目录: ${input.path}`)
  }
  return readFileSync(resolved).toString('base64')
}
