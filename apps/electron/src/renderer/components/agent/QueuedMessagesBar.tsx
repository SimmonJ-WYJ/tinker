/**
 * QueuedMessagesBar — 输入框上方的「排队中」消息持久条（issue #450）
 *
 * 职责：
 * - 流式输出期间，把用户排队的消息文本固定展示在输入框正上方
 * - 取代旧的气泡内联「排队中」徽标（徽标会随新内容流出滚出视野）
 * - 队列为空时不渲染（turn 结束自动清空队列 → 条目随之消失）
 */

import * as React from 'react'
import { Clock } from 'lucide-react'
import { useT } from '@/hooks/useT'

interface QueuedMessageItem {
  uuid: string
  text: string
}

export function QueuedMessagesBar({ items }: { items: QueuedMessageItem[] }): React.ReactElement | null {
  const { t } = useT('conversation')
  if (items.length === 0) return null
  return (
    <div className="mb-2 rounded-xl bg-muted/50 px-3 py-2">
      <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock className="size-3.5" />
        <span>{t('input.queuedBarTitle', { count: items.length })}</span>
      </div>
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item.uuid} className="truncate text-sm text-foreground/80">
            {item.text}
          </li>
        ))}
      </ul>
    </div>
  )
}
