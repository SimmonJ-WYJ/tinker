/**
 * paper-sync-service 集成测试
 *
 * 覆盖：
 *   - 单源 create / update / skip
 *   - 多源同 paper 去重（doi / zoteroKey / title+year）
 *   - 字段优先级合并（zotero > workspace-jsonl > review-citation）
 *   - 现有行"补空不覆盖"
 *   - paperIds 顺序与入参一一对应
 *   - DOI 归一（前缀 / 大小写）
 *   - 软删行不被视为命中
 */

import { beforeEach, describe, expect, test } from 'bun:test'

import type { RepoDb } from './internal/repo-db.ts'

import { openTestDb } from './repositories/_helpers.test.ts'
import {
  __testing__,
  syncPapers,
  type PaperSyncInput,
} from './paper-sync-service.ts'
import {
  createPaper,
  getPaperById,
  listPapers,
  softDeletePaper,
} from './repositories/paper-repository.ts'

describe('paper-sync-service: 单源 create / update / skip', () => {
  let repo: RepoDb
  beforeEach(() => {
    ;({ repo } = openTestDb())
  })

  test('新输入 → 全部 create；paperIds 与入参一一对应', () => {
    const inputs: PaperSyncInput[] = [
      { source: 'workspace-jsonl', title: 'P1', authors: ['A'], doi: '10.1/p1' },
      { source: 'workspace-jsonl', title: 'P2', authors: ['B'], zoteroKey: 'ZK2' },
    ]
    const r = syncPapers(repo, inputs)
    expect(r.created).toBe(2)
    expect(r.updated).toBe(0)
    expect(r.skipped).toBe(0)
    expect(r.paperIds).toHaveLength(2)
    expect(r.paperIds[0]).toBeTruthy()
    expect(r.paperIds[1]).toBeTruthy()
    expect(listPapers(repo)).toHaveLength(2)
  })

  test('缺 title → 计 skip，对应 paperIds[i] === null', () => {
    const inputs: PaperSyncInput[] = [
      { source: 'workspace-jsonl', title: '   ', doi: '10.1/blank' },
      { source: 'workspace-jsonl', title: 'good', doi: '10.1/good' },
    ]
    const r = syncPapers(repo, inputs)
    expect(r.skipped).toBe(1)
    expect(r.created).toBe(1)
    expect(r.paperIds[0]).toBeNull()
    expect(r.paperIds[1]).toBeTruthy()
  })

  test('无 doi/zoteroKey 但有 title → 仍可成组并 create', () => {
    const inputs: PaperSyncInput[] = [
      { source: 'review-citation', title: 'Pure title only', year: 2020 },
    ]
    const r = syncPapers(repo, inputs)
    expect(r.created).toBe(1)
    expect(r.paperIds[0]).toBeTruthy()
  })

  test('既无 title 也无任何 key → skip', () => {
    const r = syncPapers(repo, [{ source: 'review-citation', title: '' }])
    expect(r.skipped).toBe(1)
    expect(r.created).toBe(0)
  })

  test('空数组 → 全 0 返回', () => {
    const r = syncPapers(repo, [])
    expect(r).toEqual({ created: 0, updated: 0, skipped: 0, paperIds: [] })
  })
})

