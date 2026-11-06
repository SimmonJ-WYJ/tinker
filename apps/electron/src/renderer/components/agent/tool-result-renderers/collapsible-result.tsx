/**
 * 可折叠长内容包装器
 *
 * 替代硬截断 2000 字符的方案：
 * - 短内容直接展示
 * - 长内容默认折叠，显示前 N 行 + 长度指示器
 * - 点击展开/收起全部内容
 */

import * as React from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useT } from '@/hooks/useT'
import { usePreserveScrollOnExpand } from '@/hooks/usePreserveScrollOnExpand'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface CollapsibleResultProps {
  /** 内容文本 */
  content: string
  /** 折叠阈值（字符数），超过此值时启用折叠，默认 3000 */
  threshold?: number
  /** 折叠时显示的行数，默认 15 */
  previewLines?: number
  /**
   * 自定义渲染函数，接收内容文本返回 JSX。
   * 第二参 ctx.collapsed 告知当前是否走折叠（带边框卡）分支，供调用方据此调整内边距等，
   * 避免调用方自行重算 content.length > threshold 与本组件的折叠判定耦合。
   */
  renderContent: (text: string, ctx: { collapsed: boolean }) => React.ReactNode
  /** 外层 className */
  className?: string
}

export function CollapsibleResult({
  content,
  threshold = 3000,
  previewLines = 15,
  renderContent,
  className,
}: CollapsibleResultProps): React.ReactElement {
  const { t } = useT('conversation')
  const [expanded, setExpanded] = React.useState(false)
  const { snapshot } = usePreserveScrollOnExpand(expanded)
  const needsCollapse = content.length > threshold

  const displayContent = React.useMemo(() => {
    if (!needsCollapse || expanded) return content
    const lines = content.split('\n')
    if (lines.length <= previewLines) return content
    return lines.slice(0, previewLines).join('\n')
  }, [content, needsCollapse, expanded, previewLines])

  if (!needsCollapse) {
    return <div className={cn('relative', className)}>{renderContent(content, { collapsed: false })}</div>
  }

  return (
    <div className={cn('not-prose overflow-hidden rounded-xl border border-border/60 bg-card/70 shadow-none', className)}>
      <div className="relative">
        {renderContent(displayContent, { collapsed: true })}
        {!expanded && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card/90 to-transparent" />
        )}
      </div>
      <div className="flex items-center justify-between border-t border-border/50 px-3 py-2">
        <span className="text-sm text-muted-foreground/70">
          {expanded
            ? t('agent.toolResult.fullContent')
            : t('agent.toolResult.previewLines', { count: displayContent.split('\n').length })}
        </span>
        <Button
          type="button"
          variant="subtle"
          size="inline"
          onClick={() => { snapshot(); setExpanded(!expanded) }}
          className="flex items-center gap-1 text-muted-foreground/70 hover:text-foreground/80 [&_svg]:size-3"
        >
          {expanded ? (
            <>
              <ChevronUp className="size-3" />
              {t('agent.toolResult.collapse')}
            </>
          ) : (
            <>
              <ChevronDown className="size-3" />
              {t('agent.toolResult.showAll', { chars: content.length.toLocaleString(), lines: content.split('\n').length })}
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
