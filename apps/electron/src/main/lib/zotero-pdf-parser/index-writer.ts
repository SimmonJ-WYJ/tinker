/**
 * wiki/index.json 写入器
 *
 * 由 snapshot-store.updateSnapshot 串行写锁尾部调用：每次 snapshot 变动后
 * 把当前所有 record 折叠为消费友好的扁平索引，覆盖写到 wiki/index.json。
 *
 * 字段映射规则：
 *   - title: parent.title || rec.title || rec.filename
 *   - authors: 折叠 parent.creators 为 "Last, First" 字符串数组
 *   - year: 从 parent.date 抽前 4 位数字
 *   - 其他直接 1:1 映射，缺失为 null
 */

import { writeFileSync } from 'node:fs'
import type {
  ZoteroPdfParseStatus,
  ZoteroPdfRecord,
  ZoteroPdfWikiIndex,
  ZoteroPdfWikiIndexEntry,
  ZoteroParentItemInfo,
} from '@asci/shared'
import { nowIso } from '@asci/shared'
import { getZoteroWikiIndexPath } from '../config-paths'
import type { ZoteroPdfSnapshot } from './snapshot-store'

/**
 * 把 snapshot 中所有 record 折叠成 index 结构并覆盖写盘
 *
 * 同步实现，挂在 snapshot-store 的串行写链里，与 snapshot 写盘保持一致顺序。
 */
export function writeIndexFromSnapshot(snap: ZoteroPdfSnapshot): void {
  const entries = Object.values(snap.pdfs).map(toIndexEntry)

  // 稳定排序：先按 parentItemKey，再按 attachmentKey；便于 git diff 对比
  entries.sort((a, b) => {
    const pa = a.parentItemKey ?? ''
    const pb = b.parentItemKey ?? ''
    if (pa !== pb) return pa < pb ? -1 : 1
    return a.attachmentKey < b.attachmentKey ? -1 : 1
  })

  const byStatus = countByStatus(entries)
  const idx: ZoteroPdfWikiIndex = {
    schemaVersion: 1,
    generatedAt: nowIso(),
    total: entries.length,
    byStatus,
    entries,
  }

  writeFileSync(getZoteroWikiIndexPath(), JSON.stringify(idx, null, 2), 'utf-8')
}

function toIndexEntry(rec: ZoteroPdfRecord): ZoteroPdfWikiIndexEntry {
  const parent = rec.parent
  return {
    attachmentKey: rec.attachmentKey,
    parentItemKey: rec.parentItemKey,

    title: parent?.title || rec.title || rec.filename || rec.attachmentKey,
    authors: foldAuthors(parent),
    year: extractYear(parent?.date ?? null),
    doi: parent?.DOI ?? null,
    publicationTitle: parent?.publicationTitle ?? null,
    itemType: parent?.itemType ?? null,
    abstract: parent?.abstractNote ?? null,

    filename: rec.filename,
    linkMode: rec.linkMode,

    parseStatus: rec.parse?.status ?? 'pending',
    mdPath: rec.parse?.mdPath ?? null,
    parsedAt: rec.parse?.parsedAt ?? null,

    // article.md 段落总结增强；rec.article 为 null（v4 lazy）时全置 null
    articlePath: rec.article?.articlePath ?? null,
    articleStatus: rec.article?.status ?? null,
  }
}

/** 把 Zotero creators 折叠为 "Last, First" 字符串数组 */
function foldAuthors(parent: ZoteroParentItemInfo | null): string[] {
  if (!parent || !parent.creators) return []
  const out: string[] = []
  for (const c of parent.creators) {
    // 机构作者通常没 firstName/lastName，只有 name
    if (c.lastName || c.firstName) {
      const last = (c.lastName ?? '').trim()
      const first = (c.firstName ?? '').trim()
      if (last && first) out.push(`${last}, ${first}`)
      else if (last) out.push(last)
      else if (first) out.push(first)
    } else if (c.name) {
      out.push(c.name.trim())
    }
  }
  return out
}

/** 从原始 date 字符串里抽前 4 位数字作为年份 */
function extractYear(date: string | null): string | null {
  if (!date) return null
  const m = date.match(/\d{4}/)
  return m ? m[0] : null
}

function countByStatus(entries: ZoteroPdfWikiIndexEntry[]): Record<ZoteroPdfParseStatus, number> {
  const counts: Record<ZoteroPdfParseStatus, number> = {
    pending: 0,
    parsing: 0,
    completed: 0,
    failed: 0,
  }
  for (const e of entries) {
    counts[e.parseStatus] = (counts[e.parseStatus] ?? 0) + 1
  }
  return counts
}
