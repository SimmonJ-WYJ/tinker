/**
 * Zotero 文献向量索引（语义检索）相关类型
 *
 * 领域背景：
 *   - 向量索引是 wiki 语料（~/.asci/zotero/wiki/）的派生缓存，全局一份、可随时删库重建
 *   - 嵌入由本地 ONNX 模型（multilingual-e5-small）生成，模型权重运行时下载
 *   - 检索模式（mode）三档同时门控索引构建 worker 与 Agent 检索工具注册，便于 A/B 评估：
 *     · vector    ——仅向量：注册 papers_semantic_search，不注册 papers_search_keywords
 *     · papers-rg ——仅关键词：注册 papers_search_keywords(ripgrep)，不注册向量；worker 停
 *     · both      ——两者都给（默认，= 旧 enabled:true）
 *     三档都保留 papers_read_* 深读工具（命中后拉上下文用，与检索入口正交）
 *
 * IPC 通道常量在 zotero.ts 的 ZOTERO_IPC_CHANNELS 中统一管理（PR3 接入）。
 */

/** 嵌入语料层：raw 段落 / llmwiki 逐段摘要 / 篇章级 title+abstract */
export type ZoteroEmbeddingTextKind = 'raw' | 'article' | 'title_abstract'

/**
 * 检索模式（评估三档）：
 *   - 'vector'    仅向量（papers_semantic_search）
 *   - 'papers-rg' 仅关键词（papers_search_keywords，ripgrep）
 *   - 'both'      两者都给（默认）
 */
export type ZoteroRetrievalMode = 'vector' | 'papers-rg' | 'both'

/** 该模式是否启用向量索引（worker 构建 + semantic 工具）：vector / both 为真 */
export function isVectorModeEnabled(mode: ZoteroRetrievalMode): boolean {
  return mode !== 'papers-rg'
}

/** 该模式是否提供 ripgrep 关键词检索工具：papers-rg / both 为真 */
export function isKeywordSearchEnabled(mode: ZoteroRetrievalMode): boolean {
  return mode !== 'vector'
}

/** 向量索引配置（持久化在 ~/.asci/zotero-embedding.json） */
export interface ZoteroEmbeddingConfig {
  /** 检索模式三档（见 ZoteroRetrievalMode）；同时门控 worker 与 Agent 工具注册（每会话判定一次） */
  mode: ZoteroRetrievalMode
  /** worker 并发（CPU 推理，默认 1） */
  concurrency: number
}

export const DEFAULT_ZOTERO_EMBEDDING_CONFIG: ZoteroEmbeddingConfig = {
  mode: 'both',
  concurrency: 1,
}

/** 单篇 PDF 的索引状态（与 article 状态机同构，少一个中间态） */
export type ZoteroEmbeddingPdfStatus =
  | 'idle'       // 未入队
  | 'pending'    // 等待嵌入（含模型未就绪挂起）
  | 'embedding'  // 正在 chunk + 推理 + 写库
  | 'completed'  // 当前内容哈希已入库
  | 'failed'     // 嵌入失败（可重试）
  | 'skipped'    // 源文件缺失等不可恢复原因跳过

/** 嵌入模型权重下载状态机（与 AsrWeightStatus 同构） */
export type ZoteroEmbeddingModelState =
  | 'missing'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'error'

export interface ZoteroEmbeddingModelProgress {
  /** 当前正在下载的文件名（模型分多文件） */
  file: string
  bytesDone: number
  bytesTotal: number
  etaSeconds?: number
}

export interface ZoteroEmbeddingModelStatus {
  modelId: string
  displayName: string
  state: ZoteroEmbeddingModelState
  progress?: ZoteroEmbeddingModelProgress
  error?: string
  /** ready 时的本地模型目录 */
  modelPath?: string
  /** 全部文件估算总大小（进度条用） */
  expectedBytes: number
}

/** 推送给设置页的索引状态摘要 */
export interface ZoteroEmbeddingStatusSummary {
  mode: ZoteroRetrievalMode
  modelState: ZoteroEmbeddingModelState
  total: number
  byStatus: Record<ZoteroEmbeddingPdfStatus, number>
  /** 正在嵌入的 attachmentKey */
  runningKeys: string[]
  /** 最近失败的 key + 原因（最多保留 5 条） */
  recentFailed: Array<{ attachmentKey: string; error: string }>
  /** 索引库当前 chunk 总数 */
  chunkCount: number
}

/** papers_semantic_search 的单条命中（也是未来 UI 搜索的复用结构） */
export interface ZoteroSemanticSearchHit {
  /** = attachmentKey，与 papers-rg 其它工具的 paperId 约定一致 */
  paperId: string
  textKind: ZoteroEmbeddingTextKind
  /**
   * 锚点格式：
   *   - 段落锚点（structured/article md）："p3_1"（<p id> 值）
   *   - 字节偏移锚点（lite md，无 <p id>）："b12345"（body 内字节偏移）
   *   - title_abstract 层：null
   */
  anchorStart: string | null
  anchorEnd: string | null
  /**
   * 顶层章节号（= 锚点 "pS_P" 的 S）；按 structured/article 一级 heading "# N. Title" 派生。
   * 字节偏移锚点（lite md）/ title_abstract 层无章节 → null。
   */
  sectionIndex: number | null
  /**
   * 章节标题（如 "Methods"，去编号前缀）；来自 structured/article 的 "# N. Title"。
   * 无章节归属（lite raw / title_abstract）或标题缺失 → null。
   */
  sectionTitle: string | null
  /** chunk 原文（证据回写时作 snapshotText） */
  snippet: string
  /** RRF 融合分（仅用于本次结果内排序，无绝对意义、跨查询不可比） */
  score: number
  /**
   * 向量路原始余弦相似度（由 vec0 L2 距离换算 cos=1−d²/2，依赖 E5 单位向量）。
   * 该 chunk 未被向量路召回（纯 FTS 命中 / 向量不可用）→ null。
   * 相对信号：E5-small 同领域文本余弦偏挤（~0.78–0.89），勿作硬全局阈值。
   */
  rawCosine: number | null
  /**
   * FTS 路原始 BM25 分（SQLite FTS5，越负越相关；≈0 为常见词凑出的弱匹配）。
   * 该 chunk 未被 FTS 路召回 / 查询无可用词项 → null。词面相关性信号比余弦更分得开。
   */
  rawBm25: number | null
}

/** 检索降级原因：模型未就绪 / 索引为空 */
export type ZoteroSemanticSearchDegraded = 'model_not_ready' | 'index_empty'

export interface ZoteroSemanticSearchResult {
  query: string
  modelId: string
  total: number
  degraded?: ZoteroSemanticSearchDegraded
  hits: ZoteroSemanticSearchHit[]
}
