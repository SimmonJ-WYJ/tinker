/**
 * Review HTML → EvidenceItemInput[] 提取器
 *
 * 把综述 HTML 里的引用三件套（综述位置 / 被引论文 / 论文原文短引）扫成结构化
 * `EvidenceItemInput[]`，交给 evidence-attachment-service 落库。
 *
 * 输入约束：HTML fragment 或已 wrap 的完整文档都行；只要里头有
 * `<article class="asci-review">` 即可。
 *
 * 提取规则：
 *   1. 找到 §7 References 块（<ol class="refs">），把 <li id="ref-N" data-ref="N"
 *      data-paper-id?/data-doi?/data-zotero-key?> 解析成 N → PaperRef
 *   2. 遍历正文 <section id="sN">（**排除 §7 / .references**）：
 *      - 每个 <p>（idx pIdx 0-based）
 *      - 每个 <cite data-ref="N"><q>X</q></cite>（idx cIdx 0-based）
 *      - 构造 source.anchor（md：snapshotText = `<q>` 内容）
 *      - 构造 target.anchor（html：snapshotText = `<p>` 剥掉 `<cite>` 之后的文本，
 *        locationData 含 selector / sectionId / paragraphIndex / citeIndex）
 *   3. paper 不在 §7 / 无 data-* 属性 → 该条 skip + log warn
 *
 * 实现方式：纯正则，不引新依赖。HTML schema 紧、不嵌套（skill contract 保证），
 * 正则可控；未来如果 LLM 输出更野再换 linkedom。
 */

import type { Anchor, ObjectId } from '@asci/shared'

import { buildHtmlAnchor, buildMdAnchor } from './anchor-codec.ts'
import type { EvidenceItemInput, PaperRef } from './evidence-attachment-service.ts'

/** §7 References 一条解析结果 */
export interface ParsedReference {
  /** 1-based ref 序号 */
  n: number
  /** PaperRef（id / doi / zoteroKey 三选一）；都缺时为 null */
  paper: PaperRef | null
  /**
   * 从 `<li>` 内文本解析出的元数据（供 paper-sync-service 兜底建 paper）。
   * 解析规则与渲染端 `parseReferencesFromHtml` 对齐：`Authors. <i>Title</i>. Venue, Year.`
   * 任一字段解析失败 → 该字段 undefined；全失败 → metadata 整体为空对象。
   */
  metadata: {
    title?: string
    authors?: string[]
    year?: number
    venue?: string
    doi?: string
    zoteroKey?: string
  }
}

/** 从 HTML 抽 §7 References 表 → Map<N, ParsedReference> */
export function parseReferencesTable(html: string): Map<number, ParsedReference> {
  const out = new Map<number, ParsedReference>()
  // 找 <ol class="refs"> 块内部的所有 <li>，或退而求其次：所有 <li id="ref-N" data-ref="N" ...>
  // 优先用 <ol class="refs">；找不到时退到全局扫 li
  // data-ref 值容忍单/双引号
  const liRegex =
    /<li\b([^>]*?)\bdata-ref=(?:"(\d+)"|'(\d+)')([^>]*)>([\s\S]*?)<\/li>/gi
  let m: RegExpExecArray | null
  while ((m = liRegex.exec(html)) !== null) {
    const attrsBefore = m[1] ?? ''
    const nStr = m[2] ?? m[3]!
    const attrsAfter = m[4] ?? ''
    const inner = m[5] ?? ''
    const fullAttrs = attrsBefore + ' ' + attrsAfter
    const n = Number.parseInt(nStr, 10)
    if (!Number.isInteger(n) || n <= 0) continue

    const paperId = readAttr(fullAttrs, 'data-paper-id')
    const doi = readAttr(fullAttrs, 'data-doi')
    const zoteroKey = readAttr(fullAttrs, 'data-zotero-key')
    let paper: PaperRef | null = null
    if (paperId) paper = { id: paperId as ObjectId }
    else if (doi) paper = { doi }
    else if (zoteroKey) paper = { zoteroKey }

    const metadata = parseLiMetadata(inner)
    if (doi) metadata.doi = doi
    if (zoteroKey) metadata.zoteroKey = zoteroKey

    if (!out.has(n)) out.set(n, { n, paper, metadata })
  }
  return out
}

