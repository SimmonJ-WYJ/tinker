import { test, expect } from 'bun:test'
import type { PaperRecord, WorkspacePaperEntry } from '@asci/shared'
import {
  applyFilter,
  applySort,
  dedupeByIdentity,
  buildMergedPaperItems,
  type MergedPaperItem,
} from './session-papers-filter'
import { recordKey } from './session-papers-utils'
import { EMPTY_SESSION_PAPERS_FILTER, countActiveFilters } from '@/atoms/session-papers-filter-atoms'

function mkEntry(key: string, opts: Partial<WorkspacePaperEntry> = {}): WorkspacePaperEntry {
  return {
    title: 'T',
    authors: ['Alice', 'Bob'],
    year: 2009,
    venue: 'Nature Methods',
    doi: '10.1/x',
    url: 'https://example.com/x',
    abstract: null,
    status: 'unread',
    starred: false,
    tags: [],
    note: null,
    noteRelPath: null,
    pdfRelPath: null,
    linkedZoteroKey: null,
    key,
    firstSeenAt: '2026-06-17T00:00:00Z',
    lastSeenAt: '2026-06-17T00:00:00Z',
    sessionRefs: ['s0'],
    seenCount: 1,
    extra: undefined,
    ...opts,
  }
}

// #685 详情页摘要回退：entry 缺摘要时用本次会话 record 的摘要补上（展示层合并）
test('buildMergedPaperItems: entry 缺摘要 → 用 session record 摘要回填', () => {
  const rec = mkRecord('x', { doi: '10.1/x', abstract: 'Session-recovered abstract.' })
  const key = recordKey(rec)!
  const [item] = buildMergedPaperItems([rec], [mkEntry(key, { abstract: null })])
  expect(item?.entry?.abstract).toBe('Session-recovered abstract.')
})

test('buildMergedPaperItems: entry 已有摘要 → 不被 record 覆盖', () => {
  const rec = mkRecord('y', { doi: '10.1/y', abstract: 'record abstract' })
  const key = recordKey(rec)!
  const [item] = buildMergedPaperItems([rec], [mkEntry(key, { abstract: 'entry abstract' })])
  expect(item?.entry?.abstract).toBe('entry abstract')
})

function mkRecord(
  id: string,
  opts: Partial<PaperRecord> & { citedBy?: number } = {},
): PaperRecord {
  const { citedBy, extra, ...rest } = opts
  const mergedExtra: Record<string, unknown> = { ...(extra ?? {}) }
  if (citedBy != null) mergedExtra.citedBy = citedBy
  return {
    ts: '2024-01-01T00:00:00Z',
    query: null,
    source: 'tool:mcp__paper-search__arxiv_search',
    title: id,
    authors: [],
    year: null,
    venue: null,
    doi: null,
    url: `https://example.com/${id}`,
    abstract: null,
    extra: Object.keys(mergedExtra).length > 0 ? mergedExtra : undefined,
    ...rest,
  }
}

function mkItem(opts: Partial<PaperRecord> & { citedBy?: number } = {}): MergedPaperItem {
  return { record: mkRecord(opts.title ?? Math.random().toString(36), opts), entry: undefined }
}

// ===== applyFilter =====

test('applyFilter: 空筛选 = 透传', () => {
  const items = [mkItem(), mkItem(), mkItem()]
  expect(applyFilter(items, EMPTY_SESSION_PAPERS_FILTER)).toEqual(items)
})

test('applyFilter: 年份单维 — 缺年份的条目被剔除', () => {
  const a = mkItem({ title: 'a', year: 2019 })
  const b = mkItem({ title: 'b', year: 2024 })
  const c = mkItem({ title: 'c', year: null })
  const out = applyFilter([a, b, c], { ...EMPTY_SESSION_PAPERS_FILTER, yearMin: 2020 })
  expect(out.map((i) => i.record.title)).toEqual(['b'])
})

test('applyFilter: 年份区间 yearMin + yearMax', () => {
  const items = [2018, 2020, 2022, 2024].map((y) => mkItem({ title: String(y), year: y }))
  const out = applyFilter(items, { ...EMPTY_SESSION_PAPERS_FILTER, yearMin: 2020, yearMax: 2022 })
  expect(out.map((i) => i.record.title)).toEqual(['2020', '2022'])
})

