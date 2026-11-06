/**
 * DOI → 元数据即时查询（spec: docs/specs/doi-paper-jump-spec.md §5.3）
 *
 * 对话流 / 检索报告里点击的 DOI 未命中「本次检索」时，主进程直查单篇元数据并映射成
 * PaperRecord，renderer 据此打开临时详情页。
 *
 * 数据源策略（全部确定性 REST，不过 Agent）：
 *   - 核心元数据走 crossref /works/{doi}（title / authors / year / venue / citedBy）
 *   - 摘要：crossref 对部分出版商（Nature / Optica 等）不提供 abstract 字段，故 crossref
 *     缺摘要时依次 fallback OpenAlex（重构 abstract_inverted_index）→ Semantic Scholar，
 *     第一个命中即停（实测三篇全缺 crossref 摘要的论文可由 fallback 补回）
 *
 * 设计要点：
 *   - 结果**不写入** session papers JSONL —— 保护检索报告统计口径（≥20/≥50 阈值、各源计数）
 *   - record.source 固定 'doi-lookup'，不冒充 MCP 检索来源
 *   - 每个源独立超时 + try/catch；crossref 失败才整体 error，fallback 源失败仅静默跳过
 */

import type { PaperRecord, PapersLookupDoiMetadataResult } from '@asci/shared'
import { nowIso, sanitizeText } from '@asci/shared'

/** crossref / OpenAlex etiquette：带 mailto 可进 polite pool（更稳的限流配额） */
const CONTACT_EMAIL = 'dev@opensci.io'
const CROSSREF_USER_AGENT = `ASCI (mailto:${CONTACT_EMAIL})`
/** crossref 核心查询超时（ms）—— 超时即走 renderer 的 doi.org 外链兜底，不让用户干等 */
const CORE_TIMEOUT_MS = 5000
/** 摘要 fallback 各源超时（ms）—— 仅 crossref 缺摘要时才触发，单独限时避免拖长总耗时 */
const ABSTRACT_TIMEOUT_MS = 4000

/**
 * 进程内 DOI 查询缓存（LRU，cap 256）。同一未命中 DOI 反复点击不再重打网络。
 * key = 归一化 DOI；只缓存「成功且非瞬时失败」的 record（见 lookupDoiMetadata）。
 * 主进程生命周期内有效；退出即清（符合「历史查询」语义，元数据稳定无需失效）。
 */
const CACHE_MAX = 256
const cache = new Map<string, PaperRecord>()

/** 读缓存并提升为最新（LRU） */
function cacheGet(doi: string): PaperRecord | undefined {
  const hit = cache.get(doi)
  if (hit) {
    cache.delete(doi)
    cache.set(doi, hit)
  }
  return hit
}

/** 写缓存，超 cap 淘汰最旧 */
function cacheSet(doi: string, record: PaperRecord): void {
  cache.set(doi, record)
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
}

/** crossref /works/{doi} 响应里实际消费的字段（其余忽略） */
interface CrossrefWork {
  title?: string[]
  author?: Array<{ given?: string; family?: string; name?: string }>
  issued?: { 'date-parts'?: number[][] }
  'container-title'?: string[]
  DOI?: string
  URL?: string
  abstract?: string
  'is-referenced-by-count'?: number
}

/**
 * 剥 HTML/JATS 标签 + 解实体 + 去控制/不可见字符（crossref title 含 <i>/<scp>，
 * abstract 是 JATS XML；统一走 @asci/shared 的 sanitizeText 唯一真相源）。
 */
const stripMarkup = sanitizeText

/** crossref author → "Given Family" 显示名；机构作者用 name 字段 */
function formatAuthor(a: { given?: string; family?: string; name?: string }): string | null {
  if (a.name) return a.name
  const parts = [a.given, a.family].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : null
}

/** crossref work → PaperRecord（缺字段一律容错为 null / 空数组；abstract 可能为 null 待 fallback 补） */
function toPaperRecord(work: CrossrefWork, doi: string): PaperRecord {
  const year = work.issued?.['date-parts']?.[0]?.[0]
  const citedBy = work['is-referenced-by-count']
  return {
    ts: nowIso(),
    query: null,
    source: 'doi-lookup',
    title: (work.title?.[0] ? stripMarkup(work.title[0]) : '') || '(无标题)',
    authors: (work.author ?? [])
      .map(formatAuthor)
      .filter((name): name is string => name !== null),
    year: typeof year === 'number' ? year : null,
    venue: work['container-title']?.[0] ?? null,
    doi: work.DOI ?? doi,
    url: work.URL ?? `https://doi.org/${doi}`,
    abstract: work.abstract ? stripMarkup(work.abstract) : null,
    extra: typeof citedBy === 'number' ? { citedBy } : undefined,
  }
}

/**
 * 单源取摘要的三态结果（区分「真没有」与「超时/限流取失败」，供 UI 决定显示「暂无」还是「可重试」）：
 *   - ok    —— 拿到非空摘要
 *   - empty —— 源正常响应但确实没有摘要（含 404：该源无此论文）
 *   - error —— 网络 / 超时 / 限流(非 2xx) / 解析异常（可能其实有，重试或换源或许能拿到）
 */
type AbstractFetch =
  | { kind: 'ok'; text: string }
  | { kind: 'empty' }
  | { kind: 'error' }

/** OpenAlex 的 abstract_inverted_index（{ 词: [位置...] }）重构回正文 */
function reconstructInvertedIndex(inv: Record<string, number[]>): string {
  const slots: string[] = []
  for (const [word, positions] of Object.entries(inv)) {
    for (const pos of positions) slots[pos] = word
  }
  return slots.filter((w) => w !== undefined).join(' ').trim()
}

