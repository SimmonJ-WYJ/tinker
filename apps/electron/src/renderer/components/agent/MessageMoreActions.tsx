/** 消息低频操作：沿用 Radix 菜单的键盘导航和焦点恢复。 */
import { MoreHorizontal, Split, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useT } from '@/hooks/useT'
interface MessageMoreActionsProps {
  onFork?: () => void
  onRewind?: () => void
}
export function MessageMoreActions({ onFork, onRewind }: MessageMoreActionsProps): React.ReactElement | null {
  const { t } = useT('conversation')
  if (!onFork && !onRewind) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t('messageMoreActions')} title={t('messageMoreActions')}>
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {onFork && <DropdownMenuItem onSelect={onFork}><Split aria-hidden="true" />{t('fork.tooltip')}</DropdownMenuItem>}
        {onRewind && <DropdownMenuItem onSelect={onRewind}><Undo2 aria-hidden="true" />{t('rewind.tooltip')}</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
