/**
 * Zotero PDF 被动 diff
 *
 * 通过 Zotero HTTP API 全量拉 PDF 类 attachment 元数据，与
 * ~/.asci/zotero/zotero-pdf-snapshot.json 中保存的上次快照对比，
 * 把 added / modified / deleted 打印到主进程 console，并覆盖快照。
 *
 * 触发场景：本函数为纯 diff 实现，不直接被 main/ipc 调用；所有触发都过
 *   lib/zotero-pdf-trigger.ts 的 triggerZoteroPdfDiff(reason) 统一入口
 *   （reason: startup / activate / focus / heartbeat / manual），由 trigger 层
 *   做防重入、节流（基于 zotero.sqlite mtime）和日志。
 *
 * 修改判定：本地 Zotero 库（local API）的 attachment.version 永远为 0，
 * 不能用作 dirty bit。改用 dateModified + filename + title + linkMode +
 * parentItemKey 多字段比对，任一变化即视为 modified。
 *
 * 范围：仅 contentType === 'application/pdf' 且 linkMode 为
 * 'imported_file' / 'imported_url' 的 attachment（与现有 zotero-mcp 一致）。
 *
 * v2 注意事项：每条 record 嵌套 parse 字段（解析状态）。diff 写新快照时通过
 * mergeParseStateFromPrev 保留旧的 parse 字段：
 *   - added：parse 重置为默认 pending
 *   - modified：parse 重置为 pending（保留 attempts 计数）
 *   - unchanged：原样保留 prev 的 parse
 * diff 完成后调用 parser.applyDiffResult 通知队列入队 / 清理 .md。
 */

import type { ZoteroPdfDiffResult, ZoteroPdfRecord, ZoteroParentItemInfo } from '@asci/shared'
import { nowIso, ZOTERO_LOCAL_HOST } from '@asci/shared'
import { fetchZotero, pingZotero } from './zotero-client/api-client.ts'
import { ZoteroError } from './zotero-client/errors.ts'
import { getZoteroPdfSnapshotPath } from './config-paths'
import {
  loadSnapshot,
  replaceSnapshot,
  makeDefaultParseState,
  type ZoteroPdfSnapshot,
} from './zotero-pdf-parser/snapshot-store'
import { applyDiffResult as parserApplyDiffResult } from './zotero-pdf-parser/index'
import { applySnapshotToPapers } from './zotero-paper-sync'
import { reconcileWorkspaceZoteroLinks } from './zotero-link-reconcile'
import { getDb } from './objects/object-store'

/** Zotero items API 单页大小 */
const PAGE_LIMIT = 100

/** 父条目批量拉取每批 itemKey 数量（URL 长度安全 + 单次请求合理） */
const PARENT_BATCH = 50

/**
 * Zotero attachment item 的 API 返回结构（仅取我们关心的字段）
 *
 * 完整定义见 https://www.zotero.org/support/dev/web_api/v3/types_and_fields
 */
interface ZoteroAttachmentItem {
  key: string
  version: number
  data: {
    key: string
    version: number
    itemType: string
    parentItem?: string
    /** 'imported_file' | 'imported_url' | 'linked_file' | 'linked_url' */
    linkMode: string
    contentType?: string
    filename?: string
    title?: string
    dateModified?: string
  }
}

/**
 * Zotero 父条目（非 attachment）的 API 返回结构（仅取我们关心的字段）
 */
interface ZoteroParentItem {
  key: string
  version: number
  data: {
    key: string
    itemType: string
    title?: string
    creators?: Array<{
      firstName?: string
      lastName?: string
      name?: string
      creatorType: string
    }>
    date?: string
    DOI?: string
    url?: string
    abstractNote?: string
    publicationTitle?: string
  }
}

/**
 * 主入口：执行一次 Zotero PDF 被动 diff
 *
 * 不抛错；所有错误均反映为 status === 'error' 或 'skipped-zotero-offline' 返回值，
 * 同时在 console 打印日志。
 */