test('applyFilter: 来源白名单', () => {
  const a = mkItem({ title: 'arxiv-paper', source: 'tool:mcp__paper-search__arxiv_search' })
  const b = mkItem({ title: 'pubmed-paper', source: 'tool:mcp__paper-search__pubmed_efetch' })
  const c = mkItem({ title: 'web-paper', source: 'tool:WebFetch' })
  const out = applyFilter([a, b, c], { ...EMPTY_SESSION_PAPERS_FILTER, sources: ['arxiv', 'pubmed'] })
  expect(out.map((i) => i.record.title)).toEqual(['arxiv-paper', 'pubmed-paper'])
})

test('applyFilter: 引用量阈值 — 缺引用数 / 0 引用 一律剔除', () => {
  const a = mkItem({ title: 'a', citedBy: 5 })
  const b = mkItem({ title: 'b', citedBy: 50 })
  const c = mkItem({ title: 'c', citedBy: 100 })
  const d = mkItem({ title: 'd' }) // 无 citedBy
  const out = applyFilter([a, b, c, d], { ...EMPTY_SESSION_PAPERS_FILTER, minCitations: 10 })
  expect(out.map((i) => i.record.title)).toEqual(['b', 'c'])
})

test('applyFilter: 仅显示有摘要', () => {
  const a = mkItem({ title: 'a', abstract: 'has abstract' })
  const b = mkItem({ title: 'b', abstract: null })
  const c = mkItem({ title: 'c', abstract: '   ' }) // 空白也视为无
  const out = applyFilter([a, b, c], { ...EMPTY_SESSION_PAPERS_FILTER, abstractOnly: true })
  expect(out.map((i) => i.record.title)).toEqual(['a'])
})

test('applyFilter: 多维联合（年份 + 来源 + 引用量 + 摘要）', () => {
  const items = [
    mkItem({ title: 'hit', year: 2023, source: 'tool:mcp__paper-search__arxiv_search', citedBy: 50, abstract: 'x' }),
    mkItem({ title: 'wrong-year', year: 2010, source: 'tool:mcp__paper-search__arxiv_search', citedBy: 50, abstract: 'x' }),
    mkItem({ title: 'wrong-source', year: 2023, source: 'tool:WebFetch', citedBy: 50, abstract: 'x' }),
    mkItem({ title: 'wrong-cites', year: 2023, source: 'tool:mcp__paper-search__arxiv_search', citedBy: 1, abstract: 'x' }),
    mkItem({ title: 'no-abstract', year: 2023, source: 'tool:mcp__paper-search__arxiv_search', citedBy: 50, abstract: null }),
  ]
  const out = applyFilter(items, {
    ...EMPTY_SESSION_PAPERS_FILTER,
    yearMin: 2020,
    yearMax: 2025,
    sources: ['arxiv'],
    minCitations: 10,
    abstractOnly: true,
  })
  expect(out.map((i) => i.record.title)).toEqual(['hit'])
})

test('applyFilter: JCR 分区多选 — 命中任一选中分区，缺分区数据剔除', () => {
  const q1 = mkItem({ title: 'q1', extra: { journalRank: { jcrPartition: 'Q1' } } })
  const q2 = mkItem({ title: 'q2', extra: { journalRank: { jcrPartition: 'q2' } } }) // 小写也命中
  const q4 = mkItem({ title: 'q4', extra: { journalRank: { jcrPartition: 'Q4' } } })
  const none = mkItem({ title: 'none' })
  const out = applyFilter([q1, q2, q4, none], { ...EMPTY_SESSION_PAPERS_FILTER, jcrPartitions: ['Q1', 'Q2'] })
  expect(out.map((i) => i.record.title)).toEqual(['q1', 'q2'])
})

test('applyFilter: 影响因子阈值 — 字符串解析，缺失/非法剔除', () => {
  const high = mkItem({ title: 'high', extra: { journalRank: { impactFactor: '12.3' } } })
  const mid = mkItem({ title: 'mid', extra: { journalRank: { impactFactor: '4.8' } } })
  const bad = mkItem({ title: 'bad', extra: { journalRank: { impactFactor: 'n/a' } } })
  const none = mkItem({ title: 'none' })
  const out = applyFilter([high, mid, bad, none], { ...EMPTY_SESSION_PAPERS_FILTER, minImpactFactor: 5 })
  expect(out.map((i) => i.record.title)).toEqual(['high'])
})

