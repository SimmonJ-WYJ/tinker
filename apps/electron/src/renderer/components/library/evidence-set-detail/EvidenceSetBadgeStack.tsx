/**
 * [mockup] 多 EvidenceSet 徽标堆叠 — 用于在 paper 卡片头部直接显示已加入的集合
 *
 * 0.2 followup: 当前未挂载,代码先落地保留备用,将来重新启用 paper → 证据集
 * 反向展示时挂入 ItemDetailPanel 等位置。
 *
 * 显示规则:
 * - 0 个: 不渲染
 * - 1 个: 单徽标显示 set.name 截断,点击打开 Sheet
 * - ≥2 个: 第一个徽标 + "+N";点 +N 弹 popover 列所有集合
 */
import * as React from 'react'
import { useSetAtom } from 'jotai'
import { Layers } from 'lucide-react'
import type { EvidenceSet } from '@asci/shared'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { openEvidenceSetIdAtom } from '@/atoms/open-evidence-set-atom'
import { useT } from '@/hooks/useT'
import { cn } from '@/lib/utils'

interface EvidenceSetBadgeStackProps {
  sets: EvidenceSet[]
}

export function EvidenceSetBadgeStack({ sets }: EvidenceSetBadgeStackProps): React.ReactElement | null {
  const { t } = useT('library')
  const setOpenId = useSetAtom(openEvidenceSetIdAtom)
  const [overflowOpen, setOverflowOpen] = React.useState(false)

  const first = sets[0]
  if (!first) return null
  const rest = sets.slice(1)

  return (
    <div className="inline-flex items-center gap-1">
      <SingleBadge set={first} onClick={() => setOpenId(first.id)} />
      {rest.length > 0 && (
        <Popover open={overflowOpen} onOpenChange={setOverflowOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="chip"
              size="chip"
              className="rounded-md px-1.5 text-muted-foreground"
              aria-label={t('evidenceSetDetail.badge.moreLabel', { count: rest.length })}
            >
              +{rest.length}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto min-w-[200px] p-1">
            {rest.map((s) => (
              <Button
                key={s.id}
                type="button"
                variant="list"
                size="row"
                onClick={() => {
                  setOverflowOpen(false)
                  setOpenId(s.id)
                }}
                className="px-2 py-1.5 text-xs hover:bg-muted hover:text-foreground rounded-sm [&_svg]:size-3"
              >
                <Layers className="h-3 w-3 text-muted-foreground" />
                <span className="truncate">{s.name || t('evidenceSetDetail.untitled')}</span>
              </Button>
            ))}
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}

interface SingleBadgeProps {
  set: EvidenceSet
  onClick: () => void
}

function SingleBadge({ set, onClick }: SingleBadgeProps): React.ReactElement {
  const { t } = useT('library')
  return (
    <Button
      type="button"
      variant="chip"
      size="chip"
      onClick={onClick}
      className={cn(
        'gap-1 rounded-md',
        'bg-success/10 text-success hover:bg-success/20',
        'max-w-[180px] [&_svg]:size-3',
      )}
      title={set.name}
    >
      <Layers className="h-3 w-3 shrink-0" />
      <span className="truncate">{set.name || t('evidenceSetDetail.untitled')}</span>
    </Button>
  )
}
