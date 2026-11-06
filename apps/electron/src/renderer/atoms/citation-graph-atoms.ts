/**
 * 引用图谱（Citation Graph）渲染端状态
 *
 * 一次只展示一个图谱（单 Modal 设计），所以状态用单例 atom：
 *   - graphOpenStateAtom：Modal 打开态 + seed 输入 + 当前 requestId
 *   - graphDataAtom：累积的节点 / 边 / 截断标志
 *   - graphStagesAtom：各阶段状态（seed / references / cited_by / hop2）
 *   - graphSelectedNodeIdAtom：右侧详情面板选中的节点
 *   - graphZoteroAddedKeysAtom：本次会话内"已加入 Zotero"的节点 id 集合（UI 覆盖层）
 *
 * 真实 Zotero 链接态仍由 workspace-papers 数据源决定；graphZoteroAddedKeysAtom
 * 只用来记录图谱打开期间用户新加入的节点，避免等待下一次 enrich。
 */

import { atom } from 'jotai'
import type {
  CitationGraphEdge,
  CitationGraphNode,
  CitationGraphSeedInput,
  CitationGraphStage,
  CitationGraphStageStatus,
} from '@asci/shared'
import type { CitationGraphScalePreset } from '@/components/citation-graph/scale-presets'

/** Modal 打开态 + 当前请求上下文 */
export interface GraphOpenState {
  open: boolean
  requestId: string | null
  seed: CitationGraphSeedInput | null
  workspaceId: string | null
  /** seed 的标题（供 Modal 顶部展示，避免等 seed 事件才显示） */
  seedTitleHint: string | null
}

export const graphOpenStateAtom = atom<GraphOpenState>({
  open: false,
  requestId: null,
  seed: null,
  workspaceId: null,
  seedTitleHint: null,
})

/** 图谱数据：节点 + 边 + 截断标志 */
export interface GraphData {
  /** Map 用于 O(1) 去重；消费侧 Array.from(nodes.values()) */
  nodes: Map<string, CitationGraphNode>
  edges: CitationGraphEdge[]
  /** 边去重辅助（不对外） */
  edgeKeys: Set<string>
  truncated: boolean
  /** 构建完成 */
  done: boolean
  /** 全局错误（非阶段级），seed 失败或网络完全不通时使用 */
  error: string | null
}

export const graphDataAtom = atom<GraphData>({
  nodes: new Map<string, CitationGraphNode>(),
  edges: [],
  edgeKeys: new Set<string>(),
  truncated: false,
  done: false,
  error: null,
})

/** 阶段状态 */
export interface StageState {
  status: CitationGraphStageStatus
  message: string | null
}

export type GraphStagesState = Record<CitationGraphStage, StageState>

const INITIAL_STAGES: GraphStagesState = {
  seed: { status: 'pending', message: null },
  references: { status: 'pending', message: null },
  cited_by: { status: 'pending', message: null },
  hop2: { status: 'pending', message: null },
}

export const graphStagesAtom = atom<GraphStagesState>({ ...INITIAL_STAGES })

/** 选中节点（null 表示仅展示 seed 或无选择） */
export const graphSelectedNodeIdAtom = atom<string | null>(null)

/** 本次图谱会话内"已加入 Zotero"的节点 id 集合（UI 层乐观更新） */
export const graphZoteroAddedKeysAtom = atom<Set<string>>(new Set<string>())

// ===== 显示偏好（图例面板的开关） =====

/** 是否显示节点名字（默认 ON） */
export const graphShowNodeLabelsAtom = atom<boolean>(true)

/** 是否显示边名字（默认 OFF） */
export const graphShowEdgeLabelsAtom = atom<boolean>(false)

/** 展开规模 preset（跨图谱会话保留用户偏好） */
export const graphScalePresetAtom = atom<CitationGraphScalePreset>('medium')

// ===== 派生 / 辅助 atoms =====

/** 重置到初始状态（打开新图谱前调用） */
export const resetGraphStateAtom = atom(null, (_get, set) => {
  set(graphDataAtom, {
    nodes: new Map<string, CitationGraphNode>(),
    edges: [],
    edgeKeys: new Set<string>(),
    truncated: false,
    done: false,
    error: null,
  })
  set(graphStagesAtom, { ...INITIAL_STAGES })
  set(graphSelectedNodeIdAtom, null)
  set(graphZoteroAddedKeysAtom, new Set<string>())
})

/**
 * 软重置：保留当前 nodes / edges / selected / zoteroAdded，只重置 stages 和 done/error 标记。
 * 用于"切换规模"等就地重建场景，构建完成时由 useCitationGraph 按新结果 prune 多余节点。
 */
export const softResetGraphStateAtom = atom(null, (get, set) => {
  const current = get(graphDataAtom)
  set(graphDataAtom, {
    ...current,
    truncated: false,
    done: false,
    error: null,
  })
  set(graphStagesAtom, { ...INITIAL_STAGES })
})

/** 关闭 Modal（同时重置数据） */
export const closeGraphAtom = atom(null, (_get, set) => {
  set(graphOpenStateAtom, {
    open: false,
    requestId: null,
    seed: null,
    workspaceId: null,
    seedTitleHint: null,
  })
  set(resetGraphStateAtom)
})
