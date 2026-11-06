/**
 * 极简 frontmatter 解析与序列化（v2 schema）
 *
 * 只支持本项目固定使用的 6 个字段（id / title / authors / year / tags / source_pdf），
 * 不引入 gray-matter / js-yaml 依赖（避免 ~150KB 包体积膨胀）。
 *
 * 解析容忍的格式：
 *   ---
 *   id: "ABCD1234"
 *   title: "Attention Is All You Need"
 *   authors: ["Ashish Vaswani", "Noam Shazeer"]
 *   year: 2017
 *   tags: [transformer, attention]
 *   source_pdf: "/Users/me/Zotero/storage/ABCD1234/paper.pdf"
 *   ---
 */

export interface ArticleFrontmatter {
  id: string
  title: string
  authors: string[]
  year: number | null
  tags: string[]
  source_pdf: string
}

/** 拆分 frontmatter 与 body；无 frontmatter 时 frontmatter=null、body=整段输入 */
export function extractFrontmatter(text: string): {
  frontmatter: Partial<ArticleFrontmatter> | null
  body: string
} {
  if (!text.startsWith('---')) return { frontmatter: null, body: text }
  const lines = text.split('\n')
  let endIdx = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      endIdx = i
      break
    }
  }
  if (endIdx === -1) return { frontmatter: null, body: text }

  const fmLines = lines.slice(1, endIdx)
  const bodyLines = lines.slice(endIdx + 1)
  while (bodyLines.length > 0 && bodyLines[0]?.trim() === '') bodyLines.shift()

  const fm = parseFrontmatterLines(fmLines)
  return { frontmatter: fm, body: bodyLines.join('\n') }
}

function parseFrontmatterLines(lines: string[]): Partial<ArticleFrontmatter> {
  const fm: Partial<ArticleFrontmatter> = {}
  for (const line of lines) {
    const m = /^([a-zA-Z_]+)\s*:\s*(.*)$/.exec(line)
    if (!m) continue
    const key = (m[1] ?? '') as keyof ArticleFrontmatter
    const raw = (m[2] ?? '').trim()
    if (raw === '') continue

    if (key === 'authors' || key === 'tags') {
      fm[key] = parseFlowArray(raw)
    } else if (key === 'year') {
      const n = parseInt(raw, 10)
      if (Number.isFinite(n)) fm.year = n
    } else if (key === 'id' || key === 'title' || key === 'source_pdf') {
      fm[key] = stripQuotes(raw)
    }
  }
  return fm
}

/** 解析 flow 数组 [a, b, "c"] → ['a', 'b', 'c'] */
function parseFlowArray(raw: string): string[] {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return []
  const inner = trimmed.slice(1, -1).trim()
  if (inner === '') return []
  return inner
    .split(',')
    .map(s => stripQuotes(s.trim()))
    .filter(s => s.length > 0)
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1)
  }
  return s
}

/** 序列化为 frontmatter 字符串（含两端 ---）；字段顺序固定 */
export function serializeFrontmatter(fm: ArticleFrontmatter): string {
  const lines = [
    '---',
    `id: ${quoteScalar(fm.id)}`,
    `title: ${quoteScalar(fm.title)}`,
    `authors: ${formatFlowArray(fm.authors, true)}`,
    `year: ${fm.year ?? 'null'}`,
    `tags: ${formatFlowArray(fm.tags, false)}`,
    `source_pdf: ${quoteScalar(fm.source_pdf)}`,
    '---',
  ]
  return lines.join('\n')
}

/** 标量字段一律加双引号（避免冒号 / 路径分隔符触发 YAML 歧义） */
function quoteScalar(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function formatFlowArray(items: string[], quoteAll: boolean): string {
  if (items.length === 0) return '[]'
  const parts = items.map(it => (quoteAll || /[\s,#:"]/.test(it) ? `"${it.replace(/"/g, '\\"')}"` : it))
  return `[${parts.join(', ')}]`
}

export interface NormalizeFrontmatterInput {
  llmFrontmatter: Partial<ArticleFrontmatter> | null
  /** 论文 wiki 唯一 id；当前与 attachmentKey 等价 */
  paperId: string
  /** 论文标题（来自 rec.parent.title 或 rec.title 或 filename，由 worker 选定） */
  recTitle: string
  /** 工作 fallback：rec.filename，仅在 recTitle 为空时使用 */
  recFilename: string
  /** 父条目作者列表（按 Zotero creators，仅 author 类型，"First Last" 形式） */
  authors: string[]
  /** 4 位年份；无父条目或无法解析时为 null */
  year: number | null
  /** 源 PDF 绝对路径 */
  sourcePdf: string
}

/**
 * 校验并归一 LLM 输出的 frontmatter，返回最终落盘版本。
 *
 * 强制覆写：id / title / authors / year / source_pdf
 * 校验保留：tags（≤8 个非空 string）
 */
export function normalizeFrontmatter(input: NormalizeFrontmatterInput): ArticleFrontmatter {
  const llm = input.llmFrontmatter ?? {}

  const tagsRaw = Array.isArray(llm.tags) ? llm.tags : []
  const tags = tagsRaw
    .filter(t => typeof t === 'string' && t.trim().length > 0)
    .map(t => t.trim().toLowerCase())
    .slice(0, 8)

  const title =
    (input.recTitle && input.recTitle.length > 0 ? input.recTitle : input.recFilename) ||
    input.paperId

  return {
    id: input.paperId,
    title,
    authors: input.authors,
    year: input.year,
    tags,
    source_pdf: input.sourcePdf,
  }
}
