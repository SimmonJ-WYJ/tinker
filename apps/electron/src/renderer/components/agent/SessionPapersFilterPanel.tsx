/**
 * SessionPapersFilterPanel — 检索结果「筛选」单一面板（合并原 整体概览 + 更多筛选）
 *
 * 单一入口、单一面板，分两段：
 * - 分布概览（点选即筛选）：年份刷选 / 来源 chips / 相关度滑块（数据来自 session-papers-stats）
 * - 更多条件：引用量 / 综合评分 / JCR 分区 / 影响因子 / 期刊会议等级 / 仅显示有摘要
 *
 * 设计动因：两者本质都是「收窄检索结果」，原先拆成两个 popover、两种交互对（尤其新）
 * 用户难建立心智模型 —— 合并为一个地方。排序仍走工具栏下拉；分组标题保留升降序箭头。
 */

import * as React from 'react'
import { BarChart3, ChevronDown, ChevronUp, Filter, X } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Slider } from '@/components/ui/slider'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { type VenueTier, type NormalizedPaperSource } from '@asci/shared'
import {
  type SessionPapersFilter,
  type SessionPapersSortMode,
  EMPTY_SESSION_PAPERS_FILTER,
  countActiveFilters,
} from '@/atoms/session-papers-filter-atoms'
import type { SessionPapersStats, YearBucket, SourceBucket } from './session-papers-stats'
import { YearBrushHistogram, type YearCount, type YearRange } from './YearBrushHistogram'
import { useT } from '@/hooks/useT'
import { sessionPapersToolbarIconButtonClassNames } from './session-papers-toolbar-primitives.ts'

export interface SessionPapersFilterPanelProps {
  stats: SessionPapersStats
  /** 合并去重后的总数，用于面板标题计数 */
  totalCount: number
  /** 经过筛选后的显示数；与 totalCount 不同时头部显示 filteredCount / totalCount */
  filteredCount: number
  filter: SessionPapersFilter
  onFilterChange: (next: SessionPapersFilter) => void
  /** 当前排序模式（与工具栏排序下拉同源），分组标题排序箭头读写 */
  sort: SessionPapersSortMode
  onSortChange: (next: SessionPapersSortMode) => void
}

const CITATION_TIERS = [
  { value: null, labelKey: 'sessionPapers.filter.citationsAny' },
  { value: 10, labelKey: 'sessionPapers.filter.citationsMin10' },
  { value: 50, labelKey: 'sessionPapers.filter.citationsMin50' },
  { value: 100, labelKey: 'sessionPapers.filter.citationsMin100' },
  { value: 500, labelKey: 'sessionPapers.filter.citationsMin500' },
] as const

/** 评分档位与 ScoreBadge 配色分桶（≥80 / ≥65 / ≥50）保持一致 */
const SCORE_TIERS = [
  { value: null, labelKey: 'sessionPapers.filter.scoreAny' },
  { value: 50, labelKey: 'sessionPapers.filter.scoreMin50' },
  { value: 65, labelKey: 'sessionPapers.filter.scoreMin65' },
  { value: 80, labelKey: 'sessionPapers.filter.scoreMin80' },
] as const

/** IF 档位与卡片 impactFactorClass 分档（≥10 / ≥5 / ≥2）保持一致 */
const IF_TIERS = [
  { value: null, labelKey: 'sessionPapers.filter.ifAny' },
  { value: 2, labelKey: 'sessionPapers.filter.ifMin2' },
  { value: 5, labelKey: 'sessionPapers.filter.ifMin5' },
  { value: 10, labelKey: 'sessionPapers.filter.ifMin10' },
] as const

type TierKey =
  | (typeof CITATION_TIERS)[number]['labelKey']
  | (typeof SCORE_TIERS)[number]['labelKey']
  | (typeof IF_TIERS)[number]['labelKey']

const JCR_PARTITIONS = [
  { value: 'Q1', labelKey: 'sessionPapers.filter.jcrQ1' },
  { value: 'Q2', labelKey: 'sessionPapers.filter.jcrQ2' },
  { value: 'Q3', labelKey: 'sessionPapers.filter.jcrQ3' },
  { value: 'Q4', labelKey: 'sessionPapers.filter.jcrQ4' },
] as const

/** 可筛选的 venue 等级（'unknown' 视为缺失，不提供选项） */
const VENUE_TIERS = [
  { value: 'top', labelKey: 'sessionPapers.filter.venueTierTop' },
  { value: 'strong', labelKey: 'sessionPapers.filter.venueTierStrong' },
  { value: 'normal', labelKey: 'sessionPapers.filter.venueTierNormal' },
  { value: 'weak', labelKey: 'sessionPapers.filter.venueTierWeak' },
] as const satisfies ReadonlyArray<{ value: VenueTier; labelKey: string }>

/** 多选数组的 toggle：已在则移除，未在则追加 */
function toggleIn<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]
}

