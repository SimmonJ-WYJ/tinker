/**
 * workspace_papers_list: 列出当前工作区全部论文（精简字段）
 *
 * 返回字段只保留给 Agent 做主题聚类需要的最小集合：
 *   key / title / authors / year / venue / doi / abstract / tags
 * 剔除：status / starred / pdfRelPath / noteRelPath / sessionRefs / seenCount / ts 等系统字段，
 * 以及 note 全文（需要时走 workspace_papers_get 按 key 拉取）。
 */

import { readPapersJsonl } from './shared.ts'

export interface ListedPaper {
  key: string
  title: string
  authors: string[]
  year: number | null
  venue: string | null
  doi: string | null
  abstract: string | null
  tags: string[]
}

export interface ListResult {
  total: number
  papers: ListedPaper[]
}

export async function handleList(): Promise<ListResult> {
  const all = readPapersJsonl()
  const papers: ListedPaper[] = all.map((e) => ({
    key: e.key,
    title: e.title,
    authors: e.authors,
    year: e.year,
    venue: e.venue,
    doi: e.doi,
    abstract: e.abstract,
    tags: e.tags,
  }))
  return { total: papers.length, papers }
}

export const listToolDefinition = {
  name: 'workspace_papers_list',
  description:
    '列出当前工作区已收集的全部论文，返回精简字段（title/authors/year/venue/doi/abstract/tags）。用于综述方向聚类、主题归纳等场景。如需单篇完整信息（含用户笔记），请再调用 workspace_papers_get。',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
} as const
