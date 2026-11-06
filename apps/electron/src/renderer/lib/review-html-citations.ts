/**
 * Review HTML §7 References 解析器（v0.19.0+ HTML fragment 综述专用）
 *
 * literature-review-result skill v0.19.0+ 产物形如：
 *   <ol class="refs">
 *     <li id="ref-1" data-ref="1" data-doi="10.x/y">Authors. <i>Title</i>. Venue, Year.</li>
 *     ...
 *   </ol>
 *
 * 本模块**只**负责把 References 抽成结构化数据；引用 hover / click 跳转的 DOM 改写
 * 由 ReviewHtmlRenderer 通过 React Portal + CitationBadge 完成（与 markdown 注引
 * 共用一套交互），不在本模块。
 *
 * 与老的 markdown 注引层（citation-references.ts / citation-transform.ts）平行
 * 服务：老 .md review 走 markdown 解析；新 .html review 走本模块。
 */

/** §7 References 表格里的一条结构化元数据 */
export interface ReferenceMeta {
  /** 1-based ref 序号（来自 <li data-ref="N">） */
  refNumber: number
  /** <li> 完整 textContent（normalize whitespace 后） */
  raw: string
  /** 作者段；解析失败时为空串。约定 textContent 形如 `Authors. <i>Title</i>. Venue, Year.` */
  authors: string
  /** 标题段（取 <li> 内首个 <i> 的 textContent；找不到时回落整行剩余） */
  title: string
  /** Venue（标题之后到 year 之前的部分；可空） */
  venue: string
  /** 4 位年份（取最后一个 19xx / 20xx 匹配） */
  year: string
  /** 可选 data-paper-id（业务上对应 Paper 对象 id） */
  paperId?: string
  /** 可选 data-doi */
  doi?: string
  /** 可选 data-zotero-key（综述视图 → Library 联动用） */
  zoteroKey?: string
}

/** 从 <ol class="refs"> 抽 References；找不到时返回空 Map。
 * 仅依赖标准 DOM API；jsdom / happy-dom / 浏览器均可。 */
export function parseReferencesFromHtml(root: ParentNode): Map<number, ReferenceMeta> {
  const out = new Map<number, ReferenceMeta>()
  // 优先找 <ol class="refs">；若不存在则退而找所有 <li[id^="ref-"]>，兼容 skill 偶发 class 漏写
  const liList = root.querySelectorAll<HTMLLIElement>(
    'ol.refs > li[data-ref], section.references li[data-ref], li[id^="ref-"][data-ref]',
  )

  for (const li of Array.from(liList)) {
    const refAttr = li.getAttribute('data-ref')
    if (!refAttr) continue
    const refNumber = Number.parseInt(refAttr, 10)
    if (!Number.isInteger(refNumber) || refNumber <= 0) continue

    const raw = (li.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (raw.length === 0) continue

    const titleEl = li.querySelector('i, em')
    const title = titleEl?.textContent?.trim() ?? ''
    const meta: ReferenceMeta = {
      refNumber,
      raw,
      authors: extractAuthors(raw, title),
      title,
      venue: extractVenue(raw, title),
      year: extractYear(raw),
      paperId: li.getAttribute('data-paper-id') ?? undefined,
      doi: li.getAttribute('data-doi') ?? undefined,
      zoteroKey: li.getAttribute('data-zotero-key') ?? undefined,
    }
    // 同 N 多条 → 取首条；skill contract 不应出现，但容忍
    if (!out.has(refNumber)) out.set(refNumber, meta)
  }

  return out
}

/** 标题前的所有文字（剥掉尾部 `. `）→ authors */
function extractAuthors(raw: string, title: string): string {
  if (!title) return ''
  const titleIdx = raw.indexOf(title)
  if (titleIdx <= 0) return ''
  return raw.slice(0, titleIdx).replace(/[\s.]+$/, '').trim()
}

/** 标题之后到 year 之前（剥首尾 `. ` / `,`）→ venue */
function extractVenue(raw: string, title: string): string {
  if (!title) return ''
  const titleEnd = raw.indexOf(title) + title.length
  if (titleEnd <= 0 || titleEnd >= raw.length) return ''
  const after = raw.slice(titleEnd).replace(/^[\s.,]+/, '').trim()
  // year 可能在末尾或中间；先取掉末尾的 `(YYYY)` / `, YYYY` / ` YYYY`
  const stripped = after.replace(/[\s,(]*(19|20)\d{2}\)?\s*\.?\s*$/i, '').trim()
  // 剥尾部 `. `
  return stripped.replace(/[\s.,]+$/, '').trim()
}

/** 取 raw 里最后一个 4 位年份；找不到时回空串。 */
function extractYear(raw: string): string {
  const matches = raw.match(/(19|20)\d{2}/g)
  if (!matches || matches.length === 0) return ''
  return matches[matches.length - 1]!
}
