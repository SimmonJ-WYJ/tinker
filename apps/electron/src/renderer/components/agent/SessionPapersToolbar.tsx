/**
 * SessionPapersToolbar — 顶部工具栏（两行布局）
 *
 * 上行：标题 / 计数 / 更多菜单（⋯）
 * 下行：筛选（靠左，内容）+ 排序 → 显示密度 → 多选（靠右，由轻到重，图标）
 *
 * 显示密度 / 多选从 ⋯ 菜单提到下行常驻（图标态，避免和标题抢宽度），降低触达成本；
 * ⋯ 仅留低频的刷新 / 新窗口打开。点「多选」后由 Panel 切换到选择态（顶栏被替换）。
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import { SquareCheck, ArrowUpDown } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import {
  sessionPapersFilterFamilyAtom,
  sessionPapersSortFamilyAtom,
  countActiveFilters,
} from '@/atoms/session-papers-filter-atoms'
import { sessionPapersDensityAtom } from '@/atoms/session-papers-ui-atoms'
import { SessionPapersFilterPanel } from './SessionPapersFilterPanel'
import { SessionPapersMoreMenu } from './SessionPapersMoreMenu'
import { useT } from '@/hooks/useT'
import type { SessionPapersStats } from './session-papers-stats'
import { sessionPapersToolbarIconButtonClassNames } from './session-papers-toolbar-primitives.ts'

/** 显示密度分段 tab 的两个选项（标准 / 密集都曝光，用图标表示） */
const DENSITY_MODES = [
  { value: 'normal', labelKey: 'sessionPapers.density.normal' },
  { value: 'compact', labelKey: 'sessionPapers.density.compact' },
] as const

/**
 * 显示密度图标（lucide 风格内联 SVG），用形状差异强化区分：
 * - 标准：两个圆角行块（宽松卡片感）
 * - 密集：四条细横线（密排）
 */
function DensityIcon({ mode, className }: { mode: 'normal' | 'compact'; className?: string }): React.ReactElement {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {mode === 'normal' ? (
        <>
          <rect x="3" y="5" width="18" height="4.5" rx="1.5" />
          <rect x="3" y="14.5" width="18" height="4.5" rx="1.5" />
        </>
      ) : (
        <>
          <line x1="3" x2="21" y1="5" y2="5" />
          <line x1="3" x2="21" y1="9.7" y2="9.7" />
          <line x1="3" x2="21" y1="14.3" y2="14.3" />
          <line x1="3" x2="21" y1="19" y2="19" />
        </>
      )}
    </svg>
  )
}

export interface SessionPapersToolbarProps {
  sessionId: string
  /** 合并去重后的总数（merged.length） */
  totalCount: number
  /** 经过筛选 + 排序后的显示数（sorted.length） */
  filteredCount: number
  /** 因无 URL 被隐藏的条目数（records.length - merged.length） */
  hiddenByUrl: number
  /** 当前 merged 数组的统计数据，由 Panel 通过 computeStats 计算 */
  stats: SessionPapersStats
  /** 触发刷新 */
  onRefresh: () => void
  /** 展开到新窗口 */
  onOpenInNewWindow: () => void
  /** 切换多选模式 */
  onToggleMultiSelect: () => void
}