/**
 * 从 `<li>` 内 HTML 抽 Authors / Title / Venue / Year
 *
 * 与渲染端 `apps/electron/src/renderer/lib/review-html-citations.ts` 同语义：
 *   - title：取首个 `<i>...</i>` 内文本（找不到时 undefined，避免假 title 污染 sync）
 *   - year：取最后一个 19xx / 20xx
 *   - authors：title 前的文本（剥尾部 `. `），按 `,` 拆分
 *   - venue：title 之后、year 之前的部分
 *
 * 注：渲染端用 DOM；这里用正则。两份实现等价是有意冗余 —— 主进程不引 jsdom。
 */
function parseLiMetadata(inner: string): ParsedReference['metadata'] {
  const out: ParsedReference['metadata'] = {}
  // 抽 <i> 或 <em>
  const titleMatch = inner.match(/<(i|em)\b[^>]*>([\s\S]*?)<\/\1>/i)
  const title = titleMatch ? decodeHtmlEntities(stripTags(titleMatch[2] ?? '')).trim() : ''
  if (title) out.title = title

  const rawText = decodeHtmlEntities(stripTags(inner)).replace(/\s+/g, ' ').trim()
  const yearMatches = rawText.match(/(19|20)\d{2}/g)
  if (yearMatches && yearMatches.length > 0) {
    const y = Number.parseInt(yearMatches[yearMatches.length - 1]!, 10)
    if (Number.isInteger(y)) out.year = y
  }

  if (title) {
    const titleIdx = rawText.indexOf(title)
    if (titleIdx > 0) {
      const before = rawText.slice(0, titleIdx).replace(/[\s.]+$/, '').trim()
      if (before) {
        out.authors = before
          .split(/\s*,\s*/)
          .map((s) => s.replace(/\.$/, '').trim())
          .filter((s) => s.length > 0)
      }
    }
    const after = titleIdx >= 0 ? rawText.slice(titleIdx + title.length) : ''
    if (after) {
      const venueRaw = after
        .replace(/^[\s.,]+/, '')
        .replace(/[\s,(]*(19|20)\d{2}\)?\s*\.?\s*$/i, '')
        .replace(/[\s.,]+$/, '')
        .trim()
      if (venueRaw) out.venue = venueRaw
    }
  }

  return out
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '')
}

/** 从 attrs 串里抽某个 attribute 的值（容忍单双引号） */
function readAttr(attrs: string, name: string): string | undefined {
  const re = new RegExp(`\\b${name}=("([^"]*)"|'([^']*)')`, 'i')
  const m = re.exec(attrs)
  if (!m) return undefined
  return m[2] ?? m[3]
}

/** 提取结果 + 副产物（解析失败/不可解析的 cite 列表，便于上游 log） */
export interface ExtractCitationsResult {
  items: EvidenceItemInput[]
  /** §7 解析得到的全部 reference 行（含 metadata），供 paper-sync 兜底建库 */
  references: ParsedReference[]
  /** §7 解析时缺 paper 标识的 N（不会出现在 items 里） */
  refsMissingPaper: number[]
  /** 正文里 cite data-ref 在 §7 找不到对应条目的 N */
  citesUnresolved: number[]
}

/**
 * 主入口：从 review HTML 抽 EvidenceItemInput[]
 *
 * 输入是 fragment 或 wrapped HTML 都可，但里头必须含 `<article class="asci-review">`。
 * 找不到 article → 返回空结果（不抛错，上游 try/catch 走 warn 路径）。
 */
