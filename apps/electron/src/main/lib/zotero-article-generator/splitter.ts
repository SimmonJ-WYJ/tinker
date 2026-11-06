/**
 * 长 markdown 切片
 *
 * 把整篇原 md 按 ## / ### 标题边界切成若干片，单片字符数估算后约束在
 * `maxTokensPerChunk * 3`（中英混排粗略系数：1 token ≈ 3 字符）。
 *
 * 切片只在标题或段落分隔（双换行）处发生；不会断在段中，避免破坏上下文。
 * 第 1 片必含原文首部（含 frontmatter 上下文 / H1），便于 LLM 输出完整的 wiki 页面。
 */

export interface MarkdownChunk {
  index: number
  total: number
  isFirst: boolean
  markdown: string
}

const CHARS_PER_TOKEN = 3

/**
 * 按 ## / ### 标题切片；单片超阈值时再按段落分隔继续切。
 *
 * @param md 原始 markdown 全文
 * @param maxTokensPerChunk 单片 token 上限（粗估），切片字符数 ≈ maxTokens × 3
 */
export function splitMarkdownIntoChunks(md: string, maxTokensPerChunk: number): MarkdownChunk[] {
  const maxChars = Math.max(maxTokensPerChunk * CHARS_PER_TOKEN, 1500)
  const sections = splitByHeading(md)
  const merged = mergeSections(sections, maxChars)

  // 进一步拆超长片：按段落分隔（双换行）继续切
  const finalChunks: string[] = []
  for (const section of merged) {
    if (section.length <= maxChars) {
      finalChunks.push(section)
    } else {
      finalChunks.push(...splitByParagraph(section, maxChars))
    }
  }

  return finalChunks.map((markdown, idx) => ({
    index: idx + 1,
    total: finalChunks.length,
    isFirst: idx === 0,
    markdown,
  }))
}

/**
 * 估算 token 数（粗略）。仅用于切片决策与日志，不需精确。
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/**
 * 按 ## / ### 标题切，每段保留前导标题行。
 * 文档最开始（首个 ## 之前）的内容作为独立第 0 段返回（即使为空也保留位置）。
 */
function splitByHeading(md: string): string[] {
  const lines = md.split('\n')
  const sections: string[] = []
  let buf: string[] = []

  for (const line of lines) {
    if (/^##{0,3}\s/.test(line) && buf.length > 0) {
      sections.push(buf.join('\n'))
      buf = [line]
    } else {
      buf.push(line)
    }
  }
  if (buf.length > 0) sections.push(buf.join('\n'))
  return sections
}

/**
 * 把多个 section 合并到 ≤ maxChars 的单片。
 * 单 section 已经超阈值 → 独立成片，等下一步按段落继续切。
 */
function mergeSections(sections: string[], maxChars: number): string[] {
  const out: string[] = []
  let current: string[] = []
  let currentLen = 0

  for (const sec of sections) {
    const secLen = sec.length
    if (current.length === 0) {
      current.push(sec)
      currentLen = secLen
      continue
    }
    if (currentLen + secLen + 1 <= maxChars) {
      current.push(sec)
      currentLen += secLen + 1
    } else {
      out.push(current.join('\n'))
      current = [sec]
      currentLen = secLen
    }
  }
  if (current.length > 0) out.push(current.join('\n'))
  return out
}

/**
 * 单片仍超阈值时按段落（双换行）继续切。
 * 单段超阈值则强行整段返回（极端情况，宁可让 LLM 处理可能的截断也不在段中切）。
 */
function splitByParagraph(text: string, maxChars: number): string[] {
  const paragraphs = text.split(/\n{2,}/)
  const out: string[] = []
  let current: string[] = []
  let currentLen = 0

  for (const p of paragraphs) {
    const pLen = p.length
    if (current.length === 0) {
      current.push(p)
      currentLen = pLen
      continue
    }
    if (currentLen + pLen + 2 <= maxChars) {
      current.push(p)
      currentLen += pLen + 2
    } else {
      out.push(current.join('\n\n'))
      current = [p]
      currentLen = pLen
    }
  }
  if (current.length > 0) out.push(current.join('\n\n'))
  return out
}