export async function runZoteroPdfDiff(): Promise<ZoteroPdfDiffResult> {
  console.log('========== [Zotero PDF Diff] 开始扫描 ==========')

  // 1. 探活：Zotero 不在跑则跳过，不写新快照
  if (!(await pingZotero())) {
    console.warn(`[Zotero PDF Diff] Zotero 未运行（${ZOTERO_LOCAL_HOST} 不可达），跳过本次 diff`)
    return {
      status: 'skipped-zotero-offline',
      total: 0,
      added: [],
      modified: [],
      deleted: [],
    }
  }

  // 2. 全量分页拉 attachment + 客户端过滤 PDF
  let nowMap: Map<string, ZoteroPdfRecord>
  try {
    nowMap = await fetchAllPdfAttachments()
  } catch (err) {
    const msg = err instanceof ZoteroError ? err.message : String(err)
    console.error('[Zotero PDF Diff] 拉取 attachment 失败:', msg)
    return { status: 'error', total: 0, added: [], modified: [], deleted: [], message: msg }
  }

  // 3. 批量拉父条目 metadata（含 abstract / authors / DOI 等），填到 record.parent
  // 失败仅打 warn，不阻塞 diff 流程（record.parent 留 null，下次 diff 重试）
  try {
    const parentKeys = new Set<string>()
    for (const rec of nowMap.values()) {
      if (rec.parentItemKey) parentKeys.add(rec.parentItemKey)
    }
    if (parentKeys.size > 0) {
      const parentMap = await fetchParentInfos(parentKeys)
      for (const rec of nowMap.values()) {
        if (rec.parentItemKey) {
          rec.parent = parentMap.get(rec.parentItemKey) ?? null
        }
      }
      console.log(`[Zotero PDF Diff] 已拉取 ${parentMap.size}/${parentKeys.size} 个父条目 metadata`)
    }
  } catch (err) {
    console.warn('[Zotero PDF Diff] 拉父条目失败（不阻塞 diff，record.parent 暂留 null）:', err)
  }

  // 4. 读上次快照（不存在 / 损坏 / 旧 schema 已自动迁移）
  const prev = loadSnapshot()
  const result = computeDiff(prev, nowMap)

  // 5. 把 prev 中的 parse 状态合并到 now（保留 unchanged，重置 added / modified）
  mergeParseStateFromPrev(prev, nowMap, result)

  // 6. 打印日志
  printDiffLog(result, prev?.capturedAt ?? null)

  // 7. 覆盖写新快照（走 snapshot-store 串行写锁，自动联动 wiki/index.json 重写）
  try {
    await replaceSnapshot({
      schemaVersion: 4,
      capturedAt: nowIso(),
      pdfs: Object.fromEntries(nowMap),
    })
    console.log('[Zotero PDF Diff] 快照已更新:', getZoteroPdfSnapshotPath())
  } catch (err) {
    const msg = String(err)
    console.error('[Zotero PDF Diff] 写入快照失败:', msg)
    return { ...result, status: 'error', message: msg }
  }

  // 8. 通知 parser 队列：added/modified 入队，deleted 清理 .md
  parserApplyDiffResult(result)

  // 9. 管道 B：全量把 snapshot 同步进 papers 表（不是 diff，是 reconcile）
  //    每次 diff 都跑一次全量幂等同步：保证 papers ⊇ snapshot，
  //    覆盖 first-baseline / 应用更新后已有 Zotero 库的回填等场景。
  //    失败仅 warn，不阻塞 diff 主路径。
  try {
    const allRecords = Array.from(nowMap.values())
    const sync = applySnapshotToPapers(getDb(), allRecords)
    if (sync.created > 0 || sync.updated > 0) {
      console.log(
        `[Zotero PDF Diff] papers 表全量 reconcile：total=${allRecords.length}, created=${sync.created}, updated=${sync.updated}, skipped=${sync.skipped}`,
      )
    }
  } catch (err) {
    console.warn('[Zotero PDF Diff] 同步 papers 表失败（不阻塞主路径）:', err)
  }

  // 10. Zotero link 对账（#461）：清掉各工作区 papers.jsonl 里指向「已删 Zotero 条目」
  //     的 stale linkedZoteroKey。linkedZoteroKey 是父条目 key，PDF diff 的 deleted[]
  //     只覆盖有 PDF 附件的删除（且会误伤只删附件保留条目），故此处独立按 key 反查
  //     Zotero 存在性，完整且无误伤。失败仅 warn，不阻塞 diff 主路径。
  try {
    const { cleared } = await reconcileWorkspaceZoteroLinks()
    if (cleared > 0) {
      console.log(`[Zotero PDF Diff] Zotero link 对账：清理 ${cleared} 条 stale linkedZoteroKey`)
    }
  } catch (err) {
    console.warn('[Zotero PDF Diff] Zotero link 对账失败（不阻塞主路径）:', err)
  }

  return result
}

/**
 * 分页拉取所有 attachment item，过滤出 PDF 类附件后塞进 Map（key = attachmentKey）
 *
 * 返回的 record 暂时填默认 parse 字段，后续 mergeParseStateFromPrev 会按 diff 结果调整。
 */
