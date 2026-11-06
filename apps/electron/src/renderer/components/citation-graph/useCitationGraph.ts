/**
 * 引用图谱 hook：订阅流式事件并写入 atoms，封装 build / cancel 入口。
 *
 * 由 GraphModal 挂载使用：
 *   - 当 graphOpenStateAtom.open 变 true / requestId 变化时，触发 build + 订阅事件
 *   - Modal 关闭或卸载时，cancel 正在进行的构建并取消订阅
 *
 * 设计要点 —— 就地重建（无闪烁）：
 *   - effect 内部收集"本次构建涉及的 nodeId 集合"（incomingNodeIds）
 *   - 新事件到达时正常 merge（已有节点不覆盖，保留 UI 连续性）
 *   - done 事件到达时按 incomingNodeIds 做 prune：
 *       - 放大规模：新集合 ⊇ 旧，保留不变（自然补全）
 *       - 缩小规模：淘汰不在新集合里的旧节点，图自动收缩
 *       - 缓存命中：重放事件也会走同一条路径，done 时瞬间对齐
 *   - 若 seed 解析失败，service 不会发 done（直接 return），所以 prune 不会执行
 */

import { useEffect } from 'react'
import { useAtomValue, useSetAtom, useStore } from 'jotai'
import type { CitationGraphStreamEvent } from '@asci/shared'
import {
  closeGraphAtom,
  graphDataAtom,
  graphOpenStateAtom,
  graphScalePresetAtom,
  graphStagesAtom,
  resetGraphStateAtom,
} from '@/atoms/citation-graph-atoms'
import { SCALE_PRESETS } from './scale-presets'

export function useCitationGraph(): void {
  const open = useAtomValue(graphOpenStateAtom)
  const setData = useSetAtom(graphDataAtom)
  const setStages = useSetAtom(graphStagesAtom)
  const resetGraph = useSetAtom(resetGraphStateAtom)
  const closeGraph = useSetAtom(closeGraphAtom)
  // 切 preset 不应触发 effect 重跑（通过换 requestId 显式触发重建），
  // 所以这里用 store.get() 在 effect 运行瞬间读取最新值，而不是进依赖
  const store = useStore()

  useEffect(() => {
    if (!open.open || !open.requestId || !open.seed) return

    let cancelled = false
    const requestId = open.requestId
    // 收集本次 build 涉及的节点 id，done 时用来 prune
    const incomingNodeIds = new Set<string>()

    // 订阅流式事件
    const unsubscribe = window.electronAPI.citationGraph.onStreamEvent(
      (event: CitationGraphStreamEvent) => {
        if (cancelled) return
        if (event.requestId !== requestId) return
        applyStreamEvent(event, setData, setStages, incomingNodeIds)
      },
    )

    // 触发构建（把当前展开规模 preset 的参数带上）
    const preset = store.get(graphScalePresetAtom)
    const params = SCALE_PRESETS[preset]
    window.electronAPI.citationGraph
      .build({
        requestId,
        seed: open.seed,
        workspaceId: open.workspaceId,
        ...params,
      })
      .then((ack) => {
        if (!ack.accepted) {
          setData((prev) => ({
            ...prev,
            error: ack.message ?? '图谱构建被拒绝',
            done: true,
          }))
        }
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        setData((prev) => ({ ...prev, error: message, done: true }))
      })

    return () => {
      cancelled = true
      unsubscribe()
      // Modal 关闭或换 requestId 时取消当前构建
      window.electronAPI.citationGraph.cancel(requestId).catch(() => {})
    }
  }, [open.open, open.requestId, open.seed, open.workspaceId, setData, setStages, resetGraph, closeGraph, store])
}

/** 把单条流式事件合并到 atoms；同时把出现过的 nodeId 塞入 incomingNodeIds 供 done 时 prune */
function applyStreamEvent(
  event: CitationGraphStreamEvent,
  setData: ReturnType<typeof useSetAtom<typeof graphDataAtom>>,
  setStages: ReturnType<typeof useSetAtom<typeof graphStagesAtom>>,
  incomingNodeIds: Set<string>,
): void {
  switch (event.type) {
    case 'stage': {
      setStages((prev) => ({
        ...prev,
        [event.stage]: {
          status: event.status,
          message: event.message ?? null,
        },
      }))
      return
    }
    case 'seed': {
      incomingNodeIds.add(event.node.id)
      setData((prev) => {
        const nodes = new Map(prev.nodes)
        // seed 总是覆盖（kind 可能从 hop2 升级为 seed 等边缘情况）
        nodes.set(event.node.id, event.node)
        return { ...prev, nodes }
      })
      return
    }
    case 'nodes': {
      for (const n of event.nodes) incomingNodeIds.add(n.id)
      setData((prev) => {
        const nodes = new Map(prev.nodes)
        for (const n of event.nodes) {
          if (!nodes.has(n.id)) nodes.set(n.id, n)
        }
        return { ...prev, nodes }
      })
      return
    }
    case 'edges': {
      setData((prev) => {
        const edgeKeys = new Set(prev.edgeKeys)
        const added = event.edges.filter((e) => {
          const key = `${e.source}->${e.target}:${e.kind}`
          if (edgeKeys.has(key)) return false
          edgeKeys.add(key)
          return true
        })
        return { ...prev, edges: [...prev.edges, ...added], edgeKeys }
      })
      return
    }
    case 'done': {
      // 按 incomingNodeIds 裁剪：淘汰旧批次遗留、但本次 build 未出现的节点
      setData((prev) => {
        const prunedNodes = new Map<string, import('@asci/shared').CitationGraphNode>()
        for (const [id, n] of prev.nodes) {
          if (incomingNodeIds.has(id)) prunedNodes.set(id, n)
        }
        const prunedEdges = prev.edges.filter(
          (e) => incomingNodeIds.has(e.source) && incomingNodeIds.has(e.target),
        )
        const prunedEdgeKeys = new Set(
          prunedEdges.map((e) => `${e.source}->${e.target}:${e.kind}`),
        )
        return {
          ...prev,
          nodes: prunedNodes,
          edges: prunedEdges,
          edgeKeys: prunedEdgeKeys,
          done: true,
          truncated: event.truncated,
        }
      })
      return
    }
    case 'error': {
      setData((prev) => ({
        ...prev,
        error: event.message,
        done: event.stage === 'seed' ? true : prev.done,
      }))
      return
    }
  }
}
