/**
 * 综述 §7 References 解析器
 *
 * literature-review-result skill 产出的 markdown 必有 §7 References，每行形如：
 *   [N] Authors. *Title*. Venue, Year.
 *
 * CitationBadge 在 hover 时除了展示 <quote> 原文，还希望同时展示 title / authors / year。
 * 数据已经在文档里（§7），所以渲染层只需要解析一次、按 N 建表，喂给 badge 即可。
 *
 * 解析容忍度（LLM 实际输出会偏离规范）：
 *   - 标题斜体可能是 *Title* / **Title** / 没斜体（裸文本，按 ". " 分段兜底）
 *   - venue 可能省略；year 可能在括号里、可能裸出
 *   - 行首可能带列表标记 `- [N]` / `* [N]` / `1. [N]`
 *   - References 块边界是下一个同级或更高级 heading（§8 Decisions / 文末）
 */
import { DOI_PREFIX, DOI_BODY } from './doi.ts'

export interface ReferenceMeta {
  n: number
  authors?: string
  title?: string
  year?: string
  venue?: string
  raw: string
  /**
   * 可选 DOI（从行尾 `doi:` / `DOI:` / `https://doi.org/` 解析）。
   * 对话流溯源（#448）用它经 `papers.resolveZoteroKey({ doi })` 解析到具体 PDF；
   * 综述 markdown 路径此前不需要、故为可选。
   */
  doi?: string
}

// 容忍多种 References 标题变体：`## 7. References` / `## §7 References` / `### §6 References`
// / `## References`。编号（含 §）可有可无 —— 对话流主 Agent 自由发挥时常用 §6 / 无编号，
// 不能只认 §7，否则解析不到引用、下游溯源全失效（#448）。
const SECTION_HEADING = /^(#{1,6})\s+§?\s*\d*\.?\s*References?\b.*$/im
const NEXT_HEADING = /^#{1,6}\s+\S/m

export function parseReferences(markdown: string): Map<number, ReferenceMeta> {
  const map = new Map<number, ReferenceMeta>()
  if (!markdown) return map

  const headingMatch = SECTION_HEADING.exec(markdown)
  if (!headingMatch || headingMatch.index === undefined) return map

  const afterHeading = markdown.slice(headingMatch.index + headingMatch[0].length)
  const nextMatch = NEXT_HEADING.exec(afterHeading)
  const block = nextMatch ? afterHeading.slice(0, nextMatch.index) : afterHeading

  for (const line of block.split(/\r?\n/)) {
    const meta = parseReferenceLine(line)
    if (meta) map.set(meta.n, meta)
  }
  return map
}

const LINE_RE = /^\s*(?:[-*+]\s+|\d+\.\s+)?\[(\d+)\]\s+(.+?)\s*$/

export function parseReferenceLine(line: string): ReferenceMeta | null {
  const m = LINE_RE.exec(line)
  if (!m) return null
  const nRaw = m[1]
  const rest = m[2]
  if (nRaw === undefined || rest === undefined) return null
  const n = Number(nRaw)
  if (!Number.isFinite(n)) return null
  const meta: ReferenceMeta = { n, raw: rest }

  // 先抽 doi 并从工作串里剥掉：doi 多出现在行尾，若留在串里会污染 venue/year 解析
  // （如 "NeurIPS, 2023. doi:10.x" 会让 year 不在串尾、venue 残留 doi）。meta.raw 保留全文。
  // doi 优先；无 doi 时退回 arXiv 标识（归一成 DataCite DOI 形式，供右栏溯源解析）。
  // 对话流里很多论文只有 arXiv id（如 Kaplan 2020 在索引里无 doi），只认 doi 会漏掉。
  const doi = extractDoi(rest)
  if (doi) {
    meta.doi = doi
  } else {
    const arxivDoi = extractArxivDoi(rest)
    if (arxivDoi) meta.doi = arxivDoi
  }
  const body = doi ? stripDoi(rest) : rest

  const titleMatch = extractTitle(body)
  if (titleMatch) {
    meta.title = titleMatch.title
    const before = body.slice(0, titleMatch.start).trim().replace(/[.,;]+$/, '').trim()
    if (before) meta.authors = before
    const after = body.slice(titleMatch.end).trim().replace(/^[.,;]+\s*/, '').replace(/[.,;]+$/, '').trim()
    if (after) meta.venue = after
  } else {
    const segments = body.split(/\.\s+/).map((s) => s.trim()).filter(Boolean)
    if (segments.length >= 2) {
      meta.authors = segments[0]
      meta.title = (segments[1] ?? '').replace(/[.,;]+$/, '').trim()
      if (segments.length >= 3) meta.venue = segments.slice(2).join('. ').replace(/[.,;]+$/, '').trim()
    }
  }

  const year = extractYear(meta.venue ?? body)
  if (year) {
    meta.year = year
    if (meta.venue) {
      const stripped = stripYearFromVenue(meta.venue, year)
      meta.venue = stripped || undefined
    }
  }

  return meta
}

/*
 * DOI 正则共用片段统一收口在 lib/doi.ts（对话流 DOI 跳转与本解析器共用，
 * 集中定义避免多处各写一份易走样）：
 *   - DOI_PREFIX：可选的 `doi:`（冒号后可有空格）/ `https://doi.org/` 前缀
 *   - DOI_BODY：DOI 主体 `10.<注册码>/<后缀>`
 * import 见文件顶部。
 */
const DOI_RE = new RegExp(`${DOI_PREFIX}(${DOI_BODY})`, 'i')
const DOI_STRIP_RE = new RegExp(`[.,;\\s(]*${DOI_PREFIX}${DOI_BODY}[).,;\\s]*`, 'i')

/**
 * 从引用行抽 DOI。容忍 `doi:` / `DOI:`（冒号后可有空格）/ `https://doi.org/` 三种前缀，
 * 以及裸 DOI（`10.xxxx/...`）。剥掉尾随的句点 / 逗号 / 括号等装饰字符。
 */
export function extractDoi(text: string): string | undefined {
  const m = DOI_RE.exec(text)
  if (!m || m[1] === undefined) return undefined
  // 剥尾随装饰（句点/逗号/分号/右括号）；DOI 本身不以这些结尾
  return m[1].replace(/[.,;)\]]+$/, '')
}