export function SessionPapersToolbar({
  sessionId,
  totalCount,
  filteredCount,
  hiddenByUrl,
  stats,
  onRefresh,
  onOpenInNewWindow,
  onToggleMultiSelect,
}: SessionPapersToolbarProps): React.ReactElement {
  const { t } = useT('conversation')

  // filter / sort atom 订阅保留在 Toolbar 内部，不通过 props 传
  const [filter, setFilter] = useAtom(sessionPapersFilterFamilyAtom(sessionId))
  const [sortMode, setSortMode] = useAtom(sessionPapersSortFamilyAtom(sessionId))

  // 显示密度（全局）
  const [density, setDensity] = useAtom(sessionPapersDensityAtom)

  const activeFilterCount = countActiveFilters(filter)

  return (
    <div className="py-1.5 space-y-1.5 flex-shrink-0" data-session-papers-toolbar>
      {/* 上行：标题/计数 + 功能入口（Overview / 筛选 / 更多） */}
      <div className="pl-[18px] pr-2.5 flex items-center min-h-6" data-session-papers-title-row>
        <div className="flex items-center gap-1 min-w-0 flex-1 overflow-hidden">
          <span className="text-xs font-medium text-muted-foreground whitespace-nowrap truncate">
            {t('sessionPapers.title')}
          </span>
          <span className="text-xs text-muted-foreground/70 tabular-nums whitespace-nowrap flex-shrink-0">
            {totalCount > 0
              ? activeFilterCount > 0 && filteredCount !== totalCount
                ? `· ${filteredCount} / ${totalCount}`
                : `· ${totalCount}`
              : ''}
          </span>
          {hiddenByUrl > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-xs text-muted-foreground/50 tabular-nums whitespace-nowrap cursor-help flex-shrink-0">
                  {t('agent.sessionPapers.hiddenCount', { count: hiddenByUrl })}
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[220px]">
                <p>{t('agent.sessionPapers.hiddenDetail', { count: hiddenByUrl })}</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        <SessionPapersMoreMenu
          onRefresh={onRefresh}
          onOpenInNewWindow={onOpenInNewWindow}
        />
      </div>

      {/* 下行：Codex 式纯图标工具条。文字通过 aria-label / tooltip 提供。 */}
      <div className="px-2.5 flex items-center gap-1 min-h-8" data-session-papers-actions>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              aria-label={t('sessionPapers.multiSelect')}
              onClick={onToggleMultiSelect}
              className={sessionPapersToolbarIconButtonClassNames({ shape: 'label' })}
            >
              <SquareCheck className="size-3.5" />
              <span>{t('sessionPapers.multiSelect')}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('sessionPapers.multiSelect')}</TooltipContent>
        </Tooltip>

        <div className="ml-auto flex items-center gap-1" data-session-papers-secondary-actions>
          <SessionPapersFilterPanel
            stats={stats}
            totalCount={totalCount}
            filteredCount={filteredCount}
            filter={filter}
            onFilterChange={setFilter}
            sort={sortMode}
            onSortChange={setSortMode}
          />
          <Select value={sortMode} onValueChange={(v) => setSortMode(v as typeof sortMode)}>
            <Tooltip>
              <TooltipTrigger asChild>
                <SelectTrigger
                  aria-label={t('sessionPapers.sortLabel')}
                  className={sessionPapersToolbarIconButtonClassNames({ className: '[&>svg]:hidden' })}
                >
                  <span className="flex items-center justify-center">
                    <ArrowUpDown className="size-3.5" />
                  </span>
                </SelectTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('sessionPapers.sortLabel')}</TooltipContent>
            </Tooltip>
            <SelectContent align="end" className="min-w-[7rem]">
              <SelectItem value="relevance-desc" className="text-xs">{t('sessionPapers.sortRelevanceDesc')}</SelectItem>
              <SelectItem value="relevance-asc" className="text-xs">{t('sessionPapers.sortRelevanceAsc')}</SelectItem>
              <SelectItem value="citations-desc" className="text-xs">{t('sessionPapers.sortCitationsDesc')}</SelectItem>
              <SelectItem value="citations-asc" className="text-xs">{t('sessionPapers.sortCitationsAsc')}</SelectItem>
              <SelectItem value="year-desc" className="text-xs">{t('sessionPapers.sortYearDesc')}</SelectItem>
              <SelectItem value="year-asc" className="text-xs">{t('sessionPapers.sortYearAsc')}</SelectItem>
              <SelectItem value="impact-desc" className="text-xs">{t('sessionPapers.sortImpactDesc')}</SelectItem>
              <SelectItem value="impact-asc" className="text-xs">{t('sessionPapers.sortImpactAsc')}</SelectItem>
              <SelectItem value="source-desc" className="text-xs">{t('sessionPapers.sortSourceDesc')}</SelectItem>
              <SelectItem value="source-asc" className="text-xs">{t('sessionPapers.sortSourceAsc')}</SelectItem>
              <SelectItem value="jcr-desc" className="text-xs">{t('sessionPapers.sortJcrDesc')}</SelectItem>
              <SelectItem value="jcr-asc" className="text-xs">{t('sessionPapers.sortJcrAsc')}</SelectItem>
              <SelectItem value="venue-tier-desc" className="text-xs">{t('sessionPapers.sortVenueTierDesc')}</SelectItem>
              <SelectItem value="venue-tier-asc" className="text-xs">{t('sessionPapers.sortVenueTierAsc')}</SelectItem>
            </SelectContent>
          </Select>

          <Select value={density} onValueChange={(v) => setDensity(v as typeof density)}>
            <Tooltip>
              <TooltipTrigger asChild>
                <SelectTrigger
                  aria-label={t('sessionPapers.density.tooltip')}
                  className={sessionPapersToolbarIconButtonClassNames({ className: '[&>svg]:hidden' })}
                >
                  <span className="flex items-center justify-center">
                    <DensityIcon mode={density} className="size-3.5" />
                  </span>
                </SelectTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {t(density === 'compact' ? 'sessionPapers.density.compact' : 'sessionPapers.density.normal')}
              </TooltipContent>
            </Tooltip>
            <SelectContent align="end" className="min-w-[6rem]">
              {DENSITY_MODES.map((mode) => (
                <SelectItem key={mode.value} value={mode.value} className="text-xs">
                  <span className="flex items-center gap-1.5">
                    <DensityIcon mode={mode.value} className="size-3.5" />
                    {t(mode.labelKey)}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="border-b border-border/60" data-session-papers-divider />
    </div>
  )
}
