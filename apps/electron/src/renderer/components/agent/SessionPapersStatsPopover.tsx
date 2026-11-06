/**
 * SessionPapersStatsPopover — 分布概览（替代原 SessionPapersStatsBar 常驻条）
 *
 * 简化可视化：
 * - 年份：sparkline（自绘单条曲线）
 * - 来源：chip 列表
 * - 相关度：单条 lo→hi 渐变 bar
 *
 * 数据来自 session-papers-stats.ts。
 */

import * as React from 'react'
import { BarChart3 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Slider } from '@/components/ui/slider'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useT } from '@/hooks/useT'
import type { SessionPapersFilter } from '@/atoms/session-papers-filter-atoms'
import type { NormalizedPaperSource } from '@asci/shared'
import type { SessionPapersStats, YearBucket, SourceBucket } from './session-papers-stats'
import { YearBrushHistogram, type YearCount, type YearRange } from './YearBrushHistogram'

export interface SessionPapersStatsPopoverProps {
  stats: SessionPapersStats
  totalCount: number
  filter: SessionPapersFilter
  onFilterChange: (next: SessionPapersFilter) => void
}

export function SessionPapersStatsPopover({
  stats,
  totalCount,
  filter,
  onFilterChange,
}: SessionPapersStatsPopoverProps): React.ReactElement {
  const { t } = useT('conversation')
  const [open, setOpen] = React.useState(false)

  const handleSourceClick = (source: NormalizedPaperSource): void => {
    if (filter.sources.length === 1 && filter.sources[0] === source) {
      onFilterChange({ ...filter, sources: [] })
    } else {
      onFilterChange({ ...filter, sources: [source] })
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className={cn(
            'h-auto gap-1.5 px-2 py-1 text-sm [&_svg]:size-3.5',
            open
              ? 'bg-accent text-accent-foreground'
              : 'text-foreground/70 hover:bg-accent hover:text-foreground',
          )}
        >
          <BarChart3 className="size-3.5" />
          {t('sessionPapers.overview.trigger')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="text-xs font-medium text-foreground mb-2">
          {t('sessionPapers.overview.title', { count: totalCount })}
        </div>
        <YearBrushSection
          buckets={stats.yearDistribution}
          filter={filter}
          onFilterChange={onFilterChange}
          t={t}
        />
        <SourceChips
          sources={stats.sourceDistribution}
          filter={filter}
          onSourceClick={handleSourceClick}
          t={t}
        />
        <RelevanceBar
          filter={filter}
          onFilterChange={onFilterChange}
          hasRelevance={stats.relevanceDistribution != null}
          t={t}
        />
      </PopoverContent>
    </Popover>
  )
}

/**
 * 年份分布 + 刷选：把稀疏的 yearDistribution 补齐成 min~max 连续序列（缺年补 0），
 * 交给 YearBrushHistogram 做刷选；选区结束写回 filter.yearMin/yearMax（区间），清除则置空。
 */
function YearBrushSection({
  buckets,
  filter,
  onFilterChange,
  t,
}: {
  buckets: YearBucket[]
  filter: SessionPapersFilter
  onFilterChange: (next: SessionPapersFilter) => void
  t: ReturnType<typeof useT<'conversation'>>['t']
}): React.ReactElement {
  const data = React.useMemo<YearCount[]>(() => {
    if (buckets.length === 0) return []
    const min = buckets[0]!.year
    const max = buckets[buckets.length - 1]!.year
    const m = new Map(buckets.map((b) => [b.year, b.count]))
    const out: YearCount[] = []
    for (let y = min; y <= max; y++) out.push({ year: y, count: m.get(y) ?? 0 })
    return out
  }, [buckets])

  // 受控选区：任一边界存在即视为有选择，缺侧钳到数据首/尾年
  const value: YearRange | null =
    filter.yearMin != null || filter.yearMax != null
      ? {
          start: filter.yearMin ?? data[0]?.year ?? 0,
          end: filter.yearMax ?? data[data.length - 1]?.year ?? 0,
        }
      : null

  return (
    <div className="mb-3">
      <div className="text-sm text-foreground/60 mb-1">{t('sessionPapers.overview.yearLabel')}</div>
      {data.length === 0 ? (
        <div className="h-8 flex items-center text-sm text-foreground/40">—</div>
      ) : (
        <YearBrushHistogram
          data={data}
          value={value}
          height={44}
          onChange={(r) =>
            onFilterChange(
              r
                ? { ...filter, yearMin: r.start, yearMax: r.end }
                : { ...filter, yearMin: null, yearMax: null },
            )
          }
          clearLabel={t('sessionPapers.overview.brushClear')}
          renderSummary={({ selection, count, span }) =>
            selection == null
              ? t('sessionPapers.overview.brushEmpty')
              : selection.start === selection.end
                ? t('sessionPapers.overview.brushSingle', { year: selection.start, count })
                : t('sessionPapers.overview.brushRange', {
                    start: selection.start,
                    end: selection.end,
                    count,
                    span,
                  })
          }
        />
      )}
    </div>
  )
}

function SourceChips({
  sources,
  filter,
  onSourceClick,
  t,
}: {
  sources: SourceBucket[]
  filter: SessionPapersFilter
  onSourceClick: (source: NormalizedPaperSource) => void
  t: ReturnType<typeof useT<'conversation'>>['t']
}): React.ReactElement {
  return (
    <div className="mb-3">
      <div className="text-sm text-foreground/60 mb-1">{t('sessionPapers.overview.sourceLabel')}</div>
      {sources.length === 0 ? (
        <div className="text-sm text-foreground/40">—</div>
      ) : (
        <div className="flex flex-wrap gap-1">
          {sources.map((s) => {
            const active = filter.sources.length === 1 && filter.sources[0] === s.source
            return (
              <Tooltip key={s.source}>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="chip"
                    size="chip"
                    onClick={() => onSourceClick(s.source)}
                    aria-label={`${s.source}: ${s.count}`}
                    className={cn(
                      active && 'bg-primary/20 text-foreground ring-1 ring-primary',
                    )}
                  >
                    {s.source} · {s.count}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-sm">
                  <div>{s.source}: {s.count}</div>
                  <div className="text-muted-foreground">
                    {active
                      ? t('sessionPapers.stats.clickToClear')
                      : t('sessionPapers.stats.clickToFilter')}
                  </div>
                </TooltipContent>
              </Tooltip>
            )
          })}
        </div>
      )}
    </div>
  )
}

function RelevanceBar({
  filter,
  onFilterChange,
  hasRelevance,
  t,
}: {
  filter: SessionPapersFilter
  onFilterChange: (next: SessionPapersFilter) => void
  hasRelevance: boolean
  t: ReturnType<typeof useT<'conversation'>>['t']
}): React.ReactElement {
  const value = filter.minRelevance ?? 0
  const displayLabel =
    filter.minRelevance == null
      ? t('sessionPapers.overview.relevanceThresholdAll')
      : t('sessionPapers.overview.relevanceThresholdMin', { value: filter.minRelevance })

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-sm text-foreground/60">{t('sessionPapers.overview.relevanceLabel')}</span>
        <span className="text-sm text-foreground/70 tabular-nums">{displayLabel}</span>
      </div>
      {hasRelevance ? (
        <Slider
          min={0}
          max={100}
          step={1}
          value={[value]}
          onValueChange={(v) => {
            const next = v[0] ?? 0
            onFilterChange({ ...filter, minRelevance: next === 0 ? null : next })
          }}
          aria-label={t('sessionPapers.overview.relevanceLabel')}
          // 让 Track 渲染完整 Low→High 渐变（品牌视觉），Range 透明以保留视觉轨道
          // eslint-disable-next-line asci/no-tailwind-palette -- ADR-003 品牌色渐变（红 lo → 琥珀 mid → 翠绿 hi），相关度视觉锚点
          trackClassName="bg-gradient-to-r from-red-200 via-amber-200 to-emerald-300"
          rangeClassName="bg-transparent"
        />
      ) : (
        <div className="h-2 rounded-full bg-muted" />
      )}
      <div className="flex justify-between text-sm text-foreground/40 mt-0.5">
        <span>{hasRelevance ? t('sessionPapers.overview.lowLabel') : t('sessionPapers.overview.relevanceUnavailable')}</span>
        {hasRelevance && <span>{t('sessionPapers.overview.highLabel')}</span>}
      </div>
    </div>
  )
}
