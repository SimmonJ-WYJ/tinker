// apps/electron/src/renderer/components/app-shell/RightPanelTabContent.tsx
/**
 * 右栏当前 Tab 的内容区。按 tab.kind 分发：
 * - session-files  → <SessionFilesView/>
 * - session-papers → <SessionPapersPanel/>
 * - file-preview / paper-detail / paper-record → <InlinePreview/>
 *   （InlinePreview 内部读 currentPreviewAtom 派生为当前 active tab 的 payload，
 *    然后路由到具体 renderer，无需在这里重复 switch）
 *
 * 空态：当无 active tab（全部 tab 都关了）时显示带内联恢复按钮的引导文案。
 * sessionPath null：将 SessionFilesView 改为不渲染 + 显示一个简短提示。
 */
import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Plus } from 'lucide-react'
import { useT } from '@/hooks/useT.ts'
import { Button } from '@/components/ui/button'
import {
  currentActiveTabAtom,
  rightPanelTabsBySessionAtom,
  upsertTab,
  DEFAULT_TABS,
  researchGapTableIdOf,
} from '@/atoms/right-panel-tabs.ts'
import { currentAgentSessionIdAtom, agentSessionPathMapAtom } from '@/atoms/agent-atoms.ts'
import { SessionFilesView } from '@/components/agent/SessionFilesView.tsx'
import { SessionPapersPanel } from '@/components/agent/SessionPapersPanel.tsx'
import { ResearchGapTableView } from '@/components/agent/research-gap/ResearchGapTableView.tsx'
import { InlinePreview } from '@/components/preview/InlinePreview.tsx'
import { QuoteChatView } from '@/components/agent/QuoteChatView.tsx'

export function RightPanelTabContent(): React.ReactElement {
  const { t } = useT('conversation')
  const activeTab = useAtomValue(currentActiveTabAtom)
  const sessionId = useAtomValue(currentAgentSessionIdAtom)
  const sessionPathMap = useAtomValue(agentSessionPathMapAtom)
  // 空态内联恢复按钮需要写入 tabs；hook 必须无条件调用，条件渲染在 JSX 内处理
  const setTabs = useSetAtom(rightPanelTabsBySessionAtom(sessionId ?? '__no_session__'))

  if (!activeTab || !sessionId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-xs text-muted-foreground p-6">
        <p>{t('rightPanel.emptyState')}</p>
        {sessionId && (
          <div className="flex gap-2">
            {DEFAULT_TABS.map((tab) => (
              <Button
                key={tab.id}
                type="button"
                variant="ghost"
                onClick={() => setTabs((prev) => upsertTab(prev, tab.id, tab.kind, '', null))}
                className="h-auto gap-1.5 px-3 py-1.5 bg-muted hover:bg-muted/80 text-foreground"
              >
                <Plus className="!size-3" />
                {tab.kind === 'session-files'
                  ? t('rightPanel.addTab.restoreFiles')
                  : t('rightPanel.addTab.restorePapers')}
              </Button>
            ))}
          </div>
        )}
      </div>
    )
  }

  const sessionPath = sessionPathMap.get(sessionId) ?? null

  switch (activeTab.kind) {
    case 'session-files':
      if (!sessionPath) {
        // SessionFilesView requires non-null sessionPath; show a lightweight empty hint instead.
        return (
          <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
            {t('sidePanel.noWorkspace')}
          </div>
        )
      }
      return <SessionFilesView sessionId={sessionId} sessionPath={sessionPath} />
    case 'session-papers':
      return <SessionPapersPanel sessionId={sessionId} readOnly />
    case 'research-gap-table':
      // tab id 形如 `research-gap:<tableId>` —— 解析出 tableId 给 View 定位具体那张表
      return (
        <ResearchGapTableView
          sessionId={sessionId}
          tableId={researchGapTableIdOf(activeTab.id) ?? ''}
          readOnly
        />
      )
    case 'quote-chat':
      return <QuoteChatView />
    case 'file-preview':
    case 'paper-detail':
    case 'paper-record':
      return <InlinePreview />
  }
}
