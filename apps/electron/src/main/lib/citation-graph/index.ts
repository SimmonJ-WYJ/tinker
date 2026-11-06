/**
 * 引用图谱编排服务
 *
 * 对外暴露 buildGraph(req, onEvent, signal)：
 *   - 分阶段调 provider → seed → references → cited_by → hop2
 *   - 通过 onEvent 回调向上层（IPC 层）推送流式事件
 *   - 支持 AbortSignal 取消
 *   - 节点按统一 id 去重，边按 (source,target,kind) 去重
 *   - 工作区 enrich：按 DOI 标记 inLibrary / 回填 linkedZoteroKey
 *   - 达到节点上限时发送 truncated=true 并提前结束
 */

import type {
  CitationGraphBuildRequest,
  CitationGraphEdge,
  CitationGraphNode,
  CitationGraphStage,
  CitationGraphStreamEvent,
  WorkspacePaperEntry,
} from '@asci/shared'
import { nowIso, dayjs } from '@asci/shared'
import { list as listWorkspacePapers } from '../workspace-paper-store'
import { getCitationProvider } from './provider-registry'
import type { BasePaperNode } from './providers/types'
import {
  type CachedCitationGraph,
  computeCacheKey,
  readCache,
  writeCache,
} from './cache'

// ===== 可调常量 =====

const DEFAULT_REFS_LIMIT = 40
const DEFAULT_CITED_BY_LIMIT = 25
const DEFAULT_HOP2_TOP_N = 8
/** 每个 hop1 节点继续展开的 references 数默认值 */
const DEFAULT_HOP2_REFS_PER_NODE = 5
/** 每个 hop1 节点继续展开的 cited_by 数默认值 */
const DEFAULT_HOP2_CITED_BY_PER_NODE = 3
/** 节点总数上限，触发截断 */
const MAX_NODES = 300

// ===== 工作区 enrich 索引 =====

interface EnrichIndex {
  /** DOI（小写归一） → entry，用于 inLibrary 判定 */
  byDoi: Map<string, WorkspacePaperEntry>
}

function buildEnrichIndex(workspaceId: string | null | undefined): EnrichIndex {
  const byDoi = new Map<string, WorkspacePaperEntry>()
  if (!workspaceId) return { byDoi }

  try {
    const entries = listWorkspacePapers(workspaceId, {})
    for (const entry of entries) {
      if (entry.doi) {
        byDoi.set(entry.doi.toLowerCase(), entry)
      }
    }
  } catch (error) {
    console.warn('[citation-graph] 读取工作区论文失败，跳过 enrich:', error)
  }

  return { byDoi }
}

function enrichNode(
  base: BasePaperNode,
  kind: CitationGraphNode['kind'],
  index: EnrichIndex,
): CitationGraphNode {
  let inLibrary = false
  let linkedZoteroKey: string | null = null

  if (base.doi) {
    const entry = index.byDoi.get(base.doi.toLowerCase())
    if (entry) {
      inLibrary = true
      linkedZoteroKey = entry.linkedZoteroKey
    }
  }

  return {
    ...base,
    kind,
    venue: base.venue,
    inLibrary,
    linkedZoteroKey,
  }
}

// ===== 图谱状态（单次构建） =====

interface GraphState {
  nodes: Map<string, CitationGraphNode>
  edges: CitationGraphEdge[]
  edgeKeys: Set<string>
  truncated: boolean
}

function newState(): GraphState {
  return { nodes: new Map(), edges: [], edgeKeys: new Set(), truncated: false }
}

function edgeKey(e: CitationGraphEdge): string {
  return `${e.source}->${e.target}:${e.kind}`
}

/**
 * 把一批新节点合并进状态，返回真正被新增的节点（去重后）。
 * 达到 MAX_NODES 时截断并置 truncated=true。
 */
function addNodes(state: GraphState, incoming: CitationGraphNode[]): CitationGraphNode[] {
  const added: CitationGraphNode[] = []
  for (const node of incoming) {
    if (state.nodes.has(node.id)) continue
    if (state.nodes.size >= MAX_NODES) {
      state.truncated = true
      break
    }
    state.nodes.set(node.id, node)
    added.push(node)
  }
  return added
}

function addEdges(state: GraphState, incoming: CitationGraphEdge[]): CitationGraphEdge[] {
  const added: CitationGraphEdge[] = []
  for (const edge of incoming) {
    // 只连接两端都已在图中的节点
    if (!state.nodes.has(edge.source) || !state.nodes.has(edge.target)) continue
    const key = edgeKey(edge)
    if (state.edgeKeys.has(key)) continue
    state.edgeKeys.add(key)
    state.edges.push(edge)
    added.push(edge)
  }
  return added
}