async function fetchAllPdfAttachments(): Promise<Map<string, ZoteroPdfRecord>> {
  const map = new Map<string, ZoteroPdfRecord>()
  let start = 0
  while (true) {
    const page = await fetchZotero<ZoteroAttachmentItem[]>(
      `/users/0/items?itemType=attachment&format=json&limit=${PAGE_LIMIT}&start=${start}`,
    )
    for (const it of page) {
      const d = it.data
      if (d.contentType !== 'application/pdf') continue
      if (d.linkMode !== 'imported_file' && d.linkMode !== 'imported_url') continue
      map.set(d.key, {
        attachmentKey: d.key,
        parentItemKey: d.parentItem ?? null,
        version: d.version,
        linkMode: d.linkMode,
        contentType: d.contentType,
        filename: d.filename ?? '',
        title: d.title ?? '',
        dateModified: d.dateModified ?? null,
        parse: makeDefaultParseState(),
        parent: null,  // 后续 fetchParentInfos 填充
        article: null,  // v4：lazy 实例化，由 article worker 启动扫描时按需创建
      })
    }
    if (page.length < PAGE_LIMIT) break
    start += PAGE_LIMIT
  }
  return map
}

/**
 * 批量拉取父条目 metadata
 *
 * Zotero API 支持 `?itemKey=K1,K2,...` 一次拿多个。每批 PARENT_BATCH 个，
 * 任意一批失败仅影响该批，其他批继续；返回成功拉到的 Map（缺失的 key 视为父条目无 / 未公开）。
 */
async function fetchParentInfos(parentKeys: Set<string>): Promise<Map<string, ZoteroParentItemInfo>> {
  const out = new Map<string, ZoteroParentItemInfo>()
  const keys = [...parentKeys].filter(k => k && k.length > 0)
  for (let i = 0; i < keys.length; i += PARENT_BATCH) {
    const batch = keys.slice(i, i + PARENT_BATCH).join(',')
    try {
      const items = await fetchZotero<ZoteroParentItem[]>(
        `/users/0/items?itemKey=${batch}&format=json`,
      )
      for (const it of items) {
        out.set(it.key, mapToParentInfo(it))
      }
    } catch (err) {
      console.warn(`[Zotero PDF Diff] 父条目批次拉取失败（offset=${i}）:`, err)
    }
  }
  return out
}

function mapToParentInfo(it: ZoteroParentItem): ZoteroParentItemInfo {
  const d = it.data
  return {
    itemKey: it.key,
    itemType: d.itemType,
    title: d.title ?? null,
    creators: d.creators ?? [],
    date: d.date ?? null,
    DOI: d.DOI ?? null,
    url: d.url ?? null,
    abstractNote: d.abstractNote ?? null,
    publicationTitle: d.publicationTitle ?? null,
  }
}

/**
 * 与上次快照比对：以 attachmentKey 为主键三向 diff，metadata 字段任一不同视为 modified
 */
function computeDiff(
  prev: ZoteroPdfSnapshot | null,
  now: Map<string, ZoteroPdfRecord>,
): ZoteroPdfDiffResult {
  if (!prev) {
    return {
      status: 'first-baseline',
      total: now.size,
      added: [],
      modified: [],
      deleted: [],
    }
  }

  const added: ZoteroPdfRecord[] = []
  const modified: Array<{ prev: ZoteroPdfRecord; now: ZoteroPdfRecord }> = []
  const deleted: ZoteroPdfRecord[] = []

  for (const [key, rec] of now) {
    const old = prev.pdfs[key]
    if (!old) added.push(rec)
    else if (hasMetadataChanged(old, rec)) modified.push({ prev: old, now: rec })
  }
  for (const key of Object.keys(prev.pdfs)) {
    if (!now.has(key)) deleted.push(prev.pdfs[key]!)
  }

  return { status: 'diff', total: now.size, added, modified, deleted }
}

/**
 * 把 prev 中的 parse 状态合并到 now（按 diff 结果决定保留 / 重置）
 *
 * - added 或 prev 不存在：parse 已是默认 pending，无需动
 * - modified：重置为 pending，但保留 attempts 计数（避免错误条目无限重试）
 * - unchanged（在 prev 但既非 added 也非 modified）：完全保留 prev 的 parse
 *
 * 首次扫描（prev=null / first-baseline）：不做合并，全部用默认 pending（已在 fetch 时填）
 */
