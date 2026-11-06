/**
 * 引用图谱（Citation Graph）相关类型与 IPC 通道常量
 *
 * 以某篇论文为中心，向前（references，这篇引用了谁）与向后（cited_by，谁引用了这篇）
 * 展开两层（2-hop）关系图，用于在文献库、论文详情 preview、论文摘要详情 preview
 * 三个位置提供统一的图谱入口。
 *
 * v1 数据源：OpenAlex（无 key、免费）
 * v2 数据源：paper-search MCP（接入后通过 provider-registry 切换，类型层不变）
 */

import type { LinkZoteroPdfStatus } from './agent.ts'

// ===== 核心实体 =====

/** 节点在图中的角色 */
export type CitationNodeKind = 'seed' | 'reference' | 'cited_by' | 'hop2'

/** 图节点（对应一篇论文） */
export interface CitationGraphNode {
  /** 全局稳定 ID，格式 `{provider}:{externalId}`，v1 为 `openalex:W...` */
  id: string
  /** 节点角色（用于视觉区分） */
  kind: CitationNodeKind
  title: string
  authors: string[]
  year: number | null
  venue: string | null
  doi: string | null
  /** 原文链接（优先 DOI URL，其次 open-access URL） */
  url: string | null
  /** 被引次数（OpenAlex cited_by_count，用于节点尺寸缩放） */
  citedByCount: number | null
  /** 是否已在工作区论文库里（UI 加绿色外框） */
  inLibrary: boolean
  /** 是否已链接到 Zotero（节点角标"已加入"） */
  linkedZoteroKey: string | null
}

/** 边方向：backward = source 引用了 target；forward = source 被 target 引用 */
export type CitationEdgeKind = 'references' | 'cited_by'

/** 图边 */
export interface CitationGraphEdge {
  /** source 与 target 均为节点 id */
  source: string
  target: string
  kind: CitationEdgeKind
  /** 属于第几跳（1 或 2） */
  hop: 1 | 2
}

// ===== 构建流程 =====

/** 图谱构建阶段 */
export type CitationGraphStage = 'seed' | 'references' | 'cited_by' | 'hop2'

/** 阶段状态 */
export type CitationGraphStageStatus = 'pending' | 'running' | 'done' | 'skipped' | 'error'

/** 构建输入：任一标识都可以，由 provider 负责解析为 seed 节点 */
export interface CitationGraphSeedInput {
  doi?: string | null
  openalexId?: string | null
  arxivId?: string | null
  title?: string | null
}

/** 构建请求（renderer → main） */
export interface CitationGraphBuildRequest {
  /** 请求 ID，用于流式事件路由（支持多图谱并发） */
  requestId: string
  seed: CitationGraphSeedInput
  /** 一层 references 上限，默认 40 */
  refsLimit?: number
  /** 一层 cited_by 上限，默认 25 */
  citedByLimit?: number
  /** 触发二跳展开的 top N 节点数，默认 8 */
  hop2TopN?: number
  /** 每个 hop1 父节点在二跳中继续展开的 references 数，默认 5 */
  hop2RefsPerNode?: number
  /** 每个 hop1 父节点在二跳中继续展开的 cited_by 数，默认 3 */
  hop2CitedByPerNode?: number
  /** 工作区 id（用于标记 inLibrary / 回填 linkedZoteroKey） */
  workspaceId?: string | null
}

/** 构建响应（仅用作 ack，真实数据走流式事件） */
export interface CitationGraphBuildAck {
  requestId: string
  accepted: boolean
  message?: string
}

// ===== 流式事件（main → renderer）=====

export type CitationGraphStreamEvent =
  | {
      type: 'stage'
      requestId: string
      stage: CitationGraphStage
      status: CitationGraphStageStatus
      /** 人类可读的阶段消息（如 "已获取 40 条引用"） */
      message?: string
    }
  | {
      type: 'seed'
      requestId: string
      node: CitationGraphNode
    }
  | {
      type: 'nodes'
      requestId: string
      nodes: CitationGraphNode[]
    }
  | {
      type: 'edges'
      requestId: string
      edges: CitationGraphEdge[]
    }
  | {
      type: 'done'
      requestId: string
      /** 是否达到节点上限触发截断 */
      truncated: boolean
    }
  | {
      type: 'error'
      requestId: string
      message: string
      stage?: CitationGraphStage
    }

// ===== IPC 通道 =====

export const CITATION_GRAPH_IPC_CHANNELS = {
  /** 启动图谱构建（invoke，返回 Ack） */
  BUILD: 'citation-graph:build',
  /** 取消正在进行的构建（invoke） */
  CANCEL: 'citation-graph:cancel',
  /** 主进程推送的流式事件（webContents.send） */
  STREAM_EVENT: 'citation-graph:stream-event',
  /** 清除图谱缓存（invoke） */
  CLEAR_CACHE: 'citation-graph:clear-cache',
  /** 将图谱节点直接加入 Zotero（invoke） */
  ADD_TO_ZOTERO: 'citation-graph:add-to-zotero',
} as const

/** 将图谱节点直接写入 Zotero 的输入（不依赖工作区论文库） */
export interface CitationGraphAddToZoteroInput {
  title: string
  authors: string[]
  year: number | null
  venue: string | null
  doi: string | null
  url: string | null
  /** 可选标签 */
  tags?: string[]
  /**
   * 目标 treeViewID（connector updateSession）：null/未传=Zotero UI 选中；'L1'=「我的文献库」根；'C<整数>'=指定 collection
   */
  targetTreeViewID?: string | null
}

export interface CitationGraphAddToZoteroResult {
  /** Zotero 8 字符 key */
  key: string
  /** OA PDF 自动下载结果（与 workspacePapers.linkZotero 一致） */
  pdfStatus: LinkZoteroPdfStatus
}

/** 清除缓存的作用域 */
export interface CitationGraphClearCacheInput {
  /**
   * - 'all'：清空所有缓存
   * - 'one'：按 seed + 展开参数清除一条；需要提供 seed 与 params
   */
  scope: 'all' | 'one'
  seed?: CitationGraphSeedInput
  refsLimit?: number
  citedByLimit?: number
  hop2TopN?: number
  hop2RefsPerNode?: number
  hop2CitedByPerNode?: number
}

export interface CitationGraphClearCacheResult {
  cleared: number
}

export type CitationGraphIpcChannel =
  typeof CITATION_GRAPH_IPC_CHANNELS[keyof typeof CITATION_GRAPH_IPC_CHANNELS]
