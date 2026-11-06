/**
 * 向量索引对外门面
 *
 * 单例（队列 + 索引库 + 嵌入器 + 模型服务接线）+ 启动恢复扫描 + parser/article 联动钩子
 * + 状态查询 + 语义检索入口（papers_semantic_search 工具消费）。
 *
 * 关键不变量：
 *   - 只有 enabled（评估总开关）时才创建队列与入队；关闭时 worker 停止且
 *     papers_semantic_search 不注册（agent-orchestrator 每会话判定）
 *   - 模型未就绪时任务挂 waitingForModel，模型 ready 事件触发补入队；
 *     检索此时降级为纯 FTS（degraded='model_not_ready'）而非报错
 *   - 索引库 = 可重建缓存：rebuildAll 清空后全量重扫
 */

import type {
  ZoteroEmbeddingPdfStatus,
  ZoteroEmbeddingStatusSummary,
  ZoteroEmbeddingTextKind,
  ZoteroSemanticSearchResult,
} from '@asci/shared'
import { isVectorModeEnabled } from '@asci/shared'
import { loadSnapshot } from '../zotero-pdf-parser/snapshot-store.ts'
import type { ZoteroPdfSnapshot } from '../zotero-pdf-parser/snapshot-store.ts'
import { getEmbeddingModelService } from '../embedding-model-service.ts'
import {
  getZoteroVectorIndexPath,
  getZoteroWikiArticleMdPath,
  getZoteroWikiMdPath,
  getZoteroWikiStructuredTxtPath,
} from '../config-paths.ts'
// 限并发队列与 article 生成器同构，直接复用（避免第三份拷贝）
import { ArticleQueue as LimitedQueue } from '../zotero-article-generator/queue.ts'
import { loadEmbeddingConfig, saveEmbeddingConfig } from './config.ts'
import { E5Embedder, EMBEDDING_MODEL } from './embedder.ts'
import { ZoteroVectorDb } from './vector-db.ts'
import { defaultFsDeps, runOne } from './worker.ts'
import type { ZoteroEmbeddingConfig } from '@asci/shared'

let queue: LimitedQueue | null = null
let vdb: ZoteroVectorDb | null = null
let embedder: E5Embedder | null = null
let embedderLoading: Promise<E5Embedder> | null = null
let statusListener: ((summary: ZoteroEmbeddingStatusSummary) => void) | null = null
let modelListenerWired = false

/** 内存态单篇状态（completed 由库内 hash 派生，此处只记进行中/失败） */
const keyStatus = new Map<string, { status: ZoteroEmbeddingPdfStatus; error?: string }>()
/** 模型未就绪时积压的 key，ready 后补入队 */
const waitingForModel = new Set<string>()

/** 由 main/index.ts 在 parser worker 启动后调用 */
export function startZoteroEmbeddingIndexWorker(): void {
  const config = loadEmbeddingConfig()
  wireModelListener()
  if (!isVectorModeEnabled(config.mode)) {
    console.log(`[向量索引] 模式=${config.mode}（不含向量），worker 不启动`)
    return
  }
  ensureQueue(config)
  ensureModelReadyInBackground()
  enqueueScan()
}

export function stopZoteroEmbeddingIndexWorker(): void {
  queue?.stop()
  queue = null
  waitingForModel.clear()
  keyStatus.clear()
  console.log('[向量索引] worker 已停止')
}

/**
 * parser 写完 md / article 生成完成后的钩子（事件驱动增量）。
 * worker 内部按 content_hash 判定是否真的需要重嵌，重复调用无害。
 */
export function onEmbedSourceReady(attachmentKey: string): void {
  const config = loadEmbeddingConfig()
  if (!isVectorModeEnabled(config.mode) || !queue) return
  enqueueKey(attachmentKey)
}