/**
 * 从引用行抽 arXiv 标识并归一成 DataCite DOI 形式 `10.48550/arXiv.<id>`。
 * 容忍 `arXiv:2001.08361` / `arxiv: 2203.15556v2`。DOI 大小写在反查时归一，故大小写无碍。
 */
const ARXIV_RE = /\barxiv:\s*(\d{4}\.\d{4,5})(?:v\d+)?/i

export function extractArxivDoi(text: string): string | undefined {
  const m = ARXIV_RE.exec(text)
  if (!m || m[1] === undefined) return undefined
  return `10.48550/arXiv.${m[1]}`
}

/** 把整行里的 doi 片段（含 `doi:` / doi.org 前缀与首尾装饰）剥掉，得到供 venue/year 解析的正文 */
function stripDoi(text: string): string {
  return text
    .replace(DOI_STRIP_RE, ' ')
    .trim()
    .replace(/[,;.\s]+$/, '')
    .trim()
}

/**
 * 把 venue 末尾的 year 及其连接符（", "、"("…")"、空格）剥掉，避免 subtitle
 * 出现 "2013 · Optics Express, 2013" 这种重复。只剥末尾出现的那一次，正文里
 * 万一另有年份（如 vol(issue) 卷号）不被误伤。
 */
function stripYearFromVenue(venue: string, year: string): string {
  return venue
    .replace(new RegExp(`[\\s,;.()]*${year}[\\s,;.()]*$`), '')
    .trim()
    .replace(/[,;.\s]+$/, '')
    .trim()
}

/**
 * 在 rest 里抽第一个 markdown 斜体/粗体作为标题。
 * 优先 **bold** 再 *italic*，避免 *Title* 被嵌在 **...** 里时拿到外层。
 */
function extractTitle(rest: string): { title: string; start: number; end: number } | null {
  const bold = /\*\*([^*]+)\*\*/.exec(rest)
  if (bold && bold[1] !== undefined) {
    return { title: bold[1].trim(), start: bold.index, end: bold.index + bold[0].length }
  }
  const italic = /\*([^*]+)\*/.exec(rest)
  if (italic && italic[1] !== undefined) {
    return { title: italic[1].trim(), start: italic.index, end: italic.index + italic[0].length }
  }
  return null
}

function extractYear(text: string): string | undefined {
  const matches = text.match(/\b(19|20)\d{2}\b/g)
  if (!matches || matches.length === 0) return undefined
  return matches[matches.length - 1]
}
