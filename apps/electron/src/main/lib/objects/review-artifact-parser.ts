/**
 * 综述 artifact 解析器（**保留作扩展点；当前无生产链路触发**）
 *
 * 历史用途：曾用于解析 synthesizer SubAgent 在 chat 中 inline 输出的
 * `<asci-review-artifact>...</asci-review-artifact>` 块（含 YAML frontmatter
 * + HTML body）。synthesizer 的 artifact contract 已撤；ASCI 真实综述链路
 * 走 cwd 模式（[review-cwd-scanner.ts]），本解析器不再被生产路径触发。
 *
 * 保留它的理由：纯字符串函数无副作用、有完整单测、未来若某条新链路想
 * 复活 inline 通道可零成本复用。
 *
 * 故意做得宽容：
 *   - 大小写不敏感的标签匹配
 *   - frontmatter 缺失或解析失败 → 返回 null
 *   - 多个 marker 块 → 取最后一个
 *
 * 严格的部分：
 *   - title 必须非空才视为有效 artifact
 */

export interface ReviewArtifact {
  title: string
  topic?: string
  /** HTML 正文（含 frontmatter 之后到闭合标签之前的所有内容） */
  html: string
}

const OPEN = /<asci-review-artifact>/i
const CLOSE = /<\/asci-review-artifact>/i

/**
 * 从一段任意文本里抽取 review artifact。
 * 返回 null 表示未找到 / 不合法。
 */
export function extractReviewArtifact(text: string): ReviewArtifact | null {
  if (!text) return null

  // 多次出现时取最后一个
  let lastOpen = -1
  let lastClose = -1
  const openRe = new RegExp(OPEN.source, 'gi')
  const closeRe = new RegExp(CLOSE.source, 'gi')
  for (let m: RegExpExecArray | null; (m = openRe.exec(text)); ) lastOpen = m.index + m[0].length
  for (let m: RegExpExecArray | null; (m = closeRe.exec(text)); ) lastClose = m.index

  if (lastOpen < 0 || lastClose < 0 || lastClose <= lastOpen) return null

  const inner = text.slice(lastOpen, lastClose).trim()
  const parsed = parseFrontmatter(inner)
  if (!parsed) return null
  const { fields, body } = parsed

  const title = fields.title?.trim()
  const topic = fields.topic?.trim()
  if (!title) return null

  return {
    title,
    topic: topic || undefined,
    html: body.trim(),
  }
}

interface FrontmatterParseResult {
  fields: Record<string, string>
  body: string
}

/**
 * 最小 YAML frontmatter 解析：
 *   ---
 *   key: value
 *   key: value
 *   ---
 *   <body...>
 *
 * 不支持嵌套、数组、多行 value —— synthesizer contract 只用 title / topic 两个标量 key。
 */
function parseFrontmatter(input: string): FrontmatterParseResult | null {
  const trimmed = input.replace(/^\s+/, '')
  if (!trimmed.startsWith('---')) return null

  // 找到第二个 --- 行
  const afterOpen = trimmed.slice(3) // 跳过开头的 ---
  const closeIdx = afterOpen.search(/(^|\n)---(\r?\n|$)/)
  if (closeIdx < 0) return null

  const fmText = afterOpen.slice(0, closeIdx)
  const restAfterClose = afterOpen.slice(closeIdx).replace(/(^|\n)---(\r?\n|$)/, '$1')

  const fields: Record<string, string> = {}
  for (const line of fmText.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][\w-]*)\s*:\s*(.*?)\s*$/)
    if (!m) continue
    const key = m[1]
    let val = m[2] ?? ''
    if (key === undefined) continue
    // 去掉两端配对的引号
    if (
      val.length >= 2 &&
      ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'")))
    ) {
      val = val.slice(1, -1)
    }
    fields[key] = val
  }

  return { fields, body: restAfterClose }
}
