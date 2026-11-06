/**
 * 段落总结增强（article 生成器）对外门面
 *
 * 单例 ArticleQueue + 启动恢复 + parser 联动钩子 + 状态查询 + IPC handler 入口。
 *
 * 关键不变量：
 *   - 只有 enabled 时才创建 queue 与入队
 *   - parser worker 写完 md 后调用 onMdReady(key, mtime) 推动入队
 *   - 启动扫描会把 prompt 升级 / md mtime 变化 / failed-with-attempts-left 的 record 入队
 */

import { existsSync, statSync } from 'node:fs'
import type {
  ZoteroArticleConfig,
  ZoteroPdfArticleStatus,
  ZoteroPdfArticleStatusSummary,
  ZoteroPdfRecord,
} from '@asci/shared'
import { toMs } from '@asci/shared'
import { loadArticleConfig, resetArticleConfigCache, saveArticleConfig } from './config'
import { ArticleQueue, MAX_ATTEMPTS } from './queue'
import { runOne } from './worker'
import { PROMPT_VERSION } from './prompt'
import {
  loadSnapshot,
  makeDefaultArticleState,
  updateRecordArticle,
} from '../zotero-pdf-parser/snapshot-store'
import { configureStatusBus } from './status-bus'

let queue: ArticleQueue | null = null
let statusListener: ((summary: ZoteroPdfArticleStatusSummary) => void) | null = null

/** 由 main/index.ts 在 parser worker 启动后调用 */
export async function startZoteroArticleGeneratorWorker(): Promise<void> {
  if (queue) {
    console.warn('[Zotero Article] worker 已在运行，忽略重复启动')
    return
  }

  const config = loadArticleConfig()
  if (!config.enabled) {
    console.log('[Zotero Article] 开关关闭，worker 不启动；snapshot 已有 article 状态保留不变')
    return
  }

  await ensureQueueWithEnqueueScan()
}

/**
 * parser worker 写完 md 后的钩子（仅 enabled 时由 parser 调用）
 *
 * mdMtimeMs 用于和 snapshot 中已有的 sourceMdMtimeMs 比对：相同则跳过（已是最新版本）。
 */
export function onMdReady(attachmentKey: string, mdMtimeMs: number): void {
  const config = loadArticleConfig()
  if (!config.enabled || !queue) return

  const snap = loadSnapshot()
  const rec = snap?.pdfs[attachmentKey]
  if (!rec || rec.parse?.status !== 'completed') return

  if (shouldEnqueue(rec, mdMtimeMs)) {
    queue.enqueue(attachmentKey)
    void emitStatusChanged()
  }
}

export function stopZoteroArticleGeneratorWorker(): void {
  if (!queue) return
  queue.stop()
  queue = null
  console.log('[Zotero Article] worker 已停止')
}

export function getArticleConfig(): ZoteroArticleConfig {
  return loadArticleConfig()
}

/**
 * 写入配置；若 enabled 切换需要做对应启停
 *
 * 切关：清 pending、停止 worker、把 snapshot 中所有非 completed 的 article 状态置 'skipped'
 *       （已 completed 的保留，不重置磁盘文件）
 * 切开：启动 worker 并扫描入队
 */
export async function setArticleConfig(
  patch: Partial<ZoteroArticleConfig>,
): Promise<ZoteroArticleConfig> {
  const before = loadArticleConfig().enabled
  const next = saveArticleConfig(patch)
  resetArticleConfigCache()

  if (before && !next.enabled) {
    if (queue) {
      queue.clearPending()
      queue.stop()
      queue = null
    }
    await markAllAsSkipped()
  } else if (!before && next.enabled) {
    await ensureQueueWithEnqueueScan()
  }

  void emitStatusChanged()
  return next
}

/** 把所有 failed 的 record 重置为 idle、attempts=0 并入队（IPC retry-all 入口） */
export async function retryAllFailed(): Promise<number> {
  const config = loadArticleConfig()
  if (!config.enabled) {
    console.log('[Zotero Article] retryAllFailed: 开关未开启，忽略')
    return 0
  }
  await ensureQueueWithEnqueueScan({ resetFailed: true })
  return queue?.getCounts().pending ?? 0
}

/**
 * 把所有 article 重置为 idle（含 completed）并全部入队，强制重新生成。
 *
 * 用户操作：换模型 / 改 prompt 后想立刻全量重跑而不等待 mtime 触发。
 * 已生成的 .article.md 不会被立即删除——worker 跑完后会覆盖。
 * 返回入队数量（不含 in-flight）。
 */
export async function regenerateAll(): Promise<number> {
  const config = loadArticleConfig()
  if (!config.enabled) {
    console.log('[Zotero Article] regenerateAll: 开关未开启，忽略')
    return 0
  }
  const snap = loadSnapshot()
  if (!snap) return 0

  const tasks: Array<Promise<void>> = []
  for (const [key, rec] of Object.entries(snap.pdfs)) {
    if (rec.parse?.status !== 'completed' || !rec.parse.mdPath) continue
    tasks.push(updateRecordArticle(key, makeDefaultArticleState()))
  }
  await Promise.all(tasks)
  console.log(`[Zotero Article] regenerateAll: 已重置 ${tasks.length} 条 article 状态`)

  await ensureQueueWithEnqueueScan()
  return queue?.getCounts().pending ?? 0
}

