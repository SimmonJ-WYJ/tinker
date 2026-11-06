// apps/electron/src/renderer/hooks/useQuoteChatTab.ts
/**
 * 监听 sidebarQuoteAtom，当用户点击"Ask in sidebar"时自动打开或切换到 quote-chat tab
 */
import { useEffect } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { sidebarQuoteAtom } from '@/atoms/text-selection-atoms.ts'
import { currentAgentSessionIdAtom } from '@/atoms/agent-atoms.ts'
import { rightPanelTabsBySessionAtom, upsertTab } from '@/atoms/right-panel-tabs.ts'

export function useQuoteChatTab(): void {
  const sidebarQuote = useAtomValue(sidebarQuoteAtom)
  const sessionId = useAtomValue(currentAgentSessionIdAtom)
  const setTabs = useSetAtom(
    rightPanelTabsBySessionAtom(sessionId ?? '__no_session__')
  )

  useEffect(() => {
    if (!sidebarQuote || !sessionId) return

    // 当有新的引用时，打开或切换到 quote-chat tab
    setTabs((prev) =>
      upsertTab(prev, 'quote-chat', 'quote-chat', 'Quote Chat', null)
    )
  }, [sidebarQuote, sessionId, setTabs])
}
