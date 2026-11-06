/**
 * SessionPapersFilterPopover — Session 检索结果筛选 Popover
 *
 * 维度：引用量 / 综合评分 / JCR 分区 / 影响因子 / Venue 等级 / 摘要可用性。
 * - 引用量 / 评分 / IF：单选档位；JCR 分区 / Venue 等级：多选 chips
 * - 评分档位写 minRelevance（score.finalScore），与 Overview 弹窗滑块同源
 * - 年份 / 来源维度由 Overview（StatsPopover）柱状条点选承担，此处不再重复
 */

import * as React from 'react'
import { ChevronDown, ChevronUp, Filter, X } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { type VenueTier } from '@asci/shared'
import {
  type SessionPapersFilter,
  type SessionPapersSortMode,
  EMPTY_SESSION_PAPERS_FILTER,
  countActiveFilters,
} from '@/atoms/session-papers-filter-atoms'
import { useT } from '@/hooks/useT'

interface SessionPapersFilterPopoverProps {
  value: SessionPapersFilter
  onChange: (next: SessionPapersFilter) => void
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

export function SessionPapersFilterPopover({
  value,
  onChange,
  sort,
  onSortChange,
}: SessionPapersFilterPopoverProps): React.ReactElement {
  const { t } = useT('conversation')
  const activeCount = countActiveFilters(value)
  const hasActive = activeCount > 0

  const setMinCitations = (v: number | null) => {
    onChange({ ...value, minCitations: v })
  }

  const setMinRelevance = (v: number | null) => {
    onChange({ ...value, minRelevance: v })
  }

  const setMinImpactFactor = (v: number | null) => {
    onChange({ ...value, minImpactFactor: v })
  }

  const toggleJcrPartition = (q: string) =>
    onChange({ ...value, jcrPartitions: toggleIn(value.jcrPartitions, q) })

  const toggleVenueTier = (tier: VenueTier) =>
    onChange({ ...value, venueTiers: toggleIn(value.venueTiers, tier) })

  const toggleAbstractOnly = () => {
    onChange({ ...value, abstractOnly: !value.abstractOnly })
  }

  const reset = () => onChange({ ...EMPTY_SESSION_PAPERS_FILTER })

  const [open, setOpen] = React.useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* 与 Overview 触发器同款「图标 + 名称」，名称常显不依赖 hover；激活时左移色 + 右上角圆点 */}
        <Button
          type="button"
          variant="ghost"
          className={cn(
            'relative h-auto gap-1.5 px-2 py-1 text-sm [&_svg]:size-3.5',
            open
              ? 'bg-accent text-accent-foreground'
              : hasActive
              ? 'text-primary hover:bg-accent'
              : 'text-foreground/70 hover:bg-accent hover:text-foreground',
          )}
        >
          <Filter className="size-3.5" />
          {t('sessionPapers.filter.button')}
          {hasActive && (
            <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-primary" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3 space-y-3" onOpenAutoFocus={(e) => e.preventDefault()}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">{t('sessionPapers.filter.title')}</span>
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

        {/* 年份 / 来源维度已下放到 Overview（StatsPopover）的柱状条点选，此处不再重复 */}

        {/* 引用量 */}
        <TierChipGroup
          label={t('sessionPapers.filter.citations')}
          tiers={CITATION_TIERS}
          selected={value.minCitations}
          onSelect={setMinCitations}
          sortControl={
            <SortArrows
              label={t('sessionPapers.filter.citations')}
              ascMode="citations-asc"
              descMode="citations-desc"
              sort={sort}
              onSortChange={onSortChange}
            />
          }
        />

        {/* 综合评分（score.finalScore，经 minRelevance 与 Overview 滑块同源） */}
        <TierChipGroup
          label={t('sessionPapers.filter.score')}
          tiers={SCORE_TIERS}
          selected={value.minRelevance}
          onSelect={setMinRelevance}
          sortControl={
            <SortArrows
              label={t('sessionPapers.filter.score')}
              ascMode="relevance-asc"
              descMode="relevance-desc"
              sort={sort}
              onSortChange={onSortChange}
            />
          }
        />

        {/* JCR 分区（↓ = Q1 优先） */}
        <MultiSelectChipGroup
          label={t('sessionPapers.filter.jcrPartition')}
          items={JCR_PARTITIONS.map((q) => ({ value: q.value, label: t(q.labelKey) }))}
          selected={value.jcrPartitions}
          onToggle={toggleJcrPartition}
          sortControl={
            <SortArrows
              label={t('sessionPapers.filter.jcrPartition')}
              ascMode="jcr-asc"
              descMode="jcr-desc"
              sort={sort}
              onSortChange={onSortChange}
            />
          }
        />

        {/* 影响因子 */}
        <TierChipGroup
          label={t('sessionPapers.filter.impactFactor')}
          tiers={IF_TIERS}
          selected={value.minImpactFactor}
          onSelect={setMinImpactFactor}
          sortControl={
            <SortArrows
              label={t('sessionPapers.filter.impactFactor')}
              ascMode="impact-asc"
              descMode="impact-desc"
              sort={sort}
              onSortChange={onSortChange}
            />
          }
        />

        {/* Venue 等级（↓ = top 优先） */}
        <MultiSelectChipGroup
          label={t('sessionPapers.filter.venueTier')}
          items={VENUE_TIERS.map((tier) => ({ value: tier.value, label: t(tier.labelKey) }))}
          selected={value.venueTiers}
          onToggle={toggleVenueTier}
          sortControl={
            <SortArrows
              label={t('sessionPapers.filter.venueTier')}
              ascMode="venue-tier-asc"
              descMode="venue-tier-desc"
              sort={sort}
              onSortChange={onSortChange}
            />
          }
        />

        {/* 摘要 */}
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={value.abstractOnly}
            onChange={toggleAbstractOnly}
            className="size-3 cursor-pointer"
          />
          <span className="text-xs">{t('sessionPapers.filter.abstractOnly')}</span>
        </label>
      </PopoverContent>
    </Popover>
  )
}

interface SortArrowsProps {
  /** 组标题（aria-label 用） */
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
          active
            ? 'text-primary'
            : 'text-muted-foreground/50 hover:text-foreground hover:bg-accent',
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
  /** 标题右侧附加控件（排序箭头） */
  sortControl?: React.ReactNode
}

/** 多选 chips 组（来源 / JCR 分区 / Venue 等级共用）：可多项命中，命中态主色描边 */
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
                // 常驻 border（未选中透明）：选中描边用 border 而非 ring —— 全局样式会在 :focus
                // 时把 --tw-ring-color 置透明（utilities.css），ring 描边聚焦期间会隐形
                'border',
                // 选中态自带 hover 覆盖：点击后焦点/悬停仍保持选中配色，不被变体的 hover 样式吃掉
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
  /** 标题右侧附加控件（排序箭头） */
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
                // 选中态自带 hover/focus 覆盖：点击后焦点/悬停仍保持选中配色，不被 ghost 的 hover 样式吃掉
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


