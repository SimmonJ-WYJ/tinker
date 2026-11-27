/** 消息低频操作：沿用 Radix 菜单的键盘导航和焦点恢复。 */
import { MoreHorizontal, Pencil, RotateCcw, Split, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { useT } from '@/hooks/useT'
export type RevisionAction = 'edit' | 'regenerate'
export type ReviseReply = (assistantUuid: string, action: RevisionAction) => void
interface MessageMoreActionsProps {
  onRevise?: (action: RevisionAction) => void
  onFork?: () => void
  onRewind?: () => void
}
export function MessageMoreActions({ onFork, onRewind, onRevise }: MessageMoreActionsProps): React.ReactElement | null {
  const { t } = useT('conversation')
  if (!onFork && !onRewind && !onRevise) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t('messageMoreActions')} title={t('messageMoreActions')}>
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {onFork && <DropdownMenuItem onSelect={onFork}><Split aria-hidden="true" />{t('fork.tooltip')}</DropdownMenuItem>}
        {onRevise && <>
          <DropdownMenuItem onSelect={() => onRevise('edit')}><Pencil aria-hidden="true" />{t('revision.edit')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onRevise('regenerate')}><RotateCcw aria-hidden="true" />{t('revision.regenerate')}</DropdownMenuItem>
        </>}
        {onRewind && <DropdownMenuItem onSelect={onRewind}><Undo2 aria-hidden="true" />{t('rewind.tooltip')}</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