// ===== 主编排 =====

export async function buildGraph(
  req: CitationGraphBuildRequest,
  onEvent: (event: CitationGraphStreamEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const { requestId } = req
  const refsLimit = req.refsLimit ?? DEFAULT_REFS_LIMIT
  const citedByLimit = req.citedByLimit ?? DEFAULT_CITED_BY_LIMIT
  const hop2TopN = req.hop2TopN ?? DEFAULT_HOP2_TOP_N
  const hop2RefsPerNode = req.hop2RefsPerNode ?? DEFAULT_HOP2_REFS_PER_NODE
  const hop2CitedByPerNode = req.hop2CitedByPerNode ?? DEFAULT_HOP2_CITED_BY_PER_NODE

  const provider = getCitationProvider()
  const enrichIndex = buildEnrichIndex(req.workspaceId)
  const state = newState()

  const emitStage = (
    stage: CitationGraphStage,
    status: 'running' | 'done' | 'skipped' | 'error',
    message?: string,
  ) => onEvent({ type: 'stage', requestId, stage, status, message })

  // ---- Stage 0: 缓存命中检查 ----
  const cacheKey = computeCacheKey({
    provider: provider.id,
    seed: req.seed,
    params: { refsLimit, citedByLimit, hop2TopN, hop2RefsPerNode, hop2CitedByPerNode },
  })

  const cached = readCache(cacheKey)
  if (cached) {
    replayFromCache(cached, requestId, enrichIndex, onEvent)
    return
  }

  // ---- Stage 1: seed ----
  emitStage('seed', 'running')
  let seedNode: CitationGraphNode
  try {
    const rawSeed = await provider.resolveSeed(req.seed, signal)
    seedNode = enrichNode(rawSeed, 'seed', enrichIndex)
    state.nodes.set(seedNode.id, seedNode)
    onEvent({ type: 'seed', requestId, node: seedNode })
    emitStage('seed', 'done', seedNode.title)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    emitStage('seed', 'error', message)
    onEvent({ type: 'error', requestId, message, stage: 'seed' })
    return
  }

  if (signal.aborted) return

  // ---- Stage 2: references（一跳向后） ----
  emitStage('references', 'running')
  const hop1Refs: CitationGraphNode[] = []
  try {
    const rawRefs = await provider.getReferences(seedNode.id, refsLimit, signal)
    const nodes = rawRefs.map((r) => enrichNode(r, 'reference', enrichIndex))
    const added = addNodes(state, nodes)
    hop1Refs.push(...added)
    const edges: CitationGraphEdge[] = added.map((n) => ({
      source: seedNode.id,
      target: n.id,
      kind: 'references',
      hop: 1,
    }))
    const addedEdges = addEdges(state, edges)
    if (added.length > 0) onEvent({ type: 'nodes', requestId, nodes: added })
    if (addedEdges.length > 0) onEvent({ type: 'edges', requestId, edges: addedEdges })
    emitStage('references', 'done', `${added.length} references`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    emitStage('references', 'error', message)
    // references 失败不终止流程，继续 cited_by
  }

  if (signal.aborted) return

  // ---- Stage 3: cited_by（一跳向前） ----
  emitStage('cited_by', 'running')
  const hop1CitedBy: CitationGraphNode[] = []
  try {
    const rawCited = await provider.getCitedBy(seedNode.id, citedByLimit, signal)
    const nodes = rawCited.map((r) => enrichNode(r, 'cited_by', enrichIndex))
    const added = addNodes(state, nodes)
    hop1CitedBy.push(...added)
    const edges: CitationGraphEdge[] = added.map((n) => ({
      source: n.id,
      target: seedNode.id,
      kind: 'cited_by',
      hop: 1,
    }))
    const addedEdges = addEdges(state, edges)
    if (added.length > 0) onEvent({ type: 'nodes', requestId, nodes: added })
    if (addedEdges.length > 0) onEvent({ type: 'edges', requestId, edges: addedEdges })
    emitStage('cited_by', 'done', `${added.length} citations`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    emitStage('cited_by', 'error', message)
  }

  if (signal.aborted || state.truncated) {
    onEvent({ type: 'done', requestId, truncated: state.truncated })
    return
  }

  // ---- Stage 4: hop2（对 top N 高引用一跳节点继续展开） ----
  emitStage('hop2', 'running')
  try {
    const hop1All = [...hop1Refs, ...hop1CitedBy]
    const topN = hop1All
      .filter((n) => (n.citedByCount ?? 0) > 0)
      .sort((a, b) => (b.citedByCount ?? 0) - (a.citedByCount ?? 0))
      .slice(0, hop2TopN)

    for (const parent of topN) {
      if (signal.aborted || state.truncated) break

      // 并发拉 references + cited_by
      const [refs, cited] = await Promise.allSettled([
        provider.getReferences(parent.id, hop2RefsPerNode, signal),
        provider.getCitedBy(parent.id, hop2CitedByPerNode, signal),
      ])

      const batchNodes: CitationGraphNode[] = []
      const batchEdges: CitationGraphEdge[] = []

      if (refs.status === 'fulfilled') {
        for (const raw of refs.value) {
          const node = enrichNode(raw, 'hop2', enrichIndex)
          batchNodes.push(node)
          batchEdges.push({ source: parent.id, target: node.id, kind: 'references', hop: 2 })
        }
      }
      if (cited.status === 'fulfilled') {
        for (const raw of cited.value) {
          const node = enrichNode(raw, 'hop2', enrichIndex)
          batchNodes.push(node)
          batchEdges.push({ source: node.id, target: parent.id, kind: 'cited_by', hop: 2 })
        }
      }

      const addedNodes = addNodes(state, batchNodes)
      const addedEdges = addEdges(state, batchEdges)
      if (addedNodes.length > 0) onEvent({ type: 'nodes', requestId, nodes: addedNodes })
      if (addedEdges.length > 0) onEvent({ type: 'edges', requestId, edges: addedEdges })
    }
    emitStage('hop2', 'done', `${state.nodes.size} nodes total`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    emitStage('hop2', 'error', message)
  }

  onEvent({ type: 'done', requestId, truncated: state.truncated })

  // ---- 成功且未截断才写缓存 ----
  if (!signal.aborted && !state.truncated) {
    const payload: CachedCitationGraph = {
      version: 1,
      provider: provider.id,
      cacheKey,
      seedInput: req.seed,
      seedNodeId: seedNode.id,
      params: {
        refsLimit,
        citedByLimit,
        hop2TopN,
        hop2RefsPerNode,
        hop2CitedByPerNode,
      },
      nodes: Array.from(state.nodes.values()),
      edges: [...state.edges],
      truncated: false,
      generatedAt: nowIso(),
    }
    writeCache(payload)
  }
}

// ===== 缓存命中时的事件重放 =====

/**
 * 从缓存数据按 kind 分组重放流式事件，UX 上近似正常构建但瞬间完成：
 *   - stage 全部 done
 *   - seed / nodes / edges 一次性发出
 *   - 重新 enrich（工作区 inLibrary / linkedZoteroKey 以当前状态为准，不用缓存中的）
 */
function replayFromCache(
  cached: CachedCitationGraph,
  requestId: string,
  enrichIndex: EnrichIndex,
  onEvent: (event: CitationGraphStreamEvent) => void,
): void {
  const emitStage = (
    stage: CitationGraphStage,
    status: 'done',
    message: string,
  ) => onEvent({ type: 'stage', requestId, stage, status, message })

  // 重新按当前工作区 enrich 节点（inLibrary 等字段可能与缓存时不同）
  const reEnriched = cached.nodes.map((n) =>
    enrichNode(
      {
        id: n.id,
        title: n.title,
        authors: n.authors,
        year: n.year,
        venue: n.venue,
        doi: n.doi,
        url: n.url,
        citedByCount: n.citedByCount,
      },
      n.kind,
      enrichIndex,
    ),
  )

  const seed = reEnriched.find((n) => n.kind === 'seed') ?? null
  const refsHop1 = reEnriched.filter((n) => n.kind === 'reference')
  const citedHop1 = reEnriched.filter((n) => n.kind === 'cited_by')
  const hop2Nodes = reEnriched.filter((n) => n.kind === 'hop2')

  const cacheHitMsg = `Cache hit · ${formatTime(cached.generatedAt)}`
  emitStage('seed', 'done', seed?.title ?? cacheHitMsg)
  if (seed) onEvent({ type: 'seed', requestId, node: seed })

  emitStage('references', 'done', `${cacheHitMsg} · ${refsHop1.length}`)
  emitStage('cited_by', 'done', `${cacheHitMsg} · ${citedHop1.length}`)
  emitStage('hop2', 'done', `${cacheHitMsg} · ${hop2Nodes.length}`)

  const nonSeed = reEnriched.filter((n) => n.kind !== 'seed')
  if (nonSeed.length > 0) onEvent({ type: 'nodes', requestId, nodes: nonSeed })
  if (cached.edges.length > 0) onEvent({ type: 'edges', requestId, edges: cached.edges })

  onEvent({ type: 'done', requestId, truncated: cached.truncated })
}

function formatTime(iso: string): string {
  try {
    return dayjs(iso).format('YYYY-MM-DD HH:mm:ss')
  } catch {
    return iso
  }
}