/** Zotero 源删除联动：清掉该篇全部层 */
export function onEmbedSourceDeleted(attachmentKey: string): void {
  waitingForModel.delete(attachmentKey)
  keyStatus.delete(attachmentKey)
  try {
    getVdb().deleteByAttachmentKey(attachmentKey)
    console.log(`[向量索引] 🗑 已清理 ${attachmentKey} 的索引`)
  } catch (err) {
    console.warn(`[向量索引] 清理 ${attachmentKey} 失败:`, err)
  }
  emitStatusChanged()
}

export function getEmbeddingConfig(): ZoteroEmbeddingConfig {
  return loadEmbeddingConfig()
}

/** 写配置；enabled 切换做对应启停（评估开关语义见 config.ts 头注释） */
export function setEmbeddingConfig(patch: Partial<ZoteroEmbeddingConfig>): ZoteroEmbeddingConfig {
  const before = isVectorModeEnabled(loadEmbeddingConfig().mode)
  const next = saveEmbeddingConfig(patch)
  const after = isVectorModeEnabled(next.mode)

  // 向量开关跨档切换才启停 worker（papers-rg ↔ vector/both）
  if (before && !after) {
    stopZoteroEmbeddingIndexWorker()
  } else if (!before && after) {
    startZoteroEmbeddingIndexWorker()
  }
  emitStatusChanged()
  return next
}

/** 清空索引库并全量重扫（设置页"重建索引"按钮） */
export function rebuildAllEmbeddings(): number {
  const config = loadEmbeddingConfig()
  if (!isVectorModeEnabled(config.mode)) {
    console.log(`[向量索引] rebuildAll: 模式=${config.mode}（不含向量），忽略`)
    return 0
  }
  const db = getVdb()
  for (const key of db.listAttachmentKeys()) {
    db.deleteByAttachmentKey(key)
  }
  keyStatus.clear()
  console.log('[向量索引] rebuildAll: 索引已清空，开始全量重扫')
  ensureQueue(config)
  return enqueueScan()
}

export function getEmbeddingStatusSummary(): ZoteroEmbeddingStatusSummary {
  const config = loadEmbeddingConfig()
  const modelState = getEmbeddingModelService().getStatus().state
  const byStatus: Record<ZoteroEmbeddingPdfStatus, number> = {
    idle: 0,
    pending: 0,
    embedding: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
  }
  let total = 0
  const recentFailed: Array<{ attachmentKey: string; error: string }> = []

  const snap = loadSnapshot()
  if (snap) {
    for (const [key, rec] of Object.entries(snap.pdfs)) {
      if (rec.parse?.status !== 'completed') continue
      total++
      const tracked = keyStatus.get(key)
      const status: ZoteroEmbeddingPdfStatus = tracked
        ? tracked.status
        : isIndexed(key)
          ? 'completed'
          : 'idle'
      byStatus[status] += 1
      if (status === 'failed' && tracked?.error && recentFailed.length < 5) {
        recentFailed.push({ attachmentKey: key, error: tracked.error })
      }
    }
  }

  let chunkCount = 0
  try {
    chunkCount = getVdb().countChunks()
  } catch {
    // 库打不开时摘要不阻塞
  }

  return {
    mode: config.mode,
    modelState,
    total,
    byStatus,
    runningKeys: queue?.getRunningKeys() ?? [],
    recentFailed,
    chunkCount,
  }
}

/** 注册状态变更监听（main IPC 用，主动 push 给 renderer） */
export function setEmbeddingStatusChangedListener(
  cb: ((summary: ZoteroEmbeddingStatusSummary) => void) | null,
): void {
  statusListener = cb
}

/**
 * 语义检索入口（papers_semantic_search 工具消费；未来 UI 搜索复用同一入口）。
 *
 * 降级语义：
 *   - 模型未就绪：触发后台下载，本次走纯 FTS（degraded='model_not_ready'）
 *   - 索引为空：degraded='index_empty'，hits=[]
 */
