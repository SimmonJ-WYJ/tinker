/**
 * 工作区论文副作用动作（ipc + MCP server 共用）
 *
 * 这些动作有外部副作用（写 Zotero / 下 PDF / 创建笔记），集中于此模块，
 * 便于 ipc handler 和内置 MCP server（T17）共享同一份实现。
 * 本文件目前只实现 performLinkZotero；T15 追加 performDownloadPdf；
 * T16 追加 performCreateNote。
 */

import type { LinkZoteroOpts, LinkZoteroResult, WorkspacePaperEntry } from '@asci/shared'
import { createItem } from './zotero-write.ts'
import * as workspacePaperStore from './workspace-paper-store'
import { emitPapersChanged } from './workspace-paper-events'

export type { LinkZoteroOpts }

interface CreatorName {
  firstName?: string
  lastName?: string
  name?: string
}

/** 把姓名拆分为 firstName + lastName（最后一个空格为分割点） */
function splitName(full: string): CreatorName {
  const trimmed = full.trim()
  const lastSpace = trimmed.lastIndexOf(' ')
  if (lastSpace > 0) {
    return { firstName: trimmed.slice(0, lastSpace), lastName: trimmed.slice(lastSpace + 1) }
  }
  return { name: trimmed }
}

/**
 * 把工作区论文条目关联到 Zotero：通过 Zotero local API 创建 item，
 * 成功后将返回的 item key 写回 linkedZoteroKey 字段，并广播 changed 事件。
 * 若 Zotero 未启动，createItem 会抛出错误，此处不捕获，由调用方处理。
 */
export async function performLinkZotero(
  slug: string,
  workspaceId: string,
  key: string,
  opts: LinkZoteroOpts,
): Promise<LinkZoteroResult> {
  const entry = workspacePaperStore.get(slug, key)
  if (!entry) throw new Error(`论文不存在：${key}`)

  // 注意：不检查 entry.linkedZoteroKey 是否已有值——
  // 若用户重复调用，会在 Zotero 中创建重复条目（UI 层应防抖避免）。
  // T17 MCP server 接入时若需幂等可在此处加 early return。

  const result = await createItem(
    {
      title: entry.title,
      creators: entry.authors.map((a) => ({ creatorType: 'author' as const, ...splitName(a) })),
      DOI: entry.doi,
      date: entry.year ? String(entry.year) : null,
      publicationTitle: entry.venue,
      url: entry.url,
      abstractNote: entry.abstract,
    },
    { tags: opts.tags, targetTreeViewID: opts.targetTreeViewID ?? null },
  )

  const updated = workspacePaperStore.update(slug, key, { linkedZoteroKey: result.key })
  emitPapersChanged(workspaceId, [key], 'update')
  return { entry: updated, pdfStatus: result.pdfStatus, collectionStatus: result.collectionStatus }
}
