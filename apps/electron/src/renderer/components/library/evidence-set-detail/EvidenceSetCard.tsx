/**
 * EvidenceSetCard —— 证据集列表卡片，跨视图共享。
 *
 * 用处：
 * - PaperContainingEvidenceSetsPanel 的 "被以下证据集引用" 区
 * - NotesView 的 "全部证据集" 列表
 *
 * 视觉契约（严格一致）：
 *   ┌─ 卡片 ─────────────────────────────┐
 *   │ 集合名 [N 篇论文]                  > │
 *   │ note preview（可选，line-clamp-1）  │
 *   └────────────────────────────────────┘
 * - border + shadow-sm 平面卡，hover 两态都用 bg-muted/35（同 PaperContaining）
 * - active 只加深 border（border-foreground/30），不动 bg —— 避免与 hover 灰底混淆，
 *   也保持和 PaperContaining "默认无选中态" 列表的像素级同源
 * - 主标紧贴 paperCount badge（gap-2）；不放时间避免抢焦点
 *
 * preview 为 undefined / 空 → 不渲染副行（紧凑布局）。
 */
import * as React from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useT } from '@/hooks/useT'

interface EvidenceSetCardProps {
  label: string
  paperCount: number
  preview?: string
  active?: boolean
  onClick: () => void
}

export function EvidenceSetCard({
  label,
  paperCount,
  preview,
  active = false,
  onClick,
}: EvidenceSetCardProps): React.ReactElement {
  const { t } = useT('library')
  const showPreview = preview != null && preview.length > 0
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      className={cn(
        'group h-auto w-full items-stretch justify-start rounded-md border bg-card text-left shadow-sm',
        'px-3 py-2.5 font-normal [&_svg]:size-3.5',
        'hover:bg-muted/35 hover:text-foreground',
        active ? 'border-foreground/30' : 'border-border hover:border-border/80',
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-sm font-semibold leading-snug text-foreground">
            {label}
          </span>
          <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-badge leading-none text-muted-foreground tabular-nums">
            {t('detail.evidence.referencedIn.paperCount', { count: paperCount })}
          </span>
        </div>
        {showPreview && (
          <div className="line-clamp-1 text-sm leading-snug text-muted-foreground">
            {preview}
          </div>
        )}
      </div>
      <ChevronRight
        className="my-auto ml-2 size-3.5 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-muted-foreground"
        aria-hidden
      />
    </Button>
  )
}