/**
 * 把混入的 Zotero 条目 key（parentItemKey）归一为附件 key（索引主键）。
 *
 * 背景：EvidenceSet / 综述 PLAN 携带的 paper handle 通常是**条目 key**，而向量索引
 * 按 **附件 key**（PDF attachment、wiki 文件名同源）入库——直接拿条目 key 过滤会
 * 一无所获（真实综述会话已踩坑：24 篇 paperIds 过滤 6 查询全 0 命中）。
 *
 * 规则：key 本身是 snapshot 里的附件 key → 原样保留；是某附件的 parentItemKey →
 * 替换为其全部 PDF 附件 key；两者都不是（纯元数据条目无 PDF / 未知 key）→ 原样
 * 保留（查询时自然无命中，不报错）。导出供单测。
 */
export function normalizeToAttachmentKeys(
  keys: string[],
  snapshot: ZoteroPdfSnapshot | null,
): string[] {
  const pdfs = snapshot?.pdfs
  if (!pdfs) return keys
  let parentIndex: Map<string, string[]> | null = null
  const out = new Set<string>()
  for (const key of keys) {
    if (pdfs[key]) {
      out.add(key)
      continue
    }
    if (!parentIndex) {
      parentIndex = new Map()
      for (const rec of Object.values(pdfs)) {
        if (!rec.parentItemKey) continue
        const list = parentIndex.get(rec.parentItemKey)
        if (list) list.push(rec.attachmentKey)
        else parentIndex.set(rec.parentItemKey, [rec.attachmentKey])
      }
    }
    const mapped = parentIndex.get(key)
    if (mapped) for (const ak of mapped) out.add(ak)
    else out.add(key)
  }
  return [...out]
}

export async function semanticSearchPapers(input: {
  query: string
  attachmentKeys?: string[]
  maxResults?: number
  textKinds?: ZoteroEmbeddingTextKind[]
  /** 限定顶层章节号（精确，篇内编号，通常配单篇用） */
  sectionIndex?: number
  /** 限定章节标题（substring 大小写不敏感匹配 chunk 自带 section_title，可跨篇） */
  sectionTitle?: string
}): Promise<ZoteroSemanticSearchResult> {
  const maxResults = Math.min(Math.max(input.maxResults ?? 10, 1), 50)
  const db = getVdb()

  if (db.countChunks() === 0) {
    return {
      query: input.query,
      modelId: EMBEDDING_MODEL.modelId,
      total: 0,
      degraded: 'index_empty',
      hits: [],
    }
  }

  const modelService = getEmbeddingModelService()
  let queryEmbedding: Float32Array | undefined
  let degraded: ZoteroSemanticSearchResult['degraded']

  if (modelService.isReady()) {
    try {
      const [vec] = await (await getEmbedder()).embed([input.query], 'query')
      queryEmbedding = vec
    } catch (err) {
      console.warn('[向量索引] 查询嵌入失败，降级纯 FTS:', err)
      degraded = 'model_not_ready'
    }
  } else {
    degraded = 'model_not_ready'
    void modelService.startDownload().catch(() => {})
  }

  // 条目 key → 附件 key 归一（PLAN/EvidenceSet 的 handle 常是条目 key，索引主键是附件 key）
  const attachmentKeys = input.attachmentKeys?.length
    ? normalizeToAttachmentKeys(input.attachmentKeys, loadSnapshot())
    : input.attachmentKeys

  const hits = db.search({
    queryEmbedding,
    queryText: input.query,
    maxResults,
    attachmentKeys,
    textKinds: input.textKinds,
    sectionIndex: input.sectionIndex,
    sectionTitle: input.sectionTitle,
  })

  return {
    query: input.query,
    modelId: EMBEDDING_MODEL.modelId,
    total: hits.length,
    degraded,
    hits,
  }
}

// ===== 内部 =====

function getVdb(): ZoteroVectorDb {
  if (!vdb) {
    vdb = ZoteroVectorDb.open(getZoteroVectorIndexPath(), {
      modelId: EMBEDDING_MODEL.modelId,
      embedDim: EMBEDDING_MODEL.embedDim,
    })
  }
  return vdb
}

