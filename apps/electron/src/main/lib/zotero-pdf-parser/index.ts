/**
 * Zotero PDF 解析队列对外门面
 *
 * 单例 ParserQueue + 启动恢复 + diff 联动 + 状态查询。
 * 调用方（main/index.ts、ipc.ts、zotero-pdf-diff.ts）只看到这一层。
 */

import type {
  ZoteroPdfDiffResult,
  ZoteroPdfParseStatus,
  ZoteroPdfParseStatusSummary,
  ZoteroPdfRecord,
} from '@asci/shared'
import { toMs } from '@asci/shared'
import { loadSnapshot, updateRecordParse, makeDefaultParseState } from './snapshot-store'
import { ParserQueue, MAX_ATTEMPTS, MAX_CONCURRENT } from './queue'
import { runOne, cleanupMd } from './worker'

let queue: ParserQueue | null = null

/**
 * 启动 worker：扫描 snapshot 把所有"未完成 / 失败可重试"的 record 入队
 *
 * - status='parsing'：视为崩溃残留，重置为 pending 后入队
 * - status='pending'：直接入队
 * - status='failed' && attempts < MAX_ATTEMPTS：自动重试入队
 * - status='completed'：跳过
 */
export async function startZoteroPdfParserWorker(): Promise<void> {
  if (queue) {
    console.warn('[Zotero PDF Parser] worker 已在运行，忽略重复启动')
    return
  }
  queue = new ParserQueue(runOne)

  const snap = loadSnapshot()
  if (!snap) {
    console.log('[Zotero PDF Parser] 暂无 snapshot，worker 启动但空闲')
    return
  }

  // 重置 parsing 残留为 pending（持久化）
  const stuck: string[] = []
  for (const [key, rec] of Object.entries(snap.pdfs)) {
    if (rec.parse?.status === 'parsing') stuck.push(key)
  }
  if (stuck.length > 0) {
    console.log(`[Zotero PDF Parser] 发现 ${stuck.length} 条 'parsing' 残留，重置为 pending`)
    for (const key of stuck) {
      await updateRecordParse(key, { status: 'pending' })
    }
  }

  const enqueued = enqueuePendingFromSnapshot()
  if (enqueued > 0) {
    console.log(`[Zotero PDF Parser] worker 启动：入队 ${enqueued} 个待解析 PDF（并发 ${MAX_CONCURRENT}）`)
  } else {
    console.log('[Zotero PDF Parser] worker 启动：所有 PDF 已解析完成')
  }
}

/**
 * 扫 snapshot 把所有"未完成 / 失败可重试"的 record 入队。
 *
 * 用于两个时机：
 *   1. worker 启动时（startZoteroPdfParserWorker）
 *   2. 任意 diff 完成后兜底（applyDiffResult 末尾）—— 如果某次会话因
 *      diff 早于 worker 启动等竞态导致 pending 没入队，下次任意 diff
 *      触发都能自动捞回，避免"必须重启 ASCI 才能补救 stranded pending"。
 *
 * queue 内部 enqueue 对已 running / 已 pending 的 key 自动去重，重复调用是 idempotent 的。
 */
function enqueuePendingFromSnapshot(): number {
  if (!queue) return 0
  const snap = loadSnapshot()
  if (!snap) return 0
  const keys: string[] = []
  for (const [key, rec] of Object.entries(snap.pdfs)) {
    const p = rec.parse
    if (!p) continue
    if (p.status === 'pending') {
      keys.push(key)
    } else if (p.status === 'failed' && p.attempts < MAX_ATTEMPTS) {
      keys.push(key)
    }
  }
  if (keys.length > 0) queue.enqueueMany(keys)
  return keys.length
}

/**
 * 优雅停止 worker（in-flight 任务自然完成，但不再启动新任务）
 */
export function stopZoteroPdfParserWorker(): void {
  if (!queue) return
  queue.stop()
  console.log('[Zotero PDF Parser] worker 已停止')
  queue = null
}

/**
 * 由 zotero-pdf-diff 在 diff 完成后调用
 *
 * - added：新 record 入队
 * - modified：parse 状态已被 diff 重置为 pending，入队重解析
 * - deleted：清理对应 .md 文件（snapshot 移除已经在 diff 内做了）
 *
 * 末尾会再扫一遍 snapshot 把所有 stranded `pending` / 可重试 `failed` 入队。
 * 这是兜底：如果某次会话里 diff 早于 worker 启动跑完 first-baseline，新写
 * 入的 pending 会被 stranded，之后没有 added/modified 也不会自动入队 ——
 * 现在只要任何 diff 触发（focus / activate / heartbeat / manual），都会自愈。
 * queue 内部对 running / pending 中的 key 自动去重，重复调安全。
 */
export function applyDiffResult(result: ZoteroPdfDiffResult): void {
  if (!queue) {
    console.warn('[Zotero PDF Parser] queue 未启动，跳过 applyDiffResult')
    return
  }
  if (result.status === 'diff' || result.status === 'first-baseline') {
    const addKeys = result.added.map(r => r.attachmentKey)
    const modKeys = result.modified.map(m => m.now.attachmentKey)
    if (addKeys.length + modKeys.length > 0) {
      queue.enqueueMany([...addKeys, ...modKeys])
    }
    for (const r of result.deleted) {
      cleanupMd(r.attachmentKey)
    }
  }

  const swept = enqueuePendingFromSnapshot()
  if (swept > 0) {
    console.log(`[Zotero PDF Parser] diff 后兜底扫描：入队 ${swept} 个待解析 PDF`)
  }
}

/**
 * 拉取队列状态摘要（IPC handler 调用）
 */
export function getParseStatusSummary(): ZoteroPdfParseStatusSummary {
  const snap = loadSnapshot()
  const byStatus: Record<ZoteroPdfParseStatus, number> = {
    pending: 0,
    parsing: 0,
    completed: 0,
    failed: 0,
  }
  const failedRecords: Array<{ rec: ZoteroPdfRecord; parsedAt: string | null }> = []

  if (snap) {
    for (const rec of Object.values(snap.pdfs)) {
      const status = rec.parse?.status ?? 'pending'
      byStatus[status] = (byStatus[status] ?? 0) + 1
      if (status === 'failed') {
        failedRecords.push({ rec, parsedAt: rec.parse?.parsedAt ?? null })
      }
    }
  }

  // 取最近 5 条失败：parsedAt 排序（null 视为最近）
  failedRecords.sort((a, b) => {
    const ta = a.parsedAt ? toMs(a.parsedAt) : Number.POSITIVE_INFINITY
    const tb = b.parsedAt ? toMs(b.parsedAt) : Number.POSITIVE_INFINITY
    return tb - ta
  })
  const recentFailed = failedRecords.slice(0, 5).map(({ rec }) => ({
    attachmentKey: rec.attachmentKey,
    title: rec.title,
    filename: rec.filename,
    error: rec.parse?.error ?? '',
    attempts: rec.parse?.attempts ?? 0,
  }))

  return {
    total: snap ? Object.keys(snap.pdfs).length : 0,
    byStatus,
    runningKeys: queue?.getRunningKeys() ?? [],
    recentFailed,
  }
}

export { makeDefaultParseState }
