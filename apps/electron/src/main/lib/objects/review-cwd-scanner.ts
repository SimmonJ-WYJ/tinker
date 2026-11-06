/**
 * Session cwd 综述文件扫描器
 *
 * 真实综述链路（litreview / literature-review-result skill v0.19.0+）会用 Write 工具把综述
 * 以 HTML fragment 形式落到 session cwd 下的 `reviews/{YYYY-MM-DD_HH-mm}-{slug}.html`，
 * **不**走 inline `<asci-review-artifact>` 通道。本扫描器在 Agent run 完成时被
 * orchestrator 调用，捞出本轮新增的 html 文件，交给 persistence-service 落库。
 *
 * 设计要点：
 *   - 只看 .html（v0.19.0 起的 skill contract）；忽略其它扩展名（含历史 .md，
 *     已落库的老 review 仍由 review-body-service 按 bodyPath 直读，不依赖本扫描器）
 *   - 用 mtimeMs >= runStartedAt（开放右区间）过滤本轮新增；Write 工具有时
 *     会写 mtime 略早 1-2ms 的文件，所以再向前放宽 2000ms 防漏
 *   - 不做内容裁切；调用方自己负责截长
 *   - 文件名解析：`YYYY-MM-DD_HH-mm-<slug>.html` 的 `<slug>`，转 fallback title
 *   - 首个 `<h1>…</h1>` 的 textContent 取作主标题；找不到则用 slug fallback
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { toIso } from '@asci/shared'

/** 一份扫到的 html 综述（供 persistence-service 消费） */
export interface ScannedReviewFile {
  /** 绝对路径（session cwd 下 reviews/xxx.html） */
  filePath: string
  /** 文件名（不含目录） */
  fileName: string
  /** mtime（毫秒）。同一份文件被覆写后 mtime 会变 */
  mtimeMs: number
  /** 完整 html fragment 文本 */
  content: string
  /** 从 H1 / 文件名 slug 提取出的 title 候选；调用方再做空字符串校验 */
  title: string
}

/** mtime 过滤宽限：Write 工具偶发会落在 runStartedAt 之前几 ms，向前放宽 2s */
const MTIME_GRACE_MS = 2000

/**
 * 扫 session cwd 下 reviews/*.html，返回 mtime 在 runStartedAt（含宽限）之后的文件。
 *
 * 任何一步失败（目录不存在 / 读不出来）→ 返回空数组并打日志，不抛错，
 * 因为这条路径不应阻塞 Agent 主路径。
 */
export function scanSessionReviewsDir(
  sessionCwd: string,
  runStartedAtMs: number,
): ScannedReviewFile[] {
  const reviewsDir = join(sessionCwd, 'reviews')
  if (!existsSync(reviewsDir)) {
    console.log(`[review-cwd-scanner] reviews 目录不存在: ${reviewsDir}`)
    return []
  }

  const threshold = runStartedAtMs - MTIME_GRACE_MS
  let names: string[]
  try {
    names = readdirSync(reviewsDir)
  } catch (err) {
    console.warn(`[review-cwd-scanner] 读 reviews 目录失败: ${reviewsDir}`, err)
    return []
  }

  const results: ScannedReviewFile[] = []
  for (const name of names) {
    if (!name.toLowerCase().endsWith('.html')) continue
    const filePath = join(reviewsDir, name)
    let st: ReturnType<typeof statSync>
    try {
      st = statSync(filePath)
    } catch (err) {
      console.warn(`[review-cwd-scanner] stat 失败 ${filePath}`, err)
      continue
    }
    if (!st.isFile()) continue
    if (st.mtimeMs < threshold) {
      // 这是本轮之前留下来的旧文件，不处理
      continue
    }

    let content: string
    try {
      content = readFileSync(filePath, 'utf-8')
    } catch (err) {
      console.warn(`[review-cwd-scanner] 读文件失败 ${filePath}`, err)
      continue
    }
    if (content.trim().length === 0) continue

    results.push({
      filePath,
      fileName: name,
      mtimeMs: st.mtimeMs,
      content,
      title: pickTitle(content, name),
    })
  }

  // 按 mtime 升序，先写的先落库
  results.sort((a, b) => a.mtimeMs - b.mtimeMs)
  console.log(
    `[review-cwd-scanner] 扫到 ${results.length} 份新 html（threshold=${toIso(threshold)} dir=${reviewsDir}）`,
  )
  return results
}

/**
 * 抽 title 的双层兜底：
 *   1. html 首个 `<h1>…</h1>` 的 textContent（剥所有 inline tag、解码常见实体）
 *   2. 文件名 slug：`2026-05-21_15-30-rag.html` → `rag`
 *      （split 第一个 `-` 之后；移除扩展名；下划线转空格）
 *   3. 文件名本身（含扩展名）
 *
 * 不做空字符串保护；调用方持久化前会经过 SQL 的 length(title) > 0 校验。
 */
function pickTitle(content: string, fileName: string): string {
  // 首个 <h1>...</h1>（大小写不敏感、允许属性、允许跨行）
  const h1Match = content.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  if (h1Match && h1Match[1]) {
    const text = stripTagsAndDecode(h1Match[1]).trim()
    if (text.length > 0) return text
  }

  // 文件名 slug：2026-05-21_15-30-some-slug.html
  const noExt = fileName.replace(/\.html?$/i, '')
  const tsAndSlug = noExt.match(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-(.+)$/)
  if (tsAndSlug && tsAndSlug[1]) {
    return tsAndSlug[1].replace(/[-_]+/g, ' ').trim()
  }
  return noExt
}

/** 极简 HTML → 纯文本：剥标签 + 解码常见实体（&amp; &lt; &gt; &quot; &#39; &nbsp;）。
 * 不引外部依赖；仅用于 H1 title 这种短文本场景，越界字符容忍度高。 */
function stripTagsAndDecode(html: string): string {
  const noTags = html.replace(/<[^>]+>/g, '')
  return noTags
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
}
