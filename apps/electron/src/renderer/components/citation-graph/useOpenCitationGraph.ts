/**
 * 统一的"打开引用图谱"入口
 *
 * 三个入口（Zotero 文献库 / 工作区论文详情 / 论文摘要快照）都调用这里，
 * 确保 requestId 生成、状态重置、seedTitleHint 写入逻辑一致。
 */

import { useCallback } from 'react'
import { useSetAtom } from 'jotai'
import type { CitationGraphSeedInput } from '@asci/shared'
import { graphOpenStateAtom, resetGraphStateAtom } from '@/atoms/citation-graph-atoms'

export interface OpenCitationGraphInput {
  seed: CitationGraphSeedInput
  workspaceId?: string | null
  /** seed 的标题，用于 Modal 顶部立刻显示（不用等 seed 事件） */
  seedTitleHint?: string | null
}

export function useOpenCitationGraph() {
  const setOpenState = useSetAtom(graphOpenStateAtom)
  const resetGraph = useSetAtom(resetGraphStateAtom)

  return useCallback(
    (input: OpenCitationGraphInput) => {
      resetGraph()
      setOpenState({
        open: true,
        requestId: crypto.randomUUID(),
        seed: input.seed,
        workspaceId: input.workspaceId ?? null,
        seedTitleHint: input.seedTitleHint ?? null,
      })
    },
    [resetGraph, setOpenState],
  )
}