test('applyFilter: Venue 等级多选 — unknown / 缺失视为不满足', () => {
  const top = mkItem({ title: 'top', extra: { score: { venueTier: 'top' } } })
  const strong = mkItem({ title: 'strong', extra: { score: { venueTier: 'strong' } } })
  const weak = mkItem({ title: 'weak', extra: { score: { venueTier: 'weak' } } })
  const unknown = mkItem({ title: 'unknown', extra: { score: { venueTier: 'unknown' } } })
  const none = mkItem({ title: 'none' })
  const out = applyFilter([top, strong, weak, unknown, none], {
    ...EMPTY_SESSION_PAPERS_FILTER,
    venueTiers: ['top', 'strong'],
  })
  expect(out.map((i) => i.record.title)).toEqual(['top', 'strong'])
})

test('applyFilter: 评分档位经 minRelevance 生效（score.finalScore 优先）', () => {
  const high = mkItem({ title: 'high', extra: { score: { finalScore: 82 } } })
  const mid = mkItem({ title: 'mid', extra: { score: { finalScore: 60 } } })
  const legacy = mkItem({ title: 'legacy', extra: { finalRelevance: 90 } }) // 旧字段兜底也参与
  const none = mkItem({ title: 'none' })
  const out = applyFilter([high, mid, legacy, none], { ...EMPTY_SESSION_PAPERS_FILTER, minRelevance: 65 })
  expect(out.map((i) => i.record.title)).toEqual(['high', 'legacy'])
})

test('applyFilter: 旧会话 scoreV2 键兜底 — Venue 等级多选', () => {
  // 评分键由 scoreV2 重命名为 score；旧会话 JSONL 仍带 extra.scoreV2，须经兜底参与筛选
  const top = mkItem({ title: 'top', extra: { scoreV2: { venueTier: 'top' } } })
  const weak = mkItem({ title: 'weak', extra: { scoreV2: { venueTier: 'weak' } } })
  const out = applyFilter([top, weak], { ...EMPTY_SESSION_PAPERS_FILTER, venueTiers: ['top'] })
  expect(out.map((i) => i.record.title)).toEqual(['top'])
})

test('applyFilter: 旧会话 scoreV2 键兜底 — minRelevance 经 finalScore', () => {
  const high = mkItem({ title: 'high', extra: { scoreV2: { finalScore: 82 } } })
  const low = mkItem({ title: 'low', extra: { scoreV2: { finalScore: 40 } } })
  const out = applyFilter([high, low], { ...EMPTY_SESSION_PAPERS_FILTER, minRelevance: 65 })
  expect(out.map((i) => i.record.title)).toEqual(['high'])
})

test('countActiveFilters: 新维度参与计数', () => {
  expect(countActiveFilters(EMPTY_SESSION_PAPERS_FILTER)).toBe(0)
  expect(
    countActiveFilters({
      ...EMPTY_SESSION_PAPERS_FILTER,
      minRelevance: 65,
      jcrPartitions: ['Q1'],
      minImpactFactor: 5,
      venueTiers: ['top'],
    }),
  ).toBe(4)
})

// ===== applySort =====

test('applySort: citations-desc / asc — null 沉底', () => {
  const items = [
    mkItem({ title: 'a', citedBy: 100 }),
    mkItem({ title: 'b' }),
    mkItem({ title: 'c', citedBy: 10 }),
    mkItem({ title: 'd', citedBy: 50 }),
  ]
  expect(applySort(items, 'citations-desc').map((i) => i.record.title)).toEqual(['a', 'd', 'c', 'b'])
  expect(applySort(items, 'citations-asc').map((i) => i.record.title)).toEqual(['c', 'd', 'a', 'b'])
})

test('applySort: relevance-desc / asc — null 沉底', () => {
  const items = [
    mkItem({ title: 'high', extra: { relevance: 85 } }),
    mkItem({ title: 'none' }),
    mkItem({ title: 'low', extra: { relevance: 20 } }),
    mkItem({ title: 'mid', extra: { relevance: 55 } }),
  ]
  expect(applySort(items, 'relevance-desc').map((i) => i.record.title)).toEqual(['high', 'mid', 'low', 'none'])
  expect(applySort(items, 'relevance-asc').map((i) => i.record.title)).toEqual(['low', 'mid', 'high', 'none'])
})

test('applySort: impact-desc / asc — IF 字符串解析，null 沉底', () => {
  const items = [
    mkItem({ title: 'high', extra: { journalRank: { impactFactor: '12.3' } } }),
    mkItem({ title: 'none' }),
    mkItem({ title: 'low', extra: { journalRank: { impactFactor: '1.2' } } }),
    mkItem({ title: 'mid', extra: { journalRank: { impactFactor: '4.8' } } }),
  ]
  expect(applySort(items, 'impact-desc').map((i) => i.record.title)).toEqual(['high', 'mid', 'low', 'none'])
  expect(applySort(items, 'impact-asc').map((i) => i.record.title)).toEqual(['low', 'mid', 'high', 'none'])
})

