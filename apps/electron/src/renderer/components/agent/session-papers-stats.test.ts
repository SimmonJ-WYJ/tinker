import { test, expect, describe } from 'bun:test'
import { computeStats, groupYearBuckets } from './session-papers-stats'
import type { MergedPaperItem } from './session-papers-filter'
import type { PaperRecord } from '@asci/shared'

function makeItem(overrides: Partial<PaperRecord> = {}): MergedPaperItem {
  return {
    record: {
      ts: '2026-01-01T00:00:00.000Z',
      query: 'test',
      source: 'tool:mcp__paper-search__arxiv_search',
      title: 'Test Paper',
      authors: ['Alice'],
      year: 2024,
      venue: null,
      doi: null,
      url: 'https://example.com',
      abstract: null,
      ...overrides,
    },
    entry: undefined,
  }
}

describe('computeStats', () => {
  test('空数组返回全零', () => {
    const stats = computeStats([])
    expect(stats.total).toBe(0)
    expect(stats.yearDistribution).toEqual([])
    expect(stats.sourceDistribution).toEqual([])
    expect(stats.yearUnknownCount).toBe(0)
    expect(stats.relevanceDistribution).toBeNull()
  })

  test('单条记录正确统计', () => {
    const stats = computeStats([makeItem({ year: 2023, source: 'tool:mcp__paper-search__pubmed_efetch' })])
    expect(stats.total).toBe(1)
    expect(stats.yearDistribution).toEqual([{ year: 2023, count: 1 }])
    expect(stats.sourceDistribution).toEqual([{ source: 'pubmed', count: 1 }])
    expect(stats.yearUnknownCount).toBe(0)
  })

  test('同年份的论文聚合到一个 bucket', () => {
    const items = [
      makeItem({ year: 2024 }),
      makeItem({ year: 2024 }),
      makeItem({ year: 2023 }),
    ]
    const stats = computeStats(items)
    expect(stats.yearDistribution).toEqual([
      { year: 2023, count: 1 },
      { year: 2024, count: 2 },
    ])
  })

  test('年份缺失计入 yearUnknownCount 而不进 yearDistribution', () => {
    const items = [
      makeItem({ year: 2024 }),
      makeItem({ year: null }),
      makeItem({ year: null }),
    ]
    const stats = computeStats(items)
    expect(stats.yearDistribution).toEqual([{ year: 2024, count: 1 }])
    expect(stats.yearUnknownCount).toBe(2)
  })

  test('来源按 count 降序排列', () => {
    const items = [
      makeItem({ source: 'tool:mcp__paper-search__arxiv_search' }),
      makeItem({ source: 'tool:mcp__paper-search__pubmed_efetch' }),
      makeItem({ source: 'tool:mcp__paper-search__arxiv_search' }),
      makeItem({ source: 'tool:mcp__paper-search__arxiv_search' }),
      makeItem({ source: 'tool:mcp__paper-search__pubmed_efetch' }),
      makeItem({ source: 'tool:WebFetch' }),
    ]
    const stats = computeStats(items)
    expect(stats.sourceDistribution[0]).toEqual({ source: 'arxiv', count: 3 })
    expect(stats.sourceDistribution[1]).toEqual({ source: 'pubmed', count: 2 })
    expect(stats.sourceDistribution[2]).toEqual({ source: 'web', count: 1 })
  })

  test('年份按升序排列', () => {
    const items = [
      makeItem({ year: 2025 }),
      makeItem({ year: 2020 }),
      makeItem({ year: 2022 }),
    ]
    const stats = computeStats(items)
    expect(stats.yearDistribution.map((b) => b.year)).toEqual([2020, 2022, 2025])
  })

  test('无 relevance 数据时返回 null', () => {
    const stats = computeStats([makeItem()])
    expect(stats.relevanceDistribution).toBeNull()
  })

  test('有 relevance 数据时返回 5 个分桶', () => {
    const items = [
      makeItem({ extra: { relevance: 10 } }),   // → [0, 20)
      makeItem({ extra: { relevance: 50 } }),   // → [40, 60)
      makeItem({ extra: { relevance: 70 } }),   // → [60, 80)
      makeItem({ extra: { relevance: 95 } }),   // → [80, 101)
      makeItem({ extra: { relevance: 85 } }),   // → [80, 101)
    ]
    const stats = computeStats(items)
    expect(stats.relevanceDistribution).not.toBeNull()
    expect(stats.relevanceDistribution!.length).toBe(5)
    // 10 → [0, 20), 50 → [40, 60), 70 → [60, 80), 95+85 → [80, 101)
    expect(stats.relevanceDistribution![0]!.count).toBe(1) // 0–19
    expect(stats.relevanceDistribution![1]!.count).toBe(0) // 20–39
    expect(stats.relevanceDistribution![2]!.count).toBe(1) // 40–59
    expect(stats.relevanceDistribution![3]!.count).toBe(1) // 60–79
    expect(stats.relevanceDistribution![4]!.count).toBe(2) // 80–100
  })

  test('旧会话 scoreV2 键兜底 — finalScore 进相关度分桶', () => {
    // 评分键由 scoreV2 重命名为 score；旧会话仍带 extra.scoreV2，getRelevance 须兜底读出
    const items = [makeItem({ extra: { scoreV2: { finalScore: 90 } } })]
    const stats = computeStats(items)
    expect(stats.relevanceDistribution).not.toBeNull()
    expect(stats.relevanceDistribution![4]!.count).toBe(1) // 90 → [80, 101)
  })
})

describe('groupYearBuckets', () => {
  test('不超过 maxBars 时原样返回', () => {
    const buckets = [{ year: 2020, count: 1 }, { year: 2021, count: 2 }]
    expect(groupYearBuckets(buckets, 10)).toEqual(buckets)
  })

  test('超过 maxBars 时按组聚合', () => {
    const buckets = Array.from({ length: 20 }, (_, i) => ({ year: 2000 + i, count: 1 }))
    const grouped = groupYearBuckets(buckets, 5)
    expect(grouped.length).toBeLessThanOrEqual(5)
    const totalCount = grouped.reduce((s, b) => s + b.count, 0)
    expect(totalCount).toBe(20)
  })

  test('空数组原样返回', () => {
    expect(groupYearBuckets([], 10)).toEqual([])
  })
})
