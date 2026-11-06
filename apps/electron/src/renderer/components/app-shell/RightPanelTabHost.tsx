// apps/electron/src/renderer/components/app-shell/RightPanelTabHost.tsx
/**
 * 右栏顶层容器：上面 TabBar，下面 TabContent。
 *
 * 切 Agent session 时 atomFamily 已自动给出该 session 的独立默认状态，
 * 不需要额外的清理 effect。但 maximized 是全局的，会在 session 改变时主动复位，
 * 避免上个 session 的「全屏」感染下个 session。
 */
import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { currentAgentSessionIdAtom, agentSidePanelOpenMapAtom } from '@/atoms/agent-atoms.ts'
import { rightPanelMaximizedAtom } from '@/atoms/right-panel-tabs.ts'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT } from '@/hooks/useT'
import { RightPanelTabBar } from './RightPanelTabBar.tsx'
import { RightPanelTabContent } from './RightPanelTabContent.tsx'

export function RightPanelTabHost(): React.ReactElement | null {
  const { t } = useT('nav')
  const setOpen = useSetAtom(agentSidePanelOpenMapAtom)
  const sessionId = useAtomValue(currentAgentSessionIdAtom)
  const setMaximized = useSetAtom(rightPanelMaximizedAtom)

  // 切 session 复位 maximized
  React.useEffect(() => {
    setMaximized(false)
  }, [sessionId, setMaximized])

  if (!sessionId) return null

  return (
    <div className="flex flex-col h-full min-h-0 bg-content-area rounded-2xl overflow-hidden">
      <div className="flex items-center p-1 px-2.5 titlebar-no-drag" data-right-panel-tab-bar-shell>
        <div className="min-w-0 flex-1"><RightPanelTabBar /></div>
        <Button variant="ghost" size="icon-sm" aria-label={t('shell.closePanel')} onClick={() => { setMaximized(false); setOpen((prev) => new Map(prev).set(sessionId, false)) }}><X strokeWidth={1.5} /></Button>
      </div>
      <div
        className="flex-1 min-h-0 relative flex flex-col titlebar-no-drag"
        data-right-panel-tab-content-shell
      >
        <RightPanelTabContent />
      </div>
    </div>
  )
}
