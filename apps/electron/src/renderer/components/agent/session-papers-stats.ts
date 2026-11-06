/**
 * 检索结果统计计算 — 纯函数，从 merged 数组计算年份/来源分布
 *
 * 供 SessionPapersStatsBar 使用，通过 useMemo 缓存。
 */

import type { NormalizedPaperSource } from '@asci/shared'
import type { MergedPaperItem } from './session-papers-filter'
import { getYear, getSource } from './session-papers-filter'
import { readScoreObject } from './session-papers-utils'

export interface YearBucket {
  year: number
  count: number
}

export interface SourceBucket {
  source: NormalizedPaperSource
  count: number
}

/** 相关度分桶：label 为显示文案，range 为区间 */
export interface RelevanceBucket {
  label: string
  min: number
  max: number
  count: number
}

export interface SessionPapersStats {
  total: number
  /** 按 year 升序排列，仅含 count > 0 的年份 */
  yearDistribution: YearBucket[]
  /** 按 count 降序排列 */
  sourceDistribution: SourceBucket[]
  /** 年份缺失的论文数 */
  yearUnknownCount: number
  /** 相关度分布（从 extra.relevance 读取，null 表示无数据） */
  relevanceDistribution: RelevanceBucket[] | null
}

/** 相关度分桶定义（0-100 整数刻度，F22 issue #93） */
const RELEVANCE_TIERS = [
  { label: '0–19', min: 0, max: 20 },
  { label: '20–39', min: 20, max: 40 },
  { label: '40–59', min: 40, max: 60 },
  { label: '60–79', min: 60, max: 80 },
  { label: '80–100', min: 80, max: 101 },
] as const

/** 从 item 的 extra.relevance 读取相关度分数 */
function getRelevance(item: MergedPaperItem): number | null {
  const extra = (item.entry?.extra ?? item.record.extra) as Record<string, unknown> | undefined
  if (!extra) return null
  // 七维 score.finalScore 优先（已切到该线路）；旧 finalRelevance/keyword/F22 仅兜底
  const sc = readScoreObject(extra)
  const v = sc && typeof sc.finalScore === 'number'
    ? sc.finalScore
    : (extra.finalRelevance ?? extra.keywordRelevance ?? extra.relevance)
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** 单次遍历计算全部统计维度 */
export function computeStats(items: MergedPaperItem[]): SessionPapersStats {
  const yearMap = new Map<number, number>()
  const sourceMap = new Map<NormalizedPaperSource, number>()
  let yearUnknownCount = 0
  let hasAnyRelevance = false
  const relevanceCounts = new Array(RELEVANCE_TIERS.length).fill(0) as number[]

  for (const item of items) {
    const y = getYear(item)
    if (y != null) {
      yearMap.set(y, (yearMap.get(y) ?? 0) + 1)
    } else {
      yearUnknownCount++
    }

    const s = getSource(item)
    sourceMap.set(s, (sourceMap.get(s) ?? 0) + 1)

    const rel = getRelevance(item)
    if (rel != null) {
      hasAnyRelevance = true
      for (let i = 0; i < RELEVANCE_TIERS.length; i++) {
        const tier = RELEVANCE_TIERS[i]!
        if (rel >= tier.min && rel < tier.max) {
          relevanceCounts[i] = (relevanceCounts[i] ?? 0) + 1
          break
        }
      }
    }
  }

  const yearDistribution: YearBucket[] = Array.from(yearMap.entries())
    .map(([year, count]) => ({ year, count }))
    .sort((a, b) => a.year - b.year)

  const sourceDistribution: SourceBucket[] = Array.from(sourceMap.entries())
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count)

  const relevanceDistribution: RelevanceBucket[] | null = hasAnyRelevance
    ? RELEVANCE_TIERS.map((tier, i) => ({
        label: tier.label,
        min: tier.min,
        max: tier.max,
        count: relevanceCounts[i]!,
      }))
    : null

  return {
    total: items.length,
    yearDistribution,
    sourceDistribution,
    yearUnknownCount,
    relevanceDistribution,
  }
}

/**
 * 当年份跨度 > maxBars 时，按 groupSize 年分组聚合。
 * 返回的 bucket.year 为组起始年（如 2020 代表 2020-2024）。
 */
export function groupYearBuckets(buckets: YearBucket[], maxBars: number): YearBucket[] {
  if (buckets.length <= maxBars) return buckets
  const minYear = buckets[0]?.year ?? 0
  const maxYear = buckets[buckets.length - 1]?.year ?? 0
  const span = maxYear - minYear + 1
  const groupSize = Math.ceil(span / maxBars)

  const grouped = new Map<number, number>()
  for (const b of buckets) {
    const groupStart = minYear + Math.floor((b.year - minYear) / groupSize) * groupSize
    grouped.set(groupStart, (grouped.get(groupStart) ?? 0) + b.count)
  }

  return Array.from(grouped.entries())
    .map(([year, count]) => ({ year, count }))
    .sort((a, b) => a.year - b.year)
}
