/**
 * Zotero 映射结果类型与纯映射函数
 *
 * 这些类型是给 API 消费者（MCP tools / main-side library service / UI）共用的，
 * 基于 ZoteroItem / ZoteroCollection 的精简/投影。
 * 不包含任何 IO 或副作用。
 */

import { sanitizeText } from '@asci/shared'
import type { ZoteroItem, ZoteroCollection, ZoteroCreator } from './types.ts'

// ===== 类型 =====

export interface ItemSummary {
  key: string
  title: string
  creators: string[]
  date?: string
  tags: string[]
  collections: string[]
}

export interface ItemDetail {
  key: string
  itemType: string
  title: string
  creators: string[]
  date?: string
  tags: string[]
  collections: string[]
  abstract?: string
  doi?: string
  url?: string
  /** 期刊名 / 会议名 / 丛书名 — 取第一个非空（详情页顶栏 "venue" 字段） */
  venue?: string
  /** arXiv 编号（如 "2005.11401"），从 URL / DOI / extra 字段抽取；非 arXiv 论文为 undefined */
  arxivId?: string
}

export interface CollectionSummary {
  key: string
  name: string
  /** 父 collection key；null 表示顶级 */
  parentKey: string | null
}

/**
 * 已删除 Zotero 条目的本地缓存元数据（issue #462）。
 *
 * paper 在 Zotero 被删除后，本地 SQLite `papers` 行仍刻意保留（避免 evidence_refs 悬空），
 * 仍可读出标题 / 作者 / DOI 等。右侧面板用它渲染"源已删除"降级占位，而不是空白。
 * 字段是 ItemDetail 的子集，按需可空。
 */
export interface CachedPaperMeta {
  title: string
  authors: string[]
  doi?: string
  url?: string
  abstract?: string
  venue?: string
  year?: number
}

/**
 * `getItem` 的判别联合返回（issue #462）。
 *
 * 替代原"成功返 ItemDetail / 失败统一 throw"——让渲染端能精确区分三态：
 *   - `ok`：Zotero 条目仍在，正常渲染详情；
 *   - `deleted`：Zotero 返回 404（条目已删除）；带本地缓存元数据（缺失则 null），
 *     渲染"源已删除"降级占位 + 降级动作，而非空白/误导性的"加载失败请重试"；
 *   - `error`：Zotero 没在跑 / 连接被禁 / 端口冲突等其它故障；保留"请重试"语义。
 *     errorType 取 ZoteroError.type 字符串（如 'zotero_not_running' / 'unexpected'）。
 */
export type ZoteroGetItemResult =
  | { status: 'ok'; detail: ItemDetail }
  | { status: 'deleted'; cachedMeta: CachedPaperMeta | null }
  | { status: 'error'; errorType: string }

export type GetAttachmentPathReason =
  | 'unsupported_type'
  | 'not_found'
  | 'linked_file_path_missing'
  | 'linked_file_base_dir_unset'
  | 'linked_url_no_file'

export type GetAttachmentPathResult =
  | { found: true; path: string; filename: string; contentType: string }
  | { found: false; reason?: GetAttachmentPathReason }

// ===== 纯映射函数 =====

/**
 * 把 ZoteroCreator 格式化为显示字符串
 *
 * 优先使用 name（团体作者），否则拼 firstName + lastName。
 * 若全部字段为空返回空串（调用方通常 filter(Boolean) 过滤掉）。
 */
export function creatorDisplayName(creator: ZoteroCreator): string {
  if (creator.name) return creator.name
  return [creator.firstName, creator.lastName].filter(Boolean).join(' ').trim()
}

/** ZoteroItem → ItemSummary（列表用） */
export function summarizeItem(item: ZoteroItem): ItemSummary {
  const d = item.data
  return {
    key: item.key,
    title: sanitizeText(d.title) || '(无标题)',
    creators: (d.creators ?? []).map(creatorDisplayName).filter(Boolean),
    date: d.date,
    tags: (d.tags ?? []).map((t) => t.tag),
    collections: d.collections ?? [],
  }
}

/** ZoteroItem → ItemDetail（详情用） */
export function detailItem(item: ZoteroItem): ItemDetail {
  const d = item.data
  // venue：按 Zotero item 类型挑第一个非空标题字段
  const venue =
    (d['publicationTitle'] as string | undefined) ||
    (d['proceedingsTitle'] as string | undefined) ||
    (d['bookTitle'] as string | undefined) ||
    (d['seriesTitle'] as string | undefined) ||
    (d['repository'] as string | undefined) ||
    undefined
  return {
    key: item.key,
    itemType: d.itemType,
    title: sanitizeText(d.title) || '(无标题)',
    creators: (d.creators ?? []).map(creatorDisplayName).filter(Boolean),
    date: d.date,
    tags: (d.tags ?? []).map((t) => t.tag),
    collections: d.collections ?? [],
    abstract: sanitizeText(d.abstractNote) || undefined,
    doi: d.DOI,
    url: d.url,
    venue: venue?.trim() || undefined,
    arxivId: extractArxivId(d.url, d.DOI, d['extra'] as string | undefined),
  }
}

/**
 * 从 URL / DOI / Zotero "extra" 字段抽取 arXiv 编号
 * - URL: https://arxiv.org/abs/2005.11401 / arxiv.org/pdf/2005.11401v2
 * - DOI: 10.48550/arXiv.2005.11401
 * - Extra: "arXiv: 2005.11401" 或 "arXiv:2005.11401"
 *
 * 返回不含 v 后缀的纯编号（如 "2005.11401"），失败返回 undefined
 */
export function extractArxivId(
  url?: string,
  doi?: string,
  extra?: string,
): string | undefined {
  const arxivIdPattern = /(\d{4}\.\d{4,5})(?:v\d+)?/
  if (url) {
    const m = url.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/i)
    if (m) return m[1]
  }
  if (doi) {
    const m = doi.match(/arxiv\.(\d{4}\.\d{4,5})/i)
    if (m) return m[1]
  }
  if (extra) {
    const m = extra.match(/arxiv[:\s]+(\d{4}\.\d{4,5})/i)
    if (m) return m[1]
  }
  // 老格式 arXiv ID（如 "cs/0506075"）暂不支持
  void arxivIdPattern
  return undefined
}

/** ZoteroCollection → CollectionSummary */
export function summarizeCollection(collection: ZoteroCollection): CollectionSummary {
  return {
    key: collection.key,
    name: collection.data.name,
    parentKey: collection.data.parentCollection === false ? null : collection.data.parentCollection,
  }
}