export function extractReviewCitations(html: string): ExtractCitationsResult {
  const result: ExtractCitationsResult = {
    items: [],
    references: [],
    refsMissingPaper: [],
    citesUnresolved: [],
  }

  // 1) 抽 §7 References 表
  const refsTable = parseReferencesTable(html)
  result.references = [...refsTable.values()].sort((a, b) => a.n - b.n)
  for (const [n, ref] of refsTable) {
    if (!ref.paper) result.refsMissingPaper.push(n)
  }

  // 2) 找到 <article class="asci-review">…</article>（容忍 wrapped）
  const articleMatch = html.match(
    /<article\b[^>]*\bclass="[^"]*\basci-review\b[^"]*"[^>]*>([\s\S]*?)<\/article>/i,
  )
  if (!articleMatch) return result
  const articleInner = articleMatch[1]!

  // 3) 遍历正文 <section id="sN">（排除 §7 References 块）
  const sectionRegex = /<section\b([^>]*)>([\s\S]*?)<\/section>/gi
  let secMatch: RegExpExecArray | null
  while ((secMatch = sectionRegex.exec(articleInner)) !== null) {
    const secAttrs = secMatch[1] ?? ''
    const secInner = secMatch[2] ?? ''
    // 跳过 References / Decisions 段：class 含 references 或 id=s7
    const secClass = readAttr(secAttrs, 'class') ?? ''
    const secId = readAttr(secAttrs, 'id') ?? ''
    if (/\brefereences?\b|\brefs?\b/i.test(secClass)) continue // 拼写容错
    if (/\breferences\b/i.test(secClass)) continue
    if (secId.toLowerCase() === 's7') continue

    // 4) 遍历 <p>（仅顶层段落，不递归嵌套；contract 上 cite 必在直接 <p> 里）
    const pRegex = /<p\b[^>]*>([\s\S]*?)<\/p>/gi
    let pMatch: RegExpExecArray | null
    let pIdx = 0
    while ((pMatch = pRegex.exec(secInner)) !== null) {
      const pInner = pMatch[1] ?? ''
      // 5) 遍历 <cite data-ref="N"><q>X</q></cite>
      const citeRegex =
        /<cite\b[^>]*\bdata-ref="(\d+)"[^>]*>\s*<q\b[^>]*>([\s\S]*?)<\/q>\s*<\/cite>/gi
      const citesInP: Array<{ n: number; quote: string }> = []
      let cMatch: RegExpExecArray | null
      while ((cMatch = citeRegex.exec(pInner)) !== null) {
        const n = Number.parseInt(cMatch[1]!, 10)
        if (!Number.isInteger(n)) continue
        citesInP.push({ n, quote: decodeHtmlEntities(cMatch[2]!.trim()) })
      }
      if (citesInP.length === 0) {
        pIdx++
        continue
      }

      // 6) 段落文本（剥所有 <cite>...</cite> 后纯文本，作为 target.snapshotText）
      const pTextWithoutCite = stripCiteAndTags(pInner)

      citesInP.forEach((cite, cIdx) => {
        const ref = refsTable.get(cite.n)
        if (!ref || !ref.paper) {
          result.citesUnresolved.push(cite.n)
          return
        }
        const target: Anchor = buildHtmlAnchor({
          snapshotText: pTextWithoutCite,
          selector: buildCiteSelector(secId, pIdx, cIdx),
          sectionId: secId || undefined,
          paragraphIndex: pIdx,
          citeIndex: cIdx,
        })
        const source: Anchor = buildMdAnchor({
          snapshotText: cite.quote,
          // v1 不接 byteOffset 精确定位；snapshotText 自己就够搜索高亮
        })
        result.items.push({
          paper: ref.paper,
          source,
          target,
        })
      })
      pIdx++
    }
  }

  return result
}

/** 构造 CSS selector：`#sN > p:nth-of-type(p+1) > cite:nth-of-type(c+1)`，
 * 没 sectionId 时回落到 `cite[data-ref="..."]` 形式（不那么精确但够用）。 */
function buildCiteSelector(
  sectionId: string,
  paragraphIdx: number,
  citeIdx: number,
): string | undefined {
  if (!sectionId) return undefined
  return `#${cssEscape(sectionId)} > p:nth-of-type(${paragraphIdx + 1}) > cite:nth-of-type(${citeIdx + 1})`
}

/** 简易 CSS identifier escape（够 sectionId 用，不追求完整 CSS.escape） */
function cssEscape(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, (ch) => '\\' + ch)
}

/** 去除 <cite>...</cite> 整段，并 strip 剩余 HTML 标签得到纯文本 + 解码常见实体 */
function stripCiteAndTags(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<cite\b[^>]*>[\s\S]*?<\/cite>/gi, '')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim()
}

/** 极简实体解码（h1 title / quote / 段落文本场景够用） */
function decodeHtmlEntities(html: string): string {
  return html
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
}
