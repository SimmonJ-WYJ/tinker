/**
 * 引用图谱数据源（Provider）统一契约
 *
 * v1 实现：OpenAlex（直连 REST）
 * v2 实现：paper-search MCP（接入后通过 provider-registry 切换）
 *
 * 引入 BasePaperNode 作为 provider 的返回类型，仅包含论文"身份"字段；
 * 图谱角色（kind）、库内标记（inLibrary）、Zotero 链接（linkedZoteroKey）
 * 由 service 层在 enrich 阶段填充，保持 provider 关注点单一。
 */

import type { CitationGraphSeedInput } from '@asci/shared'

/** 论文身份节点（provider 层返回的基础信息，不含图谱上下文） */
export interface BasePaperNode {
  /** 统一 ID，格式 `{provider}:{externalId}`，v1 为 `openalex:W...` */
  id: string
  title: string
  authors: string[]
  year: number | null
  venue: string | null
  doi: string | null
  url: string | null
  citedByCount: number | null
}

/** Provider 统一接口 */
export interface CitationProvider {
  readonly id: 'openalex' | 'paper-search'
  /** 解析 seed 输入为单个论文节点 */
  resolveSeed(input: CitationGraphSeedInput, signal?: AbortSignal): Promise<BasePaperNode>
  /** 获取指定论文的 references（这篇引用了谁） */
  getReferences(paperId: string, limit: number, signal?: AbortSignal): Promise<BasePaperNode[]>
  /** 获取指定论文的 cited_by（谁引用了这篇），按被引数降序 */
  getCitedBy(paperId: string, limit: number, signal?: AbortSignal): Promise<BasePaperNode[]>
}