test('applySort: source-desc / asc — 归一化来源名字典序', () => {
  const items = [
    mkItem({ title: 'p', source: 'tool:mcp__paper-search__pubmed_efetch' }),
    mkItem({ title: 'a', source: 'tool:mcp__paper-search__arxiv_search' }),
    mkItem({ title: 'w', source: 'tool:WebFetch' }),
  ]
  expect(applySort(items, 'source-asc').map((i) => i.record.title)).toEqual(['a', 'p', 'w'])
  expect(applySort(items, 'source-desc').map((i) => i.record.title)).toEqual(['w', 'p', 'a'])
})

test('applySort: jcr-desc = Q1 优先 / asc = Q4 优先 — 缺失沉底', () => {
  const items = [
    mkItem({ title: 'q3', extra: { journalRank: { jcrPartition: 'Q3' } } }),
    mkItem({ title: 'none' }),
    mkItem({ title: 'q1', extra: { journalRank: { jcrPartition: 'Q1' } } }),
    mkItem({ title: 'q4', extra: { journalRank: { jcrPartition: 'q4' } } }),
  ]
  expect(applySort(items, 'jcr-desc').map((i) => i.record.title)).toEqual(['q1', 'q3', 'q4', 'none'])
  expect(applySort(items, 'jcr-asc').map((i) => i.record.title)).toEqual(['q4', 'q3', 'q1', 'none'])
})

test('applySort: venue-tier-desc = top 优先 — unknown/缺失沉底', () => {
  const items = [
    mkItem({ title: 'weak', extra: { score: { venueTier: 'weak' } } }),
    mkItem({ title: 'unknown', extra: { score: { venueTier: 'unknown' } } }),
    mkItem({ title: 'top', extra: { score: { venueTier: 'top' } } }),
    mkItem({ title: 'strong', extra: { score: { venueTier: 'strong' } } }),
  ]
  expect(applySort(items, 'venue-tier-desc').map((i) => i.record.title)).toEqual(['top', 'strong', 'weak', 'unknown'])
  expect(applySort(items, 'venue-tier-asc').map((i) => i.record.title)).toEqual(['weak', 'strong', 'top', 'unknown'])
})

test('applySort: year-desc / asc — null 沉底', () => {
  const items = [
    mkItem({ title: 'old', year: 2018 }),
    mkItem({ title: 'noyear' }),
    mkItem({ title: 'new', year: 2025 }),
    mkItem({ title: 'mid', year: 2022 }),
  ]
  expect(applySort(items, 'year-desc').map((i) => i.record.title)).toEqual(['new', 'mid', 'old', 'noyear'])
  expect(applySort(items, 'year-asc').map((i) => i.record.title)).toEqual(['old', 'mid', 'new', 'noyear'])
})

test('applySort: relevance 并列 → 确定性 tie-breaker（引用↓ → 年份↓ → 身份），输入乱序结果不变', () => {
  // 全部 relevance=80（同质对题池场景），靠 tie-breaker 决出确定顺序：
  //   引用: cit100 > (cit50a=cit50b) > cit10 > (cit7z=cit7a)
  //   cit50a/cit50b 同引用 → 年份: 2025 > 2019
  //   cit7z/cit7a 同引用同年 → 身份字典序: t:aaa < t:zzz
  const items = [
    mkItem({ title: 'cit100', extra: { relevance: 80 }, citedBy: 100, year: 2020 }),
    mkItem({ title: 'cit50-y2025', extra: { relevance: 80 }, citedBy: 50, year: 2025 }),
    mkItem({ title: 'cit50-y2019', extra: { relevance: 80 }, citedBy: 50, year: 2019 }),
    mkItem({ title: 'cit10', extra: { relevance: 80 }, citedBy: 10, year: 2021 }),
    mkItem({ title: 'zzz', extra: { relevance: 80 }, citedBy: 7, year: 2021 }),
    mkItem({ title: 'aaa', extra: { relevance: 80 }, citedBy: 7, year: 2021 }),
  ]
  const expected = ['cit100', 'cit50-y2025', 'cit50-y2019', 'cit10', 'aaa', 'zzz']
  expect(applySort(items, 'relevance-desc').map((i) => i.record.title)).toEqual(expected)
  // 确定性核心：打乱输入顺序，输出必须完全一致（消除"并列保留召回到达顺序"的抖动）
  const shuffled = [items[3], items[5], items[0], items[2], items[4], items[1]]
  expect(applySort(shuffled, 'relevance-desc').map((i) => i.record.title)).toEqual(expected)
})

