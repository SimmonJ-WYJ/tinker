/**
 * 单任务解析 worker
 *
 * 给定 attachmentKey：
 *   1. 从 snapshot 取 record metadata
 *   2. 标记 parse.status = 'parsing'
 *   3. 拼 PDF 路径 → 调用 strategy 得 markdown
 *   4. 写 ~/.asci/zotero/wiki/{key}.md
 *   5. 顺手生成同名 structured .txt（best-effort，失败不阻塞 .md 完成）
 *   6. 更新 record.parse 为 completed / failed
 *
 * 所有 snapshot 写入都通过 snapshot-store 的串行写锁，多个 worker 并发安全。
 */

import { existsSync, statSync, writeFileSync, unlinkSync } from 'node:fs'
import { nowIso } from '@asci/shared'
import { getZoteroWikiMdPath, getZoteroWikiStructuredTxtPath } from '../config-paths'
import { buildAttachmentPath } from '../zotero-client/data-dir.ts'
import { onMdReady as onArticleMdReady } from '../zotero-article-generator/index.ts'
import { onEmbedSourceDeleted, onEmbedSourceReady } from '../zotero-embedding-index/index.ts'
import { generateStructuredTxtForOne } from '../zotero-structured-txt/index.ts'
import { loadSnapshot, updateRecordParse } from './snapshot-store'
import { selectStrategy } from './strategies/index'
import { wrapAsMarkdown } from './strategies/wrap'

/**
 * 处理一条 PDF 解析任务（不抛错；失败转为 status='failed' 记录到 snapshot）
 */
export async function runOne(attachmentKey: string): Promise<void> {
  const snap = loadSnapshot()
  const rec = snap?.pdfs[attachmentKey]
  if (!rec) {
    // 期间被 diff 删除了，跳过
    return
  }

  const prevAttempts = rec.parse?.attempts ?? 0

  // 标记 parsing
  await updateRecordParse(attachmentKey, { status: 'parsing' })

  try {
    const pdfPath = buildAttachmentPath(rec.attachmentKey, rec.filename)
    if (!existsSync(pdfPath)) {
      throw new Error(`PDF 文件不存在: ${pdfPath}`)
    }
    const stat = statSync(pdfPath)

    const strategy = selectStrategy(rec.parse?.strategy ?? 'lite')
    const { body, actualStrategy } = await strategy.parse({ rec, pdfPath })
    const md = wrapAsMarkdown({ rec, pdfPath, body, actualStrategy })

    const mdPath = getZoteroWikiMdPath(attachmentKey)
    writeFileSync(mdPath, md, 'utf-8')
    const mdStat = statSync(mdPath)

    await updateRecordParse(attachmentKey, {
      status: 'completed',
      mdPath,
      strategy: strategy.name,
      actualStrategy,
      parsedAt: nowIso(),
      error: null,
      attempts: prevAttempts + 1,
      sourceMtimeMs: stat.mtimeMs,
      sourceSize: stat.size,
    })
    console.log(`[Zotero PDF Parser] ✓ ${attachmentKey} → ${mdPath}`)

    // 通知 article 生成器：md 已就绪。若 article 开关关闭、生成器自身会立即返回，不会做额外工作。
    try {
      onArticleMdReady(attachmentKey, mdStat.mtimeMs)
    } catch (err) {
      console.warn(`[Zotero PDF Parser] onArticleMdReady 抛异常（不阻塞 parse 完成）:`, err)
    }

    // 通知向量索引：raw md 已就绪。评估开关关闭时立即返回；hash 未变更时 worker 内跳过。
    try {
      onEmbedSourceReady(attachmentKey)
    } catch (err) {
      console.warn(`[Zotero PDF Parser] onEmbedSourceReady 抛异常（不阻塞 parse 完成）:`, err)
    }

    // 顺带生成同名 structured .txt（best-effort）
    // 失败不影响 .md 已经完成的状态；用户可在设置页通过"生成结构化 TXT"重试。
    try {
      const r = await generateStructuredTxtForOne(rec)
      if (r.status === 'failed') {
        console.warn(`[Zotero PDF Parser] structured .txt 生成失败 ${attachmentKey}: ${r.error}`)
      }
    } catch (err) {
      console.warn(`[Zotero PDF Parser] structured .txt 调用抛异常 ${attachmentKey}（已吞）:`, err)
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    await updateRecordParse(attachmentKey, {
      status: 'failed',
      error: errMsg,
      attempts: prevAttempts + 1,
    })
    console.warn(`[Zotero PDF Parser] ✗ ${attachmentKey}: ${errMsg}`)
  }
}

/**
 * 删除某条 PDF 对应的 .md 与 .txt 文件（diff deleted 时调用）
 *
 * 文件不存在时静默跳过；两个文件独立清理，互不阻塞。
 */
export function cleanupMd(attachmentKey: string): void {
  const mdPath = getZoteroWikiMdPath(attachmentKey)
  if (existsSync(mdPath)) {
    try {
      unlinkSync(mdPath)
      console.log(`[Zotero PDF Parser] 🗑 已清理 ${attachmentKey}.md`)
    } catch (err) {
      console.warn(`[Zotero PDF Parser] 清理 .md 失败 ${attachmentKey}:`, err)
    }
  }
  const txtPath = getZoteroWikiStructuredTxtPath(attachmentKey)
  if (existsSync(txtPath)) {
    try {
      unlinkSync(txtPath)
      console.log(`[Zotero PDF Parser] 🗑 已清理 ${attachmentKey}.txt`)
    } catch (err) {
      console.warn(`[Zotero PDF Parser] 清理 .txt 失败 ${attachmentKey}:`, err)
    }
  }

  // 向量索引联动清理（评估开关关闭时也清理——索引是派生缓存，源没了就该没）
  try {
    onEmbedSourceDeleted(attachmentKey)
  } catch (err) {
    console.warn(`[Zotero PDF Parser] onEmbedSourceDeleted 抛异常 ${attachmentKey}:`, err)
  }
}
