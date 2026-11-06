/**
 * SessionPapersBulkActionBar — 多选态顶部黑色操作 bar
 *
 * 展示已选数量 + 批量动作 + 退出按钮。当前批量动作只接 Add to Zotero
 * （沿用现有逐条 IPC，循环调用即可）；其余动作（Tag / Remove）显示但
 * 点击 toast「待上线」。
 */
import * as React from 'react'
import { X, BookMarked } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useT } from '@/hooks/useT'

export interface SessionPapersBulkActionBarProps {
  selectedCount: number
  totalCount: number
  onAddToZoteroBatch: () => void | Promise<void>
  onExit: () => void
  onToggleSelectAll: () => void
}

export function SessionPapersBulkActionBar({
  selectedCount,
  totalCount,
  onAddToZoteroBatch,
  onExit,
  onToggleSelectAll,
}: SessionPapersBulkActionBarProps): React.ReactElement {
  const { t } = useT('conversation')
  const [submitting, setSubmitting] = React.useState(false)

  const handleAdd = async (): Promise<void> => {
    if (selectedCount === 0 || submitting) return
    setSubmitting(true)
    try {
      await onAddToZoteroBatch()
    } finally {
      setSubmitting(false)
    }
  }

  const allSelected = totalCount > 0 && selectedCount === totalCount
  const someSelected = selectedCount > 0 && selectedCount < totalCount
  const checkedState: boolean | 'indeterminate' = allSelected
    ? true
    : someSelected
    ? 'indeterminate'
    : false

  return (
    <div className={cn(
      'mx-1 mt-2 flex items-center justify-between gap-2 px-3 py-2 rounded-md',
      'bg-foreground text-background text-sm',
    )}>
      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Checkbox
              checked={checkedState}
              onCheckedChange={onToggleSelectAll}
              disabled={totalCount === 0}
              aria-label={allSelected ? t('sessionPapers.bulk.clearAll') : t('sessionPapers.bulk.selectAll')}
              className="border-background/60 data-[state=checked]:bg-background data-[state=checked]:text-foreground data-[state=indeterminate]:bg-background data-[state=indeterminate]:text-foreground"
            />
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>{allSelected ? t('sessionPapers.bulk.clearAll') : t('sessionPapers.bulk.selectAll')}</p>
          </TooltipContent>
        </Tooltip>
        <span className="font-medium">
          {t('sessionPapers.bulk.selectedSummary', { selected: selectedCount, total: totalCount })}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleAdd}
          disabled={selectedCount === 0 || submitting}
          className={cn(
            'h-auto gap-1 px-2 py-1 rounded text-sm',
            'bg-background/15 hover:bg-background/25',
            'disabled:cursor-not-allowed [&_svg]:size-3',
          )}
        >
          <BookMarked className="size-3" />
          {t('sessionPapers.bulk.addToZotero')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onExit}
          title={t('sessionPapers.bulk.exit')}
          className="h-[26px] w-[26px] rounded hover:bg-background/20 [&_svg]:size-3.5"
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}
