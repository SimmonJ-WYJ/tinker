/**
 * zotero_wiki_lookup_batch 单测
 *
 * 复用 wiki-lookup.test 的临时目录 + ASCI_CONFIG_HOME 隔离手法。重点验证：
 *  - 批量逐条解析正确（found / parse_pending / not_in_wiki 混合）
 *  - 结果顺序与输入 items 对齐
 *  - 与单篇 handleWikiLookup 逐字段一致（后续迁移的保证）
 *  - 分页 page/pageSize/total/hasMore
 *  - 索引缺失 / 空 items / pageSize clamp 边界
 */

import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ZoteroPdfWikiIndex, ZoteroPdfWikiIndexEntry } from '@asci/shared'
import { getZoteroWikiIndexPath } from '../../../src/main/lib/config-paths.ts'
import { handleWikiLookup, handleWikiLookupBatch } from './wiki-lookup.ts'

let tmpDir = ''
let prevAsciDir: string | undefined
let prevZoteroDataDir: string | undefined

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'wiki-lookup-batch-'))
  prevAsciDir = process.env.ASCI_CONFIG_HOME
  prevZoteroDataDir = process.env.ZOTERO_DATA_DIR
  process.env.ASCI_CONFIG_HOME = tmpDir
  process.env.ZOTERO_DATA_DIR = join(tmpDir, 'Zotero')
})

afterEach(() => {
  if (prevAsciDir === undefined) delete process.env.ASCI_CONFIG_HOME
  else process.env.ASCI_CONFIG_HOME = prevAsciDir
  if (prevZoteroDataDir === undefined) delete process.env.ZOTERO_DATA_DIR
  else process.env.ZOTERO_DATA_DIR = prevZoteroDataDir
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
})

function writeIndex(entries: Partial<ZoteroPdfWikiIndexEntry>[]): void {
  const indexPath = getZoteroWikiIndexPath()
  mkdirSync(dirname(indexPath), { recursive: true })
  const full: ZoteroPdfWikiIndexEntry[] = entries.map((e) => ({
    attachmentKey: 'AAAA1111',
    parentItemKey: 'PPPP1111',
    title: 'Default title',
    authors: [],
    year: '2024',
    doi: null,
    publicationTitle: null,
    itemType: null,
    abstract: null,
    filename: 'paper.pdf',
    linkMode: 'imported_url',
    parseStatus: 'completed',
    mdPath: '/abs/wiki/AAAA1111.md',
    parsedAt: '2026-04-28T00:00:00.000Z',
    articlePath: null,
    articleStatus: null,
    ...e,
  } as ZoteroPdfWikiIndexEntry))
  const idx: ZoteroPdfWikiIndex = {
    schemaVersion: 1,
    generatedAt: '2026-04-28T00:00:00.000Z',
    total: full.length,
    byStatus: { pending: 0, parsing: 0, completed: 0, failed: 0 },
    entries: full,
  }
  writeFileSync(indexPath, JSON.stringify(idx), 'utf-8')
}

/* ------------------------------ 索引缺失 ------------------------------ */

test('index 不存在 → 本页每条 index_not_found，indexAvailable:false', () => {
  const r = handleWikiLookupBatch({ items: [{ doi: '10.1/a' }, { zoteroKey: 'P1' }] })
  expect(r.indexAvailable).toBe(false)
  expect(r.total).toBe(2)
  expect(r.results).toHaveLength(2)
  for (const one of r.results) {
    expect(one.found).toBe(false)
    expect(one.reason).toBe('index_not_found')
  }
})

/* ------------------------------ 批量混合解析 ------------------------------ */

test('批量混合：found / parse_pending / not_in_wiki 各自正确，顺序与输入对齐', () => {
  writeIndex([
    { attachmentKey: 'A1', parentItemKey: 'P1', parseStatus: 'completed', mdPath: '/abs/A1.md' },
    { attachmentKey: 'A2', parentItemKey: 'P2', doi: '10.5/pending', parseStatus: 'pending', mdPath: null, abstract: 'abs...' },
  ])
  const r = handleWikiLookupBatch({
    items: [
      { zoteroKey: 'P1' },        // → found
      { doi: '10.5/pending' },    // → parse_pending, inIndex
      { doi: '10.9/missing' },    // → not_in_wiki
    ],
  })
  expect(r.indexAvailable).toBe(true)
  expect(r.total).toBe(3)
  expect(r.results).toHaveLength(3)

  expect(r.results[0].found).toBe(true)
  expect(r.results[0].mdPath).toBe('/abs/A1.md')

  expect(r.results[1].found).toBe(false)
  expect(r.results[1].inIndex).toBe(true)
  expect(r.results[1].reason).toBe('parse_pending')
  expect(r.results[1].abstract).toBe('abs...')

  expect(r.results[2].found).toBe(false)
  expect(r.results[2].inIndex).toBe(false)
  expect(r.results[2].reason).toBe('not_in_wiki')
})