export function SessionPapersFilterPanel({
  stats,
  totalCount,
  filteredCount,
  filter,
  onFilterChange,
  sort,
  onSortChange,
}: SessionPapersFilterPanelProps): React.ReactElement {
  const { t } = useT('conversation')
  const hasActive = countActiveFilters(filter) > 0
  const [open, setOpen] = React.useState(false)

  // —— 分布概览：来源点选 ——（单选切换，再点取消）
  const handleSourceClick = (source: NormalizedPaperSource): void => {
    if (filter.sources.length === 1 && filter.sources[0] === source) {
      onFilterChange({ ...filter, sources: [] })
    } else {
      onFilterChange({ ...filter, sources: [source] })
    }
  }

  // —— 更多条件：各维度 setter ——
  const setMinCitations = (v: number | null) => onFilterChange({ ...filter, minCitations: v })
  const setMinRelevance = (v: number | null) => onFilterChange({ ...filter, minRelevance: v })
  const setMinImpactFactor = (v: number | null) => onFilterChange({ ...filter, minImpactFactor: v })
  const toggleJcrPartition = (q: string) =>
    onFilterChange({ ...filter, jcrPartitions: toggleIn(filter.jcrPartitions, q) })
  const toggleVenueTier = (tier: VenueTier) =>
    onFilterChange({ ...filter, venueTiers: toggleIn(filter.venueTiers, tier) })
  const toggleAbstractOnly = () => onFilterChange({ ...filter, abstractOnly: !filter.abstractOnly })
  const reset = () => onFilterChange({ ...EMPTY_SESSION_PAPERS_FILTER })

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              aria-label={t('sessionPapers.filter.button')}
              className={sessionPapersToolbarIconButtonClassNames({
                active: open,
                className: hasActive ? 'text-primary' : undefined,
              })}
            >
              <Filter className="size-3.5" />
              {hasActive && (
                <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-primary" />
              )}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('sessionPapers.filter.button')}</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="start"
        className="w-[400px] max-w-[calc(100vw-2rem)] p-3 max-h-[72vh] overflow-auto space-y-3"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/* 头部：标题 + 计数 + 重置 */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">
            {t('sessionPapers.filter.title')}
            <span className="ml-1.5 text-sm font-normal text-muted-foreground tabular-nums">
              {hasActive && filteredCount !== totalCount ? `· ${filteredCount} / ${totalCount}` : `· ${totalCount}`}
            </span>
          </span>
          {hasActive && (
            <Button
              type="button"
              variant="subtle"
              size="inline"
              onClick={reset}
              className="flex items-center gap-1 text-sm [&_svg]:size-2.5"
            >
              <X className="size-2.5" />
              {t('sessionPapers.filter.reset')}
            </Button>
          )}
        </div>

        {/* —— 段 1：分布概览（点选即筛选） —— */}
        <SectionLabel icon={<BarChart3 className="size-3" />} text={t('sessionPapers.filter.sectionOverview')} />
        <YearBrushSection buckets={stats.yearDistribution} filter={filter} onFilterChange={onFilterChange} t={t} />
        <SourceChips sources={stats.sourceDistribution} filter={filter} onSourceClick={handleSourceClick} t={t} />
        <RelevanceBar filter={filter} onFilterChange={onFilterChange} hasRelevance={stats.relevanceDistribution != null} t={t} />

        <div className="h-px bg-border" />

        {/* —— 段 2：更多条件 —— */}
        <SectionLabel icon={<Filter className="size-3" />} text={t('sessionPapers.filter.sectionMore')} />

        <TierChipGroup
          label={t('sessionPapers.filter.citations')}
          tiers={CITATION_TIERS}
          selected={filter.minCitations}
          onSelect={setMinCitations}
          sortControl={<SortArrows label={t('sessionPapers.filter.citations')} ascMode="citations-asc" descMode="citations-desc" sort={sort} onSortChange={onSortChange} />}
        />
        <TierChipGroup
          label={t('sessionPapers.filter.score')}
          tiers={SCORE_TIERS}
          selected={filter.minRelevance}
          onSelect={setMinRelevance}
          sortControl={<SortArrows label={t('sessionPapers.filter.score')} ascMode="relevance-asc" descMode="relevance-desc" sort={sort} onSortChange={onSortChange} />}
        />
        <MultiSelectChipGroup
          label={t('sessionPapers.filter.jcrPartition')}
          items={JCR_PARTITIONS.map((q) => ({ value: q.value, label: t(q.labelKey) }))}
          selected={filter.jcrPartitions}
          onToggle={toggleJcrPartition}
          sortControl={<SortArrows label={t('sessionPapers.filter.jcrPartition')} ascMode="jcr-asc" descMode="jcr-desc" sort={sort} onSortChange={onSortChange} />}
        />
        <TierChipGroup
          label={t('sessionPapers.filter.impactFactor')}
          tiers={IF_TIERS}
          selected={filter.minImpactFactor}
          onSelect={setMinImpactFactor}
          sortControl={<SortArrows label={t('sessionPapers.filter.impactFactor')} ascMode="impact-asc" descMode="impact-desc" sort={sort} onSortChange={onSortChange} />}
        />
        <MultiSelectChipGroup
          label={t('sessionPapers.filter.venueTier')}
          items={VENUE_TIERS.map((tier) => ({ value: tier.value, label: t(tier.labelKey) }))}
          selected={filter.venueTiers}
          onToggle={toggleVenueTier}
          sortControl={<SortArrows label={t('sessionPapers.filter.venueTier')} ascMode="venue-tier-asc" descMode="venue-tier-desc" sort={sort} onSortChange={onSortChange} />}
        />
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={filter.abstractOnly}
            onChange={toggleAbstractOnly}
            className="size-3 cursor-pointer"
          />
          <span className="text-xs">{t('sessionPapers.filter.abstractOnly')}</span>
        </label>
      </PopoverContent>
    </Popover>
  )
}

