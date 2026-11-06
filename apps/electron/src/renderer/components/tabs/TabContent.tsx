/**
 * TabContent — 标签内容渲染器
 *
 * 普通会话 → AgentView。
 * Review session（__review: / __demo__: 前缀） → ReviewDemoView。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { tabsAtom } from '@/atoms/tab-atoms'
import { AgentView } from '@/components/agent'
import { ReviewDemoView } from '@/components/review-demo/ReviewDemoView'
import { isReviewSessionId } from '@/atoms/session-reviews-atoms'
import { useT } from '@/hooks/useT'

export interface TabContentProps {
  tabId: string
}

export function TabContent({ tabId }: TabContentProps): React.ReactElement {
  const { t: tPreview } = useT('preview')
  const tabs = useAtomValue(tabsAtom)
  const tab = tabs.find((t) => t.id === tabId)

  React.useEffect(() => {
    if (!tab) {
      console.warn(`[TabContent] tab not found for tabId="${tabId}"`, { tabIds: tabs.map(t => t.id) })
    }
  }, [tab, tabId, tabs])

  if (!tab) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        {tPreview('tab.notFound')}
      </div>
    )
  }

  if (isReviewSessionId(tab.sessionId)) {
    return <ReviewDemoView sessionId={tab.sessionId} key={tab.sessionId} />
  }

  return <AgentView sessionId={tab.sessionId} key={tab.sessionId} />
}
