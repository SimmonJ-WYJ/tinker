/**
 * SessionPapersMoreMenu — ⋮ 二级菜单
 *
 * 仅保留低频项：刷新 / 在新窗口打开。
 * （多选与显示密度已提到工具栏下行常驻，见 SessionPapersToolbar；
 *   找研究空白入口在多选态底部动作条，见 SessionPapersSelectionActions）
 */
import * as React from 'react'
import { MoreHorizontal, RotateCw, ExternalLink } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useT } from '@/hooks/useT'

export interface SessionPapersMoreMenuProps {
  className?: string
  onRefresh: () => void
  onOpenInNewWindow: () => void
}

export function SessionPapersMoreMenu({
  className,
  onRefresh,
  onOpenInNewWindow,
}: SessionPapersMoreMenuProps): React.ReactElement {
  const { t } = useT('conversation')

  const [open, setOpen] = React.useState(false)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn(
            'h-[28px] w-[28px] rounded-xl focus:outline-none focus-visible:outline-none [&_svg]:size-3.5',
            open
              ? 'bg-accent text-accent-foreground'
              : 'text-foreground/70 hover:bg-accent hover:text-foreground',
            className,
          )}
          title={t('sessionPapers.more.trigger')}
        >
          <MoreHorizontal className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} collisionPadding={8} className="w-max min-w-44">
        <DropdownMenuItem onSelect={onRefresh} className="whitespace-nowrap">
          <RotateCw className="size-3.5 mr-2" />
          {t('sessionPapers.more.refresh')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onOpenInNewWindow} className="whitespace-nowrap">
          <ExternalLink className="size-3.5 mr-2" />
          {t('sessionPapers.more.openInNewWindow')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