/** 段标题：淡灰小标题 + 轻图标 */
function SectionLabel({ icon, text }: { icon: React.ReactNode; text: string }): React.ReactElement {
  return (
    <div className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground/80 [&_svg]:text-muted-foreground/70">
      {icon}
      {text}
    </div>
  )
}

// ===================== 分布概览 section（自 StatsPopover 迁入） =====================

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
                    className={cn(active && 'bg-primary/20 text-foreground ring-1 ring-primary')}
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

// ===================== 更多条件 section（自 FilterPopover 迁入） =====================

interface SortArrowsProps {
  label: string
  ascMode: SessionPapersSortMode
  descMode: SessionPapersSortMode
  sort: SessionPapersSortMode
  onSortChange: (next: SessionPapersSortMode) => void
}

/** 分组标题旁的升/降序箭头：点击切到对应排序模式，命中态主色高亮 */
function SortArrows({ label, ascMode, descMode, sort, onSortChange }: SortArrowsProps): React.ReactElement {
  const { t } = useT('conversation')
  const arrow = (mode: SessionPapersSortMode, Icon: typeof ChevronUp, ariaLabel: string) => {
    const active = sort === mode
    return (
      <button
        type="button"
        aria-label={ariaLabel}
        aria-pressed={active}
        onClick={() => onSortChange(mode)}
        className={cn(
          'flex h-3.5 w-3.5 items-center justify-center rounded-sm',
          active ? 'text-primary' : 'text-muted-foreground/50 hover:text-foreground hover:bg-accent',
        )}
      >
        <Icon className="size-3" />
      </button>
    )
  }
  return (
    <span className="inline-flex items-center">
      {arrow(descMode, ChevronDown, t('sessionPapers.filter.sortDesc', { label }))}
      {arrow(ascMode, ChevronUp, t('sessionPapers.filter.sortAsc', { label }))}
    </span>
  )
}

interface MultiSelectChipGroupProps<T extends string> {
  label: string
  items: ReadonlyArray<{ value: T; label: string }>
  selected: readonly T[]
  onToggle: (v: T) => void
  sortControl?: React.ReactNode
}

/** 多选 chips 组（JCR 分区 / Venue 等级共用）：可多项命中，命中态主色描边 */
function MultiSelectChipGroup<T extends string>({
  label,
  items,
  selected,
  onToggle,
  sortControl,
}: MultiSelectChipGroupProps<T>): React.ReactElement {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        <label className="text-sm font-medium text-muted-foreground">{label}</label>
        {sortControl}
      </div>
      <div className="flex flex-wrap gap-1">
        {items.map((item) => {
          const checked = selected.includes(item.value)
          return (
            <Button
              key={item.value}
              type="button"
              variant="chip"
              size="chip"
              onClick={() => onToggle(item.value)}
              className={cn(
                'border',
                checked
                  ? 'bg-primary/10 text-primary border-primary/30 hover:bg-primary/15 hover:text-primary'
                  : 'border-transparent',
              )}
            >
              {item.label}
            </Button>
          )
        })}
      </div>
    </div>
  )
}

interface TierChipGroupProps {
  label: string
  tiers: ReadonlyArray<{ value: number | null; labelKey: TierKey }>
  selected: number | null
  onSelect: (v: number | null) => void
  sortControl?: React.ReactNode
}

/** 单选档位 chips 组（引用量 / 评分 / IF 共用）：点击互斥，命中态主色描边 */
function TierChipGroup({ label, tiers, selected, onSelect, sortControl }: TierChipGroupProps): React.ReactElement {
  const { t } = useT('conversation')
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        <label className="text-sm font-medium text-muted-foreground">{label}</label>
        {sortControl}
      </div>
      <div className="flex flex-wrap gap-1">
        {tiers.map((tier) => {
          const checked = selected === tier.value
          return (
            <Button
              key={tier.labelKey}
              type="button"
              variant="ghost"
              size="chip"
              onClick={() => onSelect(tier.value)}
              className={cn(
                'rounded border text-sm',
                checked
                  ? 'bg-primary/10 border-primary/30 text-primary hover:bg-primary/15 hover:text-primary'
                  : 'bg-muted/30 border-transparent text-muted-foreground hover:bg-muted/50 hover:text-muted-foreground',
              )}
            >
              {t(tier.labelKey)}
            </Button>
          )
        })}
      </div>
    </div>
  )
}
