import { AIThinkingOrb } from '@/components/ui/ai-thinking-orb'
import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react'
/**
 * AI Elements - 对话容器原语
 *
 * 基于 use-stick-to-bottom 实现自动滚动到底部的对话容器。
 * 移植自 asci-frontend 的 ai-elements/conversation.tsx。
 *
 * 包含：
 * - Conversation — 根容器（StickToBottom）
 * - ConversationContent — 内容区域
 * - ConversationEmptyState — 空状态
 * - ConversationScrollButton — 滚动到底部按钮
 */

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useT } from '@/hooks/useT'
import type { ComponentProps } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom'

// ===== Conversation 根容器 =====

export type ConversationProps = ComponentProps<typeof StickToBottom>

export function Conversation({ className, ...props }: ConversationProps): React.ReactElement {
  return (
    <StickToBottom
      className={cn('relative flex-1 overflow-y-hidden scrollbar-none', className)}
      initial="instant"
      resize="smooth"
      role="log"
      {...props}
    />
  )
}

// ===== ConversationContent 内容区域 =====

export type ConversationContentProps = ComponentProps<typeof StickToBottom.Content>

export function ConversationContent({ className, ...props }: ConversationContentProps): React.ReactElement {
  return (
    <StickToBottom.Content
      className={cn('flex flex-col gap-1 py-4 px-8', className)}
      {...props}
    />
  )
}

// ===== ConversationEmptyState 空状态 =====

export interface ConversationEmptyStateProps extends ComponentProps<'div'> {
  title?: string
  description?: string
  icon?: React.ReactNode
}

export function ConversationEmptyState({
  className,
  title,
  description,
  icon,
  children,
  ...props
}: ConversationEmptyStateProps): React.ReactElement {
  const { t } = useT('conversation')
  const resolvedTitle = title ?? t('empty.title')
  const resolvedDescription = description ?? t('empty.description')
  return (
    <div
      className={cn(
        'flex size-full flex-col items-center justify-center gap-3 p-8 text-center',
        className
      )}
      {...props}
    >
      {children ?? (
        <>
          {icon && <div className="text-muted-foreground">{icon}</div>}
          <div className="space-y-1">
            <h3 className="font-medium text-sm">{resolvedTitle}</h3>
            {resolvedDescription && (
              <p className="text-muted-foreground text-sm">{resolvedDescription}</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ===== ConversationScrollButton 滚动到底部 =====

export type ConversationScrollButtonProps = ComponentProps<typeof Button> & { generating?: boolean; orbState?: 'working' | 'searching' | 'connecting' }

export function ConversationScrollButton({
  className,
  generating = false,
  orbState = 'working',
  ...props
}: ConversationScrollButtonProps): React.ReactElement | null {
  const { t } = useT('conversation')
  const { isAtBottom, scrollToBottom, scrollRef, stopScroll } = useStickToBottomContext()
  const [readingTop, setReadingTop] = useState<number | null>(null)
  const [hovered, setHovered] = useState(false)

  useEffect(() => {
    if (!generating) {
      setReadingTop(null)
      setHovered(false)
    }
  }, [generating])

  const returning = generating && isAtBottom && readingTop !== null
  const handleScrollToBottom = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    if (returning && readingTop !== null) {
      stopScroll()
      element.scrollTop = Math.min(readingTop, Math.max(0, element.scrollHeight - element.clientHeight))
      setReadingTop(null)
    } else {
      if (generating) setReadingTop(element.scrollTop)
      void scrollToBottom()
    }
  }, [scrollToBottom, scrollRef, stopScroll, returning, readingTop, generating])

  if (!generating || (isAtBottom && !returning)) return null
  const label = t(returning ? 'scrollLatest.return' : 'scrollLatest.generating')

  return (
    <Button
      className={cn(
        'absolute bottom-[26px] right-[55px] rounded-[17px] size-9',
        'border-[0.5px] border-border',
        className
      )}
      aria-label={label}
      title={label}
      onClick={handleScrollToBottom}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      type="button"
      variant="outline"
      {...props}
    >
      {hovered
        ? returning ? <ArrowUpIcon aria-hidden="true" className="size-4" /> : <ArrowDownIcon aria-hidden="true" className="size-4" />
        : <AIThinkingOrb state={orbState} />}
    </Button>
  )
}