/* ------------------------------ 单篇（length 1） ------------------------------ */

test('单篇查询：items 长度为 1 也正常', () => {
  writeIndex([{ attachmentKey: 'A2', parentItemKey: 'P2', parseStatus: 'completed', mdPath: '/abs/A2.md' }])
  const r = handleWikiLookupBatch({ items: [{ zoteroKey: 'A2' }] })
  expect(r.total).toBe(1)
  expect(r.results).toHaveLength(1)
  expect(r.results[0].found).toBe(true)
  expect(r.results[0].attachmentKey).toBe('A2')
})

/* ------------------------------ 与单篇逐字段一致（迁移保证） ------------------------------ */

test('批量 results[i] 与 handleWikiLookup(items[i]) 逐字段一致', () => {
  writeIndex([
    { attachmentKey: 'KX', parentItemKey: 'PX', doi: '10.1/x', parseStatus: 'completed', mdPath: '/abs/KX.md', abstract: 'x' },
    { attachmentKey: 'KY', parentItemKey: 'PY', doi: '10.1/y', parseStatus: 'failed', mdPath: null },
  ])
  const items = [{ zoteroKey: 'PX' }, { doi: '10.1/y' }, { doi: '10.1/none' }]
  const batch = handleWikiLookupBatch({ items })
  for (let i = 0; i < items.length; i++) {
    expect(batch.results[i]).toEqual(handleWikiLookup(items[i]))
  }
})

/* ------------------------------ 分页 ------------------------------ */

test('分页：pageSize 切分，total 为全量，hasMore 正确；page 2 取剩余', () => {
  writeIndex([
    { attachmentKey: 'A1', parentItemKey: 'P1', parseStatus: 'completed', mdPath: '/abs/A1.md' },
    { attachmentKey: 'A2', parentItemKey: 'P2', parseStatus: 'completed', mdPath: '/abs/A2.md' },
    { attachmentKey: 'A3', parentItemKey: 'P3', parseStatus: 'completed', mdPath: '/abs/A3.md' },
  ])
  const items = [{ zoteroKey: 'P1' }, { zoteroKey: 'P2' }, { zoteroKey: 'P3' }]

  const p1 = handleWikiLookupBatch({ items, page: 1, pageSize: 2 })
  expect(p1.total).toBe(3)
  expect(p1.pageSize).toBe(2)
  expect(p1.page).toBe(1)
  expect(p1.results).toHaveLength(2)
  expect(p1.hasMore).toBe(true)
  expect(p1.results[0].attachmentKey).toBe('A1')
  expect(p1.results[1].attachmentKey).toBe('A2')

  const p2 = handleWikiLookupBatch({ items, page: 2, pageSize: 2 })
  expect(p2.results).toHaveLength(1)
  expect(p2.hasMore).toBe(false)
  expect(p2.results[0].attachmentKey).toBe('A3')
})

/* ------------------------------ 边界 ------------------------------ */

test('空 items → results 空、total 0、hasMore false', () => {
  writeIndex([{}])
  const r = handleWikiLookupBatch({ items: [] })
  expect(r.total).toBe(0)
  expect(r.results).toHaveLength(0)
  expect(r.hasMore).toBe(false)
})

test('pageSize clamp：>500 → 500，<1 / 非有限 → 默认 50', () => {
  writeIndex([{ doi: '10.1/a', parseStatus: 'completed', mdPath: '/abs/a.md' }])
  expect(handleWikiLookupBatch({ items: [{ doi: '10.1/a' }], pageSize: 9999 }).pageSize).toBe(500)
  expect(handleWikiLookupBatch({ items: [{ doi: '10.1/a' }], pageSize: 0 }).pageSize).toBe(1)
  expect(handleWikiLookupBatch({ items: [{ doi: '10.1/a' }] }).pageSize).toBe(50)
})