describe('paper-sync-service: 去重 + 现有行合并', () => {
  let repo: RepoDb
  beforeEach(() => {
    ;({ repo } = openTestDb())
  })

  test('同 DOI 两次输入 → 仅 create 一条；二次为 update（补空）', () => {
    const r1 = syncPapers(repo, [
      { source: 'review-citation', title: 'Same paper', doi: '10.1/dup' },
    ])
    expect(r1.created).toBe(1)
    const id1 = r1.paperIds[0]!

    const r2 = syncPapers(repo, [
      {
        source: 'workspace-jsonl',
        title: 'Same paper',
        doi: '10.1/dup',
        authors: ['A'],
        year: 2024,
      },
    ])
    expect(r2.created).toBe(0)
    expect(r2.updated).toBe(1)
    expect(r2.paperIds[0]).toBe(id1)
    const p = getPaperById(repo, id1)!
    expect(p.authors).toEqual(['A'])
    expect(p.year).toBe(2024)
  })

  test('DOI 归一：前缀 / 大小写 / doi: 前缀都视为同一条', () => {
    syncPapers(repo, [{ source: 'review-citation', title: 'P', doi: '10.1/AbC' }])
    syncPapers(repo, [
      { source: 'workspace-jsonl', title: 'P', doi: 'https://doi.org/10.1/abc' },
    ])
    syncPapers(repo, [{ source: 'zotero', title: 'P', doi: 'doi:10.1/abc' }])
    expect(listPapers(repo)).toHaveLength(1)
  })

  test('zoteroKey 同 → 合并为一条；不依赖 doi', () => {
    syncPapers(repo, [{ source: 'workspace-jsonl', title: 'P', zoteroKey: 'ZK1' }])
    syncPapers(repo, [{ source: 'zotero', title: 'P', zoteroKey: 'ZK1', year: 2022 }])
    const all = listPapers(repo)
    expect(all).toHaveLength(1)
    expect(all[0]!.year).toBe(2022)
  })

  test('title+year 同 → 合并；title 大小写 / 标点不敏感', () => {
    syncPapers(repo, [
      { source: 'review-citation', title: 'Long-Context vs RAG!', year: 2024 },
    ])
    syncPapers(repo, [
      {
        source: 'workspace-jsonl',
        title: '  long context vs rag  ',
        year: 2024,
        authors: ['Alice'],
      },
    ])
    const all = listPapers(repo)
    expect(all).toHaveLength(1)
    expect(all[0]!.authors).toEqual(['Alice'])
  })

  test('现有行 abstract/authors 非空 → 不被覆盖（补空不覆盖）', () => {
    const existing = createPaper(repo, {
      title: 'Existing',
      authors: ['OldAuthor'],
      doi: '10.1/exist',
      abstract: 'old abstract',
    })
    const r = syncPapers(repo, [
      {
        source: 'zotero',
        title: 'Existing',
        doi: '10.1/exist',
        authors: ['NewAuthor'],
        abstract: 'new abstract',
        year: 2030,
      },
    ])
    expect(r.updated).toBe(1)
    const p = getPaperById(repo, existing.id)!
    expect(p.authors).toEqual(['OldAuthor']) // 未覆盖
    expect(p.abstract).toBe('old abstract') // 未覆盖
    expect(p.year).toBe(2030) // year 原为空 → 补齐
  })

  test('现有行全空字段 → 全部由新输入补齐', () => {
    const existing = createPaper(repo, {
      title: 'Skeleton',
      authors: [],
      doi: '10.1/skel',
    })
    syncPapers(repo, [
      {
        source: 'zotero',
        title: 'Skeleton',
        doi: '10.1/skel',
        authors: ['A'],
        year: 2020,
        venue: 'NeurIPS',
        url: 'https://example.com',
        zoteroKey: 'ZK',
        abstract: 'abs',
      },
    ])
    const p = getPaperById(repo, existing.id)!
    expect(p.authors).toEqual(['A'])
    expect(p.year).toBe(2020)
    expect(p.venue).toBe('NeurIPS')
    expect(p.url).toBe('https://example.com')
    expect(p.zoteroKey).toBe('ZK')
    expect(p.abstract).toBe('abs')
  })

  test('已软删的行不被视为命中 → 走 create 新行', () => {
    const existing = createPaper(repo, {
      title: 'Old',
      authors: [],
      doi: '10.1/soft',
    })
    softDeletePaper(repo, existing.id)
    const r = syncPapers(repo, [
      { source: 'workspace-jsonl', title: 'Old', doi: '10.1/soft' },
    ])
    expect(r.created).toBe(1)
    expect(r.paperIds[0]).not.toBe(existing.id)
  })
})