export function getStatusSummary(): ZoteroPdfArticleStatusSummary {
  const config = loadArticleConfig()
  const snap = loadSnapshot()
  const byStatus: Record<ZoteroPdfArticleStatus, number> = {
    idle: 0,
    pending: 0,
    generating: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
  }
  let total = 0
  const failedRecords: Array<{ rec: ZoteroPdfRecord; generatedAt: string | null }> = []

  if (snap) {
    for (const rec of Object.values(snap.pdfs)) {
      if (rec.parse?.status !== 'completed') continue
      total++
      const status = rec.article?.status ?? 'idle'
      byStatus[status] = (byStatus[status] ?? 0) + 1
      if (status === 'failed') {
        failedRecords.push({ rec, generatedAt: rec.article?.generatedAt ?? null })
      }
    }
  }

  failedRecords.sort((a, b) => {
    const ta = a.generatedAt ? toMs(a.generatedAt) : Number.POSITIVE_INFINITY
    const tb = b.generatedAt ? toMs(b.generatedAt) : Number.POSITIVE_INFINITY
    return tb - ta
  })
  const recentFailed = failedRecords.slice(0, 5).map(({ rec }) => ({
    attachmentKey: rec.attachmentKey,
    title: rec.title,
    filename: rec.filename,
    error: rec.article?.error ?? '',
    attempts: rec.article?.attempts ?? 0,
  }))

  return {
    enabled: config.enabled,
    total,
    byStatus,
    runningKeys: queue?.getRunningKeys() ?? [],
    recentFailed,
  }
}

/** 注册状态变更监听（main IPC 用，主动 push 给 renderer） */
export function setStatusChangedListener(
  cb: ((summary: ZoteroPdfArticleStatusSummary) => void) | null,
): void {
  statusListener = cb
  configureStatusBus(cb, () => getStatusSummary())
}

async function emitStatusChanged(): Promise<void> {
  if (!statusListener) return
  try {
    statusListener(getStatusSummary())
  } catch (err) {
    console.warn('[Zotero Article] status listener 抛异常:', err)
  }
}

async function ensureQueueWithEnqueueScan(opts: { resetFailed?: boolean } = {}): Promise<void> {
  const config = loadArticleConfig()
  if (!config.enabled) return

  if (!queue) {
    queue = new ArticleQueue(async key => {
      await runOne(key)
      void emitStatusChanged()
    }, config.concurrency)
  }

  const snap = loadSnapshot()
  if (!snap) {
    console.log('[Zotero Article] 暂无 snapshot，worker 启动但空闲')
    return
  }

  const enqueueKeys: string[] = []
  /** 统计入队原因，便于排查"为什么这次扫描入队了 N 个" */
  const reasons: Record<string, number> = {}
  for (const [key, rec] of Object.entries(snap.pdfs)) {
    if (rec.parse?.status !== 'completed' || !rec.parse.mdPath) continue

    const mdPath = rec.parse.mdPath
    if (!existsSync(mdPath)) continue
    const mtimeMs = statSync(mdPath).mtimeMs

    if (opts.resetFailed && rec.article?.status === 'failed') {
      await updateRecordArticle(key, { ...makeDefaultArticleState(), articleCreated: rec.article.articleCreated })
      enqueueKeys.push(key)
      reasons['reset-failed'] = (reasons['reset-failed'] ?? 0) + 1
      continue
    }

    const reason = enqueueReason(rec, mtimeMs)
    if (reason) {
      enqueueKeys.push(key)
      reasons[reason] = (reasons[reason] ?? 0) + 1
    }
  }

  if (enqueueKeys.length > 0) {
    console.log(
      `[Zotero Article] worker 启动：入队 ${enqueueKeys.length} 个待生成 article ${JSON.stringify(reasons)}`,
    )
    queue.enqueueMany(enqueueKeys)
  } else {
    console.log('[Zotero Article] worker 启动：所有 article 均为最新')
  }
}

function shouldEnqueue(rec: ZoteroPdfRecord, mdMtimeMs: number): boolean {
  return enqueueReason(rec, mdMtimeMs) !== null
}

/** 给出入队原因（null = 不入队），便于日志诊断 */
function enqueueReason(rec: ZoteroPdfRecord, mdMtimeMs: number): string | null {
  const a = rec.article
  if (!a) return 'no-article'
  if (a.status === 'idle' || a.status === 'pending') return `status-${a.status}`
  if (a.status === 'skipped') return 'reactivated-from-skipped'
  if (a.status === 'failed' && a.attempts < MAX_ATTEMPTS) return 'failed-retry'
  if (a.sourceMdMtimeMs !== mdMtimeMs) return 'md-mtime-changed'
  if (a.promptVersion !== PROMPT_VERSION) return 'prompt-version-bumped'
  return null
}

async function markAllAsSkipped(): Promise<void> {
  const snap = loadSnapshot()
  if (!snap) return
  const tasks: Array<Promise<void>> = []
  for (const [key, rec] of Object.entries(snap.pdfs)) {
    if (rec.parse?.status !== 'completed') continue
    const status = rec.article?.status ?? 'idle'
    if (status === 'completed') continue // 已生成的不动
    tasks.push(updateRecordArticle(key, { status: 'skipped' }))
  }
  await Promise.all(tasks)
}
