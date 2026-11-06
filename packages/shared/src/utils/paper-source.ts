/**
 * 论文检索来源归一化
 *
 * PaperRecord.source 由 paper-result-recorder 的 buildSourceTag 写入，
 * 原始形态如：
 *   tool:mcp__paper-search__arxiv_search
 *   tool:mcp__paper-search__pubmed_efetch
 *   tool:mcp__paper-search__openalex_works
 *   tool:WebFetch
 *   tool:Skill:paper-lookup
 *
 * 本工具把它映射为 UI 可直接当复选项的归一化标签，方便检索结果列表的来源筛选。
 * 匹配按顺序优先：先具名 API（arxiv/pubmed/openalex/s2），再泛型 web，最后 other 兜底。
 */

export type NormalizedPaperSource =
  | 'arxiv'
  | 'pubmed'
  | 'openalex'
  | 'semanticscholar'
  | 'crossref'
  | 'dblp'
  | 'iacr'
  | 'biorxiv'
  | 'europepmc'
  | 'core'
  | 'ieee'
  | 'web'
  | 'journal'
  | 'other'

/** UI 上常驻展示的来源（即便当前数据中没出现也保留勾选位） */
export const COMMON_PAPER_SOURCES: readonly NormalizedPaperSource[] = [
  'arxiv',
  'pubmed',
  'openalex',
] as const

export function normalizePaperSource(rawSource: string | null | undefined): NormalizedPaperSource {
  if (typeof rawSource !== 'string' || rawSource.length === 0) return 'other'
  const s = rawSource.toLowerCase()

  // biorxiv / medrxiv — 放在 arxiv 前避免 "biorxiv" 被 includes('arxiv') 误匹配
  if (s.includes('biorxiv') || s.includes('medrxiv')) return 'biorxiv'

  // arxiv（含 arxiv_search / arxiv_fetch / arxiv.org URL）
  if (s.includes('arxiv')) return 'arxiv'

  // europepmc — 放在 pubmed/pmc 前避免被 includes('pmc') 误匹配
  if (s.includes('europepmc')) return 'europepmc'

  // pubmed / pmc / ncbi
  if (s.includes('pubmed') || s.includes('pmc') || s.includes('ncbi')) return 'pubmed'

  // openalex
  if (s.includes('openalex')) return 'openalex'

  // semantic scholar（s2 是官方简称；用 [非字母数字] 当边界，避免误伤 tools2xx 等）
  if (s.includes('semantic') || /(^|[^a-z0-9])s2([^a-z0-9]|$)/.test(s)) {
    return 'semanticscholar'
  }

  // crossref
  if (s.includes('crossref')) return 'crossref'

  // dblp
  if (s.includes('dblp')) return 'dblp'

  // iacr — 密码学预印本
  if (s.includes('iacr')) return 'iacr'

  // core
  if (s.includes('core_') || /(^|[^a-z0-9])core([^a-z0-9]|$)/.test(s)) return 'core'

  // ieee / acm
  if (s.includes('ieee') || s.includes('acm')) return 'ieee'

  // 泛网络抓取
  if (s.includes('webfetch') || s.includes('websearch') || s.includes(':web')) return 'web'

  // OPENSCI 自建期刊语料源（连接器 source="journal"，工具标签含 journal）
  if (s.includes('journal')) return 'journal'

  return 'other'
}