async function getEmbedder(): Promise<E5Embedder> {
  if (embedder) return embedder
  if (!embedderLoading) {
    embedderLoading = E5Embedder.load(getEmbeddingModelService().modelDir()).then((e) => {
      embedder = e
      return e
    })
    embedderLoading.catch(() => {
      embedderLoading = null
    })
  }
  return embedderLoading
}

function ensureQueue(config: ZoteroEmbeddingConfig): void {
  if (queue) return
  queue = new LimitedQueue(async (key) => {
    await runOneWithStatus(key)
  }, config.concurrency)
}

/** 启动/重建时扫描 snapshot，把"未入库或可能过期"的 key 入队；返回入队数 */
function enqueueScan(): number {
  const snap = loadSnapshot()
  if (!snap || !queue) return 0
  let enqueued = 0
  for (const [key, rec] of Object.entries(snap.pdfs)) {
    if (rec.parse?.status !== 'completed') continue
    enqueueKey(key, { silent: true }) // 扫描期不逐篇推状态，结束后统一 emit 一次
    enqueued++
  }
  console.log(`[向量索引] 扫描入队 ${enqueued} 篇（worker 内按 hash 跳过未变更层）`)
  emitStatusChanged()
  return enqueued
}

function enqueueKey(key: string, opts?: { silent?: boolean }): void {
  if (!queue) return
  if (!getEmbeddingModelService().isReady()) {
    waitingForModel.add(key)
    keyStatus.set(key, { status: 'pending' })
    ensureModelReadyInBackground()
    if (!opts?.silent) emitStatusChanged()
    return
  }
  keyStatus.set(key, { status: 'pending' })
  queue.enqueue(key)
}

async function runOneWithStatus(key: string): Promise<void> {
  keyStatus.set(key, { status: 'embedding' })
  emitStatusChanged()
  try {
    const results = await runOne(key, {
      getRecord: (k) => loadSnapshot()?.pdfs[k],
      getMdPath: getZoteroWikiMdPath,
      getStructuredTxtPath: getZoteroWikiStructuredTxtPath,
      getArticleMdPath: getZoteroWikiArticleMdPath,
      ...defaultFsDeps(),
      vdb: getVdb(),
      embed: async (texts, kind) => (await getEmbedder()).embed(texts, kind),
    })
    keyStatus.delete(key) // completed 由库内 hash 派生
    const embedded = results.filter((r) => r.action === 'embedded')
    if (embedded.length > 0) {
      console.log(
        `[向量索引] ✓ ${key} 嵌入 ${embedded.map((r) => `${r.textKind}:${r.chunkCount}`).join(' ')}`,
      )
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    keyStatus.set(key, { status: 'failed', error: message })
    console.warn(`[向量索引] ✗ ${key}: ${message}`)
  } finally {
    emitStatusChanged()
  }
}

/** 某篇是否已有任一层入库（completed 派生判定） */
function isIndexed(key: string): boolean {
  try {
    return getVdb().getContentHash(key, 'raw') !== undefined
  } catch {
    return false
  }
}

/** 模型 ready 事件 → 补入队积压 key（只接线一次） */
function wireModelListener(): void {
  if (modelListenerWired) return
  modelListenerWired = true
  getEmbeddingModelService().on('status-changed', (status: { state: string }) => {
    emitStatusChanged()
    if (status.state !== 'ready' || waitingForModel.size === 0 || !queue) return
    const keys = [...waitingForModel]
    waitingForModel.clear()
    console.log(`[向量索引] 模型就绪，补入队 ${keys.length} 篇`)
    for (const k of keys) enqueueKey(k)
  })
}

function ensureModelReadyInBackground(): void {
  const svc = getEmbeddingModelService()
  if (svc.isReady()) return
  void svc.startDownload().catch((err) => {
    console.warn('[向量索引] 模型下载失败（任务保持 pending，可在设置页重试）:', err)
  })
}

function emitStatusChanged(): void {
  if (!statusListener) return
  try {
    statusListener(getEmbeddingStatusSummary())
  } catch (err) {
    console.warn('[向量索引] status listener 抛异常:', err)
  }
}
