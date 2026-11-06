/**
 * SendToAgentButton - 把 Zotero 条目引用插入当前活跃 Agent 对话
 *
 * 点击按钮或把条目拖入 Agent 输入框都会走统一的引用文本。
 * 目前只插文本；PDF 预挂作为 V2.2。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { activeTabIdAtom, tabsAtom } from '@/atoms/tab-atoms'
import { agentPendingPromptAtom } from '@/atoms/agent-atoms'
import { useT } from '@/hooks/useT'
import { captureFeedback } from '@/lib/telemetry'
import type { ItemDetail } from '@asci/core/zotero'

/**
 * 生成 Zotero 条目的引用文本
 * unknownAuthor 由调用方注入（i18n 化），保持本函数无 React 依赖
 */
export function buildReferenceText(
  item: {
    key: string
    title: string
    creators: string[]
    date?: string
  },
  unknownAuthor: string,
): string {
  const firstCreator = item.creators[0] ?? unknownAuthor
  const year = item.date?.match(/\d{4}/)?.[0] ?? ''
  const creatorYear = year ? `${firstCreator}, ${year}` : firstCreator
  return `[Zotero ${item.key}: ${item.title}（${creatorYear}）]`
}

export function SendToAgentButton({ detail }: { detail: ItemDetail }): React.ReactElement {
  const { t } = useT('library')
  const tabs = useAtomValue(tabsAtom)
  const activeTabId = useAtomValue(activeTabIdAtom)
  const setPendingPrompt = useSetAtom(agentPendingPromptAtom)

  const activeTab = tabs.find((t) => t.id === activeTabId)
  const activeSessionId = activeTab?.type === 'agent' ? activeTab.sessionId : null
  const canSend = activeSessionId !== null

  const handleSend = (): void => {
    if (!activeSessionId) return
    const reference = buildReferenceText(
      {
        key: detail.key,
        title: detail.title,
        creators: detail.creators,
        date: detail.date,
      },
      t('sendToAgent.unknownAuthor'),
    )
    setPendingPrompt({ sessionId: activeSessionId, message: reference })
    // 自进化隐式反馈（#427）：引用条目到对话 = 正向信号，不采引用内容
    captureFeedback('cite', 'paper', activeSessionId)
  }

  return (
    <Button
      size="sm"
      variant="outline"
      className="w-full gap-1.5"
      onClick={handleSend}
      disabled={!canSend}
      title={canSend ? t('sendToAgent.tooltip') : t('sendToAgent.tooltipDisabled')}
    >
      <Send size={13} />
      <span>{t('sendToAgent.label')}</span>
    </Button>
  )
}