describe('paper-sync-service: 同批多源优先级', () => {
  let repo: RepoDb
  beforeEach(() => {
    ;({ repo } = openTestDb())
  })

  test('同 DOI 批内 zotero + jsonl + review-citation → 以 zotero 为 base', () => {
    const inputs: PaperSyncInput[] = [
      { source: 'review-citation', title: 'Title from cite', doi: '10.1/x' },
      {
        source: 'workspace-jsonl',
        title: 'Title from jsonl',
        doi: '10.1/x',
        authors: ['Jsonl'],
      },
      {
        source: 'zotero',
        title: 'Title from zotero',
        doi: '10.1/x',
        authors: ['Zotero'],
        year: 2021,
      },
    ]
    const r = syncPapers(repo, inputs)
    expect(r.created).toBe(1)
    const all = listPapers(repo)
    expect(all).toHaveLength(1)
    expect(all[0]!.title).toBe('Title from zotero')
    expect(all[0]!.authors).toEqual(['Zotero'])
    expect(all[0]!.year).toBe(2021)
    // 三条 input 都返回同一个 paperId
    expect(new Set(r.paperIds)).toEqual(new Set([all[0]!.id]))
  })

  test('低优先级源补 base 中缺失字段', () => {
    syncPapers(repo, [
      {
        source: 'zotero',
        title: 'Z-only',
        doi: '10.1/y',
        // 故意只给 title + doi，让低优先级源补齐
      },
      {
        source: 'workspace-jsonl',
        title: 'JSONL ver',
        doi: '10.1/y',
        authors: ['JsonlAuthor'],
        year: 2023,
      },
    ])
    const all = listPapers(repo)
    expect(all).toHaveLength(1)
    expect(all[0]!.title).toBe('Z-only') // 优先级 base
    expect(all[0]!.authors).toEqual(['JsonlAuthor']) // 补空
    expect(all[0]!.year).toBe(2023) // 补空
  })
})

describe('paper-sync-service: 归一化工具', () => {
  test('normalizeDoi', () => {
    expect(__testing__.normalizeDoi('10.1/aBc')).toBe('10.1/abc')
    expect(__testing__.normalizeDoi('https://doi.org/10.1/AbC')).toBe('10.1/abc')
    expect(__testing__.normalizeDoi('http://dx.doi.org/10.1/X')).toBe('10.1/x')
    expect(__testing__.normalizeDoi('doi: 10.1/Y')).toBe('10.1/y')
    expect(__testing__.normalizeDoi('')).toBeNull()
    expect(__testing__.normalizeDoi(null)).toBeNull()
  })

  test('normalizeTitle', () => {
    expect(__testing__.normalizeTitle('Long-Context vs. RAG!')).toBe('long context vs rag')
    expect(__testing__.normalizeTitle('  multi   spaces  ')).toBe('multi spaces')
  })

  test('computeGroupKey 优先级 doi > zoteroKey > title+year', () => {
    expect(
      __testing__.computeGroupKey({
        source: 'zotero',
        title: 'T',
        doi: '10.1/x',
        zoteroKey: 'ZK',
        year: 2024,
      }),
    ).toBe('doi:10.1/x')
    expect(
      __testing__.computeGroupKey({ source: 'zotero', title: 'T', zoteroKey: 'ZK', year: 2024 }),
    ).toBe('zk:ZK')
    expect(__testing__.computeGroupKey({ source: 'zotero', title: 'T', year: 2024 })).toBe(
      'ty:t|2024',
    )
    expect(__testing__.computeGroupKey({ source: 'zotero', title: 'T' })).toBe('ty:t|')
    expect(__testing__.computeGroupKey({ source: 'zotero', title: '' })).toBeNull()
  })
})
