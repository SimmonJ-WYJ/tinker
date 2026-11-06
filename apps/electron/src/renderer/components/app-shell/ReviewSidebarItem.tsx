/**
 * Sidebar 中 review session 的渲染
 *
 * 视觉对齐 AgentSessionItem 但去掉删除 / 重命名 / 归档操作（review 是 session
 * 演示的 atom，不走主进程持久化）。
 */
import * as React from 'react'
import { FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ReviewSidebarItemProps {
  title: string
  active: boolean
  onSelect: () => void
}

export function ReviewSidebarItem({
  title,
  active,
  onSelect,
}: ReviewSidebarItemProps): React.ReactElement {
  return (
    <Button
      type="button"
      variant="ghost"
      size="row"
      onClick={onSelect}
      className={cn(
        'group p-2 min-w-0',
        active
          ? 'bg-accent text-accent-foreground'
          : 'text-foreground/80 hover:bg-accent/60 hover:text-foreground',
      )}
    >
      <FileText className="!size-3.5 text-muted-foreground flex-shrink-0" />
      <span className="flex-1 min-w-0 truncate text-sm">{title}</span>
    </Button>
  )
}
