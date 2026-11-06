/**
 * OpenAlex 引用图谱 Provider（v1 数据源）
 *
 * - 端点：https://api.openalex.org
 * - 无需 API Key，通过 User-Agent 附 mailto 进入 polite pool 提速
 * - 三个能力：
 *   1. resolveSeed：接受 doi / openalexId / arxivId / title，返回 seed 节点
 *   2. getReferences：读 seed work 的 referenced_works，按 id 批量拉详情
 *   3. getCitedBy：filter=cites:{id}，sort=cited_by_count:desc
 *
 * 节点 ID 统一为 `openalex:W...`，为后续切 paper-search MCP 预留前缀空间。
 */

import type { CitationGraphSeedInput } from '@asci/shared'
import { getEffectiveProxyUrl } from '../../proxy-settings-service'
import { getFetchFn } from '../../proxy-fetch'
import type { BasePaperNode, CitationProvider } from './types'

const OPENALEX_BASE = 'https://api.openalex.org'
// 进入 polite pool 的通用 mailto（开源项目标识）
const POLITE_UA = 'ASCI-Alpha/0.1 (mailto:asci-alpha@users.noreply.github.com)'

// ===== 类型：OpenAlex work 对象的关键字段（只声明我们用的部分） =====

interface OpenAlexWork {
  id: string // https://openalex.org/W...
  doi: string | null
  title: string | null
  display_name: string | null
  publication_year: number | null
  cited_by_count: number | null
  authorships?: Array<{ author?: { display_name?: string | null } | null }>
  host_venue?: { display_name?: string | null } | null
  primary_location?: {
    landing_page_url?: string | null
    source?: { display_name?: string | null } | null
  } | null
  best_oa_location?: { landing_page_url?: string | null; pdf_url?: string | null } | null
  referenced_works?: string[]
}

interface OpenAlexListResponse {
  results: OpenAlexWork[]
  meta?: { count?: number }
}

// ===== 工具函数 =====

/** 从 OpenAlex URL 或纯 ID 提取短 ID（W...） */
function extractShortId(input: string): string {
  const trimmed = input.trim()
  const match = trimmed.match(/W\d+/i)
  return match ? match[0].toUpperCase() : trimmed
}

/** OpenAlex ID → 统一节点 id */
function toNodeId(shortOrUrl: string): string {
  return `openalex:${extractShortId(shortOrUrl)}`
}

/** 规范化 DOI（去前缀、小写） */
function normalizeDoi(doi: string): string {
  return doi
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:/i, '')
    .toLowerCase()
}

/** 构造 polite 请求头 */
function politeHeaders(): Record<string, string> {
  return {
    'User-Agent': POLITE_UA,
    Accept: 'application/json',
  }
}

/** 统一的 fetch 调用（带代理 + 错误映射） */
async function openAlexFetch<T>(path: string, signal?: AbortSignal): Promise<T> {
  const proxyUrl = await getEffectiveProxyUrl()
  const fetchFn = getFetchFn(proxyUrl)
  const url = path.startsWith('http') ? path : `${OPENALEX_BASE}${path}`

  const response = await fetchFn(url, {
    headers: politeHeaders(),
    signal,
  })

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`OpenAlex 未找到对应资源（404）：${url}`)
    }
    if (response.status === 429) {
      throw new Error('OpenAlex 请求频率过高（429），请稍后再试')
    }
    throw new Error(`OpenAlex 请求失败 ${response.status}：${url}`)
  }

  return (await response.json()) as T
}

