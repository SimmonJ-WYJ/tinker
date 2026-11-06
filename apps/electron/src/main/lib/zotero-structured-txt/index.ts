/**
 * Zotero structured .txt 生成链路
 *
 * 两种调用入口，共用同一份 extractor + classifier + formatter + rich wrap 管线，
 * 产物统一写到 `~/.asci/zotero/wiki/{key}.txt`：
 *
 *  1. `generateAllStructuredTxt()` — 用户在设置页点"生成结构化 TXT"按钮触发；
 *     遍历当前 snapshot 全量重写，带 module-level 锁防止并发触发
 *  2. `generateStructuredTxtForOne(rec)` — lite worker 写完 .md 后立即调用，
 *     与 .md 解析时机一致，免去用户手动点按钮
 *
 * 设计要点：
 *  - **不进 worker 队列、不写 snapshot**：状态全靠产物文件存在性判断
 *  - **重入安全（仅全量入口）**：module-level 锁，单条入口不锁（worker 池本身已限并发）
 *  - **并发限流（仅全量入口）**：固定 2 个并发（pdfjs 无 worker，主线程跑文本抽取
 *    是 CPU bound，比 lite 队列的 4 并发更保守）
 *  - **错误隔离**：单条 PDF 失败不影响其他；失败计入 failedKeys 返回
 *  - **取消支持**：保留接口位 `cancel()`，MVP 先不实现
 */

import { existsSync, writeFileSync } from 'node:fs'
import type { ZoteroPdfRecord } from '@asci/shared'
import { nowMs } from '@asci/shared'
import { buildAttachmentPath } from '../zotero-client/data-dir'
import { getZoteroWikiStructuredTxtPath } from '../config-paths'
import { loadSnapshot } from '../zotero-pdf-parser/snapshot-store'
import { buildTokens } from '../zotero-pdf-parser/strategies/structured/classifier'
import { extract } from '../zotero-pdf-parser/strategies/structured/extractor'
import { format } from '../zotero-pdf-parser/strategies/structured/formatter'
import { wrapAsStructuredTxt } from './wrap'

const CONCURRENCY = 2

export interface StructuredTxtGenerationResult {
  /** snapshot 里的 record 总数 */
  total: number
  /** 成功生成的 .txt 数量 */
  generated: number
  /** 跳过（PDF 文件不存在）数量 */
  skipped: number
  /** 失败数量 */
  failed: number
  /** 失败的 attachmentKey 列表（最多前 10 条，配合 error 文本） */
  failures: Array<{ attachmentKey: string; error: string }>
}

let runningPromise: Promise<StructuredTxtGenerationResult> | null = null

/**
 * 生成 / 重写所有 snapshot 内 PDF 的 structured .txt
 *
 * 同时只能有一份在跑；重入时返回正在运行的 promise，避免并发冲突。
 */
export function generateAllStructuredTxt(): Promise<StructuredTxtGenerationResult> {
  if (runningPromise) {
    console.log('[Zotero Structured TXT] 已有任务在运行，复用')
    return runningPromise
  }
  runningPromise = runOnce().finally(() => {
    runningPromise = null
  })
  return runningPromise
}

async function runOnce(): Promise<StructuredTxtGenerationResult> {
  const snap = loadSnapshot()
  const result: StructuredTxtGenerationResult = {
    total: 0,
    generated: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  }
  if (!snap) {
    console.log('[Zotero Structured TXT] snapshot 不存在，noop')
    return result
  }
  const records = Object.values(snap.pdfs)
  result.total = records.length
  if (result.total === 0) return result

  console.log(`[Zotero Structured TXT] 开始生成：${result.total} 条，并发=${CONCURRENCY}`)
  const t0 = nowMs()

  // 简单 worker pool：固定 CONCURRENCY 个并发 promise，从 records 数组取任务
  let cursor = 0
  async function nextOne(): Promise<void> {
    while (true) {
      const idx = cursor++
      if (idx >= records.length) return
      const rec = records[idx]!
      await processOne(rec, result)
    }
  }
  const workers = Array.from({ length: Math.min(CONCURRENCY, records.length) }, () => nextOne())
  await Promise.all(workers)

  const dt = ((nowMs() - t0) / 1000).toFixed(1)
  console.log(
    `[Zotero Structured TXT] 完成：${result.generated} ✓ / ${result.skipped} skip / ${result.failed} ✗（${dt}s）`,
  )
  return result
}

/**
 * 单条入口：worker 写完 .md 后立刻同步生成同名 .txt
 *
 * - PDF 文件不存在 → 返回 'skipped'
 * - 成功 → 'generated'，并返回 txtPath
 * - 失败 → 'failed'，并返回 error；调用方决定是否吞错
 *
 * 注意：调用方负责并发控制（lite worker 池已限并发=4）；本函数本身不加锁，
 * 不与全量入口 `generateAllStructuredTxt()` 互斥（同一 PDF 的两路写入是
 * 幂等覆盖，最差情况只是多写一次同样内容，可接受）。
 */
export type SingleStructuredTxtStatus = 'generated' | 'skipped' | 'failed'

export interface SingleStructuredTxtResult {
  status: SingleStructuredTxtStatus
  txtPath?: string
  error?: string
}

export async function generateStructuredTxtForOne(
  rec: ZoteroPdfRecord,
): Promise<SingleStructuredTxtResult> {
  try {
    const pdfPath = buildAttachmentPath(rec.attachmentKey, rec.filename)
    if (!existsSync(pdfPath)) {
      return { status: 'skipped' }
    }
    const { pages } = await extract(pdfPath)
    const { tokens } = buildTokens(pages)
    const { outline, body } = format(tokens)
    const txt = wrapAsStructuredTxt({ rec, pdfPath, outline, body })
    const txtPath = getZoteroWikiStructuredTxtPath(rec.attachmentKey)
    writeFileSync(txtPath, txt, 'utf-8')
    console.log(
      `[Zotero Structured TXT] ✓ ${rec.attachmentKey}: ${outline.length} 章, ${txt.length} 字符 → ${txtPath}`,
    )
    return { status: 'generated', txtPath }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[Zotero Structured TXT] ✗ ${rec.attachmentKey}: ${msg}`)
    return { status: 'failed', error: msg }
  }
}

async function processOne(rec: ZoteroPdfRecord, result: StructuredTxtGenerationResult): Promise<void> {
  const r = await generateStructuredTxtForOne(rec)
  if (r.status === 'generated') {
    result.generated++
  } else if (r.status === 'skipped') {
    result.skipped++
  } else {
    result.failed++
    if (result.failures.length < 10) {
      result.failures.push({ attachmentKey: rec.attachmentKey, error: r.error ?? 'unknown' })
    }
  }
}