function mergeParseStateFromPrev(
  prev: ZoteroPdfSnapshot | null,
  now: Map<string, ZoteroPdfRecord>,
  result: ZoteroPdfDiffResult,
): void {
  if (!prev || result.status !== 'diff') return

  const modifiedKeys = new Set(result.modified.map(m => m.now.attachmentKey))
  const addedKeys = new Set(result.added.map(r => r.attachmentKey))

  for (const [key, rec] of now) {
    if (addedKeys.has(key)) {
      // 新增：保持默认 pending
      continue
    }
    const prevRec = prev.pdfs[key]
    if (!prevRec) continue

    // parse 字段
    if (modifiedKeys.has(key)) {
      // 重置为 pending，但保留尝试次数（防止重命名循环触发的失败重试）
      rec.parse = {
        ...makeDefaultParseState(),
        attempts: prevRec.parse?.attempts ?? 0,
      }
    } else {
      // unchanged：完全保留 prev 的解析状态
      rec.parse = prevRec.parse ?? makeDefaultParseState()
    }

    // parent 兜底：本次拉父条目失败时用 prev 已有的 metadata
    if (rec.parent === null && prevRec.parent) {
      rec.parent = prevRec.parent
    }

    // article 字段：unchanged / modified 都保留 prev（modified 会因 md mtime 变化在 article
    // worker 那边自动重新入队；保留可避免丢掉 articleCreated 等首次生成时间）
    rec.article = prevRec.article ?? null
  }
}

/**
 * 判断两条快照记录是否有实质变化（仅看 metadata，不看 parse）
 *
 * 因 local API 的 version 恒为 0，改用 metadata 多字段比对：
 * - dateModified：用户加标注 / 改 metadata 后，Zotero 会更新此字段
 * - filename / title：重命名
 * - linkMode：从 imported_file 切换为 linked_file 等
 * - parentItemKey：附件被移到别的父条目下
 */
function hasMetadataChanged(a: ZoteroPdfRecord, b: ZoteroPdfRecord): boolean {
  return (
    a.dateModified !== b.dateModified ||
    a.filename !== b.filename ||
    a.title !== b.title ||
    a.linkMode !== b.linkMode ||
    a.parentItemKey !== b.parentItemKey
  )
}

/** 把变化原因总结成一行便于日志阅读 */
function describeChange(a: ZoteroPdfRecord, b: ZoteroPdfRecord): string {
  const reasons: string[] = []
  if (a.dateModified !== b.dateModified) reasons.push(`dateModified ${a.dateModified ?? 'null'} → ${b.dateModified ?? 'null'}`)
  if (a.filename !== b.filename) reasons.push(`filename "${a.filename}" → "${b.filename}"`)
  if (a.title !== b.title) reasons.push(`title "${a.title}" → "${b.title}"`)
  if (a.linkMode !== b.linkMode) reasons.push(`linkMode ${a.linkMode} → ${b.linkMode}`)
  if (a.parentItemKey !== b.parentItemKey) reasons.push(`parent ${a.parentItemKey ?? 'none'} → ${b.parentItemKey ?? 'none'}`)
  return reasons.join('; ')
}

/**
 * 把 diff 结果按统一格式打印到 console
 */
function printDiffLog(result: ZoteroPdfDiffResult, prevCapturedAt: string | null): void {
  if (result.status === 'first-baseline') {
    console.log(`[Zotero PDF Diff] 首次扫描，建立基线快照（${result.total} 个 PDF）`)
    return
  }
  if (result.status !== 'diff') return

  console.log(`[Zotero PDF Diff] 与上次快照对比 (上次: ${prevCapturedAt ?? 'unknown'})`)
  console.log(
    `[Zotero PDF Diff]   总数: ${result.total}, added=${result.added.length}, modified=${result.modified.length}, deleted=${result.deleted.length}`,
  )
  for (const r of result.added) {
    console.log(`[Zotero PDF Diff]   + added:    ${r.attachmentKey} "${r.title || r.filename}" (parent=${r.parentItemKey ?? 'none'})`)
  }
  for (const m of result.modified) {
    const reason = describeChange(m.prev, m.now)
    console.log(
      `[Zotero PDF Diff]   ~ modified: ${m.now.attachmentKey} "${m.now.title || m.now.filename}" (${reason})`,
    )
  }
  for (const r of result.deleted) {
    console.log(`[Zotero PDF Diff]   - deleted:  ${r.attachmentKey} "${r.title || r.filename}"`)
  }
}
