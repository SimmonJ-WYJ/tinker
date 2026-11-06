/**
 * 关闭右栏某个 tab；用于「× 关闭按钮」和旧 `setCurrentPreview(null)` 调用点。
 *
 * 同 atom 的 upsertTab，setter 在 callback 内调用以避免 stale closure。
 */
import { useCallback } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { currentAgentSessionIdAtom } from '@/atoms/agent-atoms.ts'
import {
  rightPanelTabsBySessionAtom,
  closeTab,
} from '@/atoms/right-panel-tabs.ts'

export function useCloseRightPanelTab(): (tabId: string) => void {
  const sessionId = useAtomValue(currentAgentSessionIdAtom)
  const setTabs = useSetAtom(
    rightPanelTabsBySessionAtom(sessionId ?? '__no_session__'),
  )

  return useCallback(
    (tabId: string) => {
      if (!sessionId) return
      setTabs((prev) => closeTab(prev, tabId))
    },
    [sessionId, setTabs],
  )
}
