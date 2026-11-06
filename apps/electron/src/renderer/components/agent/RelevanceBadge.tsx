/**
 * RelevanceBadge — 论文相关度评分徽章（F22 issue #93）
 *
 * 色阶：≥70 绿，40-69 琥珀，<40 灰。
 * Hover tooltip 显示评分依据维度。
 * score 为 null 时不渲染。
 */

import * as React from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useT } from '@/hooks/useT'

interface RelevanceBadgeProps {
  /** 相关度评分 0-100 整数，null 时不显示 */
  score: number | null
  /** 实际使用的评分维度名列表 */
  breakdown: string[] | null
  /** 额外 className */
  className?: string
}

function scoreColorClasses(score: number, isPartial: boolean): string {
  // 部分维度评分（isPartial=true）：强制走 muted，不让 ~100 借用满分的亮绿
  // 来源 issue #361 C2：scoring.py 在缺失维度时按比例放大已有维度，导致大量论文
  // 仅有 recency + keyword_relevance 就拿到 ~100 分；视觉与真满分一致严重误导。
  if (isPartial) {
    return 'bg-muted text-muted-foreground border border-dashed border-muted-foreground/40'
  }
  if (score >= 70) {
    return 'bg-success/10 text-success'
  }
  if (score >= 40) {
    return 'bg-warning/10 text-warning'
  }
  return 'bg-muted text-muted-foreground'
}

export function RelevanceBadge({ score, breakdown, className }: RelevanceBadgeProps): React.ReactElement | null {
  const { t } = useT('conversation')

  if (score == null) return null

  const dimLabelMap: Record<string, string> = {
    citations: t('sessionPapers.scoreBadge.dimCitations'),
    recency: t('sessionPapers.scoreBadge.dimRecency'),
    citation_velocity: t('sessionPapers.scoreBadge.dimCitationVelocity'),
    venue_presence: t('sessionPapers.scoreBadge.dimVenue'),
    keyword_relevance: t('sessionPapers.scoreBadge.dimKeyword'),
  }

  const totalDimensions = Object.keys(dimLabelMap).length
  const usedCount = (breakdown ?? []).length
  const isPartial = usedCount > 0 && usedCount < totalDimensions

  const dimensionLabels = (breakdown ?? [])
    .map((dim) => dimLabelMap[dim] ?? dim)
    .filter(Boolean)

  const tooltipLines: string[] = []
  if (dimensionLabels.length > 0) {
    tooltipLines.push(t('sessionPapers.scoreBadge.tooltip', { dimensions: dimensionLabels.join(' + ') }))
  } else {
    tooltipLines.push(t('sessionPapers.scoreBadge.noData'))
  }
  if (isPartial) {
    tooltipLines.push(t('sessionPapers.scoreBadge.partialHint', { used: usedCount, total: totalDimensions }))
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex items-center rounded-md px-1 py-0.5 text-badge font-normal leading-none cursor-default',
            scoreColorClasses(score, isPartial),
            className,
          )}
        >
          {isPartial ? `~${score}` : score}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[260px] text-xs">
        {tooltipLines.map((line, i) => (
          <p key={i} className={i > 0 ? 'mt-1 text-muted-foreground' : undefined}>{line}</p>
        ))}
      </TooltipContent>
    </Tooltip>
  )
}