/** OpenAlex work → BasePaperNode */
function workToNode(work: OpenAlexWork): BasePaperNode {
  const authors =
    work.authorships
      ?.map((a) => a.author?.display_name?.trim())
      .filter((n): n is string => Boolean(n && n.length > 0)) ?? []

  const venue =
    work.host_venue?.display_name?.trim() ||
    work.primary_location?.source?.display_name?.trim() ||
    null

  const title = (work.title || work.display_name || '').trim() || '(无标题)'

  // DOI 归一化（OpenAlex 返回的 doi 是完整 URL）
  const doi = work.doi ? normalizeDoi(work.doi) : null

  // 原文链接优先级：DOI URL > best OA landing > primary landing
  let url: string | null = null
  if (doi) {
    url = `https://doi.org/${doi}`
  } else if (work.best_oa_location?.landing_page_url) {
    url = work.best_oa_location.landing_page_url
  } else if (work.primary_location?.landing_page_url) {
    url = work.primary_location.landing_page_url
  }

  return {
    id: toNodeId(work.id),
    title,
    authors,
    year: work.publication_year ?? null,
    venue,
    doi,
    url,
    citedByCount: work.cited_by_count ?? null,
  }
}

// ===== Provider 实现 =====

export const openAlexProvider: CitationProvider = {
  id: 'openalex',

  async resolveSeed(input: CitationGraphSeedInput, signal): Promise<BasePaperNode> {
    // 优先级：openalexId > doi > arxivId > title
    if (input.openalexId?.trim()) {
      const shortId = extractShortId(input.openalexId)
      const work = await openAlexFetch<OpenAlexWork>(`/works/${shortId}`, signal)
      return workToNode(work)
    }

    if (input.doi?.trim()) {
      const doi = normalizeDoi(input.doi)
      const work = await openAlexFetch<OpenAlexWork>(`/works/doi:${encodeURIComponent(doi)}`, signal)
      return workToNode(work)
    }

    if (input.arxivId?.trim()) {
      const arxivId = input.arxivId.trim().replace(/^arxiv:/i, '')
      const resp = await openAlexFetch<OpenAlexListResponse>(
        `/works?filter=ids.arxiv:${encodeURIComponent(arxivId)}&per-page=1`,
        signal,
      )
      const first = resp.results?.[0]
      if (!first) {
        throw new Error(`OpenAlex 未找到 arXiv 论文：${arxivId}`)
      }
      return workToNode(first)
    }

    if (input.title?.trim()) {
      const title = input.title.trim()
      const resp = await openAlexFetch<OpenAlexListResponse>(
        `/works?search=${encodeURIComponent(title)}&per-page=1`,
        signal,
      )
      const first = resp.results?.[0]
      if (!first) {
        throw new Error(`OpenAlex 按标题未找到论文：${title}`)
      }
      return workToNode(first)
    }

    throw new Error('seed 输入为空，至少需要 doi / openalexId / arxivId / title 其中之一')
  },

  async getReferences(paperId: string, limit: number, signal): Promise<BasePaperNode[]> {
    if (limit <= 0) return []

    // 先获取 seed work 的 referenced_works
    const shortId = extractShortId(paperId)
    const work = await openAlexFetch<OpenAlexWork>(`/works/${shortId}`, signal)
    const refIds = (work.referenced_works ?? []).map(extractShortId).filter(Boolean).slice(0, limit)

    if (refIds.length === 0) return []

    // OpenAlex filter 支持 openalex_id:W1|W2|... 的 OR 语法（单次 URL 控制在 ~50 个以内）
    const filterValue = refIds.join('|')
    const perPage = Math.min(refIds.length, 200)
    const resp = await openAlexFetch<OpenAlexListResponse>(
      `/works?filter=openalex_id:${filterValue}&per-page=${perPage}`,
      signal,
    )

    return resp.results.map(workToNode)
  },

  async getCitedBy(paperId: string, limit: number, signal): Promise<BasePaperNode[]> {
    if (limit <= 0) return []

    const shortId = extractShortId(paperId)
    const perPage = Math.min(limit, 200)
    const resp = await openAlexFetch<OpenAlexListResponse>(
      `/works?filter=cites:${shortId}&sort=cited_by_count:desc&per-page=${perPage}`,
      signal,
    )

    return resp.results.map(workToNode)
  },
}
