/**
 * 右栏「打开/聚焦 preview」唯一入口。
 *
 * 同 id 复用 tab 槽位（替换 payload + 激活）；新 id 追加 tab + 激活。
 * file-preview 的 id 含 path → 每个文件独立 tab、同文件聚焦复用（#444）；
 * paper / 默认 tab 单例不变。所有原来 `setCurrentPreview(target)` 的调用点都改成调用本 hook。
 *
 * opts.replaceActive=true：原地替换当前激活 tab（兄弟 ↑↓ 快速浏览用，仅改内容+标题，
 * 不累积新 tab）。默认 false，保持列表点击「每篇独立 tab」的累积行为。
 */
import { useCallback } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { currentAgentSessionIdAtom, agentSidePanelOpenMapAtom } from '@/atoms/agent-atoms.ts'
import type { PreviewTarget } from '@/atoms/side-panel-layout.ts'
import {
  rightPanelTabsBySessionAtom,
  upsertTab,
  replaceActiveTab,
  kindOfTarget,
  titleOfTarget,
  tabIdOfTarget,
} from '@/atoms/right-panel-tabs.ts'

/** 打开选项：replaceActive=true 时原地替换当前激活 tab（兄弟导航用，不新增 tab） */
interface OpenInRightPanelOpts {
  replaceActive?: boolean
}

export function useOpenInRightPanel(): (target: PreviewTarget, opts?: OpenInRightPanelOpts) => void {
  const sessionId = useAtomValue(currentAgentSessionIdAtom)

  const setPanelOpen = useSetAtom(agentSidePanelOpenMapAtom)

  // 在 callback 内动态拿 setter，避免 sessionId 变化时 stale closure。
  // 注意：atomFamily 返回的 atom 引用按 key 稳定，不会因 sessionId 变化而每次重建。
  const setTabs = useSetAtom(
    rightPanelTabsBySessionAtom(sessionId ?? '__no_session__'),
  )

  return useCallback(
    (target: PreviewTarget, opts?: OpenInRightPanelOpts) => {
      if (!sessionId) return
      setPanelOpen((prev) => new Map(prev).set(sessionId, true))
      const id = tabIdOfTarget(target)
      const kind = kindOfTarget(target)
      const title = titleOfTarget(target)
      setTabs((prev) =>
        opts?.replaceActive
          ? replaceActiveTab(prev, id, kind, title, target)
          : upsertTab(prev, id, kind, title, target),
      )
    },
    [sessionId, setTabs, setPanelOpen],
  )
}