// ===== dedupeByIdentity =====

function mkEntry(key: string, opts: Partial<WorkspacePaperEntry> = {}): WorkspacePaperEntry {
  return {
    title: opts.title ?? key,
    authors: opts.authors ?? [],
    year: opts.year ?? null,
    venue: opts.venue ?? null,
    doi: opts.doi ?? null,
    url: opts.url ?? `https://example.com/${key}`,
    abstract: opts.abstract ?? null,
    extra: opts.extra,
    status: opts.status ?? 'unread',
    starred: opts.starred ?? false,
    tags: opts.tags ?? [],
    note: opts.note ?? null,
    noteRelPath: opts.noteRelPath ?? null,
    pdfRelPath: opts.pdfRelPath ?? null,
    linkedZoteroKey: opts.linkedZoteroKey ?? null,
    key,
    firstSeenAt: opts.firstSeenAt ?? '2024-01-01T00:00:00Z',
    lastSeenAt: opts.lastSeenAt ?? '2024-01-01T00:00:00Z',
    sessionRefs: opts.sessionRefs ?? [],
    seenCount: opts.seenCount ?? 1,
  }
}

test('dedupeByIdentity: 同 entry.key 多次出现只保留首条', () => {
  const entry = mkEntry('doi:10.1/a')
  const items: MergedPaperItem[] = [
    { record: mkRecord('a', { doi: '10.1/A', title: 'a' }), entry },
    { record: mkRecord('a-2', { doi: '10.1/A', title: 'a' }), entry },
    { record: mkRecord('b', { title: 'b' }), entry: undefined },
  ]
  const out = dedupeByIdentity(items)
  expect(out.map((i) => i.record.title)).toEqual(['a', 'b'])
})

test('dedupeByIdentity: 无 entry，同 doi 多条按 recordKey 去重', () => {
  const items: MergedPaperItem[] = [
    { record: mkRecord('first', { doi: '10.1/X', title: 'first' }), entry: undefined },
    { record: mkRecord('second', { doi: '10.1/x', title: 'second' }), entry: undefined },
  ]
  const out = dedupeByIdentity(items)
  // recordKey 用 toLowerCase 归一化 doi → 同身份，保留首条
  expect(out.length).toBe(1)
  expect(out[0].record.title).toBe('first')
})

test('dedupeByIdentity: 无 doi/paperId 时按 title+year 去重（覆盖警告中的 t:|y: 路径）', () => {
  const items: MergedPaperItem[] = [
    { record: mkRecord('a', { title: 'stem agent: a self-adapting...', year: 2026 }), entry: undefined },
    { record: mkRecord('b', { title: 'stem agent: a self-adapting...', year: 2026 }), entry: undefined },
    { record: mkRecord('c', { title: 'stem agent: a self-adapting...', year: 2025 }), entry: undefined },
    { record: mkRecord('d', { title: 'Other paper', year: 2026 }), entry: undefined },
  ]
  const out = dedupeByIdentity(items)
  expect(out.map((i) => i.record.title + '|' + i.record.year)).toEqual([
    'stem agent: a self-adapting...|2026',
    'stem agent: a self-adapting...|2025',
    'Other paper|2026',
  ])
})

test('dedupeByIdentity: 无身份的匿名条目（无 doi/paperId/title）全部保留', () => {
  const items: MergedPaperItem[] = [
    { record: mkRecord('x', { title: '(无标题)' }), entry: undefined },
    { record: mkRecord('y', { title: '(无标题)' }), entry: undefined },
    { record: mkRecord('z', { title: '(DOI 片段)' }), entry: undefined },
  ]
  const out = dedupeByIdentity(items)
  expect(out.length).toBe(3)
})

test('dedupeByIdentity: 空数组直接返回空数组', () => {
  expect(dedupeByIdentity([])).toEqual([])
})

test('dedupeByIdentity: 单条目透传', () => {
  const items: MergedPaperItem[] = [{ record: mkRecord('only', { doi: '10.1/only' }), entry: undefined }]
  const out = dedupeByIdentity(items)
  expect(out).toEqual(items)
})