/** OpenAlex 取摘要（重构倒排索引）。404 视作 empty，其余非 2xx / 异常视作 error */
async function fetchOpenAlexAbstract(doi: string): Promise<AbstractFetch> {
  try {
    const res = await fetch(
      `https://api.openalex.org/works/https://doi.org/${encodeURIComponent(doi)}?mailto=${CONTACT_EMAIL}`,
      { signal: AbortSignal.timeout(ABSTRACT_TIMEOUT_MS) },
    )
    if (res.status === 404) return { kind: 'empty' }
    if (!res.ok) return { kind: 'error' }
    const body = (await res.json()) as { abstract_inverted_index?: Record<string, number[]> | null }
    if (!body.abstract_inverted_index) return { kind: 'empty' }
    const text = reconstructInvertedIndex(body.abstract_inverted_index)
    return text.length > 0 ? { kind: 'ok', text } : { kind: 'empty' }
  } catch {
    return { kind: 'error' }
  }
}

/** Semantic Scholar 取摘要。404 视作 empty，限流(429)/其余非 2xx / 异常视作 error */
async function fetchSemanticScholarAbstract(doi: string): Promise<AbstractFetch> {
  try {
    const res = await fetch(
      `https://api.semanticscholar.org/graph/v1/paper/DOI:${encodeURIComponent(doi)}?fields=abstract`,
      { signal: AbortSignal.timeout(ABSTRACT_TIMEOUT_MS) },
    )
    if (res.status === 404) return { kind: 'empty' }
    if (!res.ok) return { kind: 'error' }
    const body = (await res.json()) as { abstract?: string | null }
    const text = body.abstract?.trim()
    return text && text.length > 0 ? { kind: 'ok', text } : { kind: 'empty' }
  } catch {
    return { kind: 'error' }
  }
}

/** 摘要补全结果：拿到正文，或没拿到时标明是「源真没有」还是「取失败可重试」 */
interface AbstractFallback {
  text: string | null
  /** text 为 null 时为 true 表示至少一个源报错/超时（非「真没有」）；UI 据此引导重试 */
  failed: boolean
}

/**
 * crossref 缺摘要时的兜底：OpenAlex 与 Semantic Scholar **并行**发起（串行会让某源的
 * 超时白白拖累另一源，实测 OpenAlex 偶发卡满 4s）。取摘要时优先 OpenAlex，其次 S2；
 * 都没拿到时，只要有一个源是 error（超时/限流/网络）就标 failed=true。
 */
async function fetchAbstractFallback(doi: string): Promise<AbstractFallback> {
  const [openAlex, semanticScholar] = await Promise.all([
    fetchOpenAlexAbstract(doi),
    fetchSemanticScholarAbstract(doi),
  ])
  if (openAlex.kind === 'ok') return { text: openAlex.text, failed: false }
  if (semanticScholar.kind === 'ok') return { text: semanticScholar.text, failed: false }
  const failed = openAlex.kind === 'error' || semanticScholar.kind === 'error'
  return { text: null, failed }
}

/**
 * 按 DOI 查元数据。永不抛错：crossref 404 → not-found，网络/超时/解析异常 → error。
 * 入参应为已归一化 DOI（renderer 侧 normalizeDoi 产物）；此处不再校验格式。
 */
export async function lookupDoiMetadata(doi: string): Promise<PapersLookupDoiMetadataResult> {
  const cached = cacheGet(doi)
  if (cached) return { status: 'found', record: cached }
  try {
    const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
      signal: AbortSignal.timeout(CORE_TIMEOUT_MS),
      headers: { 'User-Agent': CROSSREF_USER_AGENT },
    })
    if (res.status === 404) return { status: 'not-found' }
    if (!res.ok) {
      return { status: 'error', message: `crossref HTTP ${res.status}` }
    }
    const body = (await res.json()) as { message?: CrossrefWork }
    if (!body.message) {
      return { status: 'error', message: 'crossref 响应缺少 message 字段' }
    }
    const record = toPaperRecord(body.message, doi)
    // crossref 对部分出版商不提供摘要 → 并行换源补；都没拿到时区分「真没有」与「取失败」
    if (!record.abstract) {
      const fallback = await fetchAbstractFallback(doi)
      if (fallback.text) {
        // 兜底源（OpenAlex 倒排重构 / S2）摘要同样过 sanitizeText，与 crossref 路径一致
        record.abstract = stripMarkup(fallback.text) || null
      } else if (fallback.failed) {
        // 标记瞬时失败，UI 显示「可重试」而非「不可获取」（错误必须可见）
        record.extra = { ...record.extra, abstractStatus: 'failed' }
      }
    }
    // 只缓存「成功且非瞬时失败」——failed 不缓存，否则用户重试永远拿到旧失败结果
    if (record.extra?.abstractStatus !== 'failed') cacheSet(doi, record)
    return { status: 'found', record }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn('[doi-lookup] crossref 查询失败:', message)
    return { status: 'error', message }
  }
}

/** 测试钩子：清进程内缓存（module-level 状态会跨测试泄漏，beforeEach 调） */
export function __clearCacheForTest(): void {
  cache.clear()
}

/** 测试钩子：导出纯映射函数（fetch 路径由集成环境覆盖） */
export {
  toPaperRecord as __toPaperRecordForTest,
  reconstructInvertedIndex as __reconstructInvertedIndexForTest,
}
