/**
 * zotero_wiki_lookup 单测
 *
 * 用临时目录 + ASCI_CONFIG_HOME 环境变量隔离每个 case 的 wiki/index.json。
 */

import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ZoteroPdfWikiIndex, ZoteroPdfWikiIndexEntry } from '@asci/shared'
import {
  getZoteroWikiIndexPath,
  getZoteroWikiStructuredTxtPath,
} from '../../../src/main/lib/config-paths.ts'
import { handleWikiLookup } from './wiki-lookup.ts'

let tmpDir = ''
let prevAsciDir: string | undefined
let prevZoteroDataDir: string | undefined

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'wiki-lookup-'))
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

/** 在 ASCI_CONFIG_HOME 解析出来的 wiki 目录下写一份 index.json */
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

/* ----------------------------- index 缺失 / 损坏 ----------------------------- */

test('wiki/index.json 不存在 → reason=index_not_found', () => {
  const r = handleWikiLookup({ doi: '10.1234/abc' })
  expect(r.found).toBe(false)
  expect(r.inIndex).toBe(false)
  expect(r.reason).toBe('index_not_found')
})

test('wiki/index.json 损坏（非法 JSON）→ reason=index_not_found', () => {
  const indexPath = getZoteroWikiIndexPath()
  mkdirSync(dirname(indexPath), { recursive: true })
  writeFileSync(indexPath, '{not json', 'utf-8')
  const r = handleWikiLookup({ doi: '10.1234/abc' })
  expect(r.found).toBe(false)
  expect(r.reason).toBe('index_not_found')
})

/* ------------------------------ 身份不足 ------------------------------ */

test('未给任何身份 → reason=insufficient_identity', () => {
  writeIndex([{}])
  const r = handleWikiLookup({})
  expect(r.found).toBe(false)
  expect(r.inIndex).toBe(false)
  expect(r.reason).toBe('insufficient_identity')
})

/* ------------------------------ zoteroKey 命中 ------------------------------ */

test('zoteroKey 命中 parentItemKey + parseStatus=completed → found:true，含 mdPath', () => {
  writeIndex([{ attachmentKey: 'A1', parentItemKey: 'P1', parseStatus: 'completed', mdPath: '/abs/A1.md' }])
  const r = handleWikiLookup({ zoteroKey: 'P1' })
  expect(r.found).toBe(true)
  expect(r.inIndex).toBe(true)
  expect(r.parseStatus).toBe('completed')
  expect(r.attachmentKey).toBe('A1')
  expect(r.parentItemKey).toBe('P1')
  expect(r.mdPath).toBe('/abs/A1.md')
})

test('zoteroKey 命中 attachmentKey 也 OK', () => {
  writeIndex([{ attachmentKey: 'A2', parentItemKey: 'P2', parseStatus: 'completed', mdPath: '/abs/A2.md' }])
  const r = handleWikiLookup({ zoteroKey: 'A2' })
  expect(r.found).toBe(true)
  expect(r.attachmentKey).toBe('A2')
})

test('zoteroKey 给了但 wiki 里没有 → not_in_wiki（不回落到其他字段）', () => {
  writeIndex([
    { attachmentKey: 'A3', parentItemKey: 'P3', doi: '10.1/x', parseStatus: 'completed', mdPath: '/abs/A3.md' },
  ])
  const r = handleWikiLookup({ zoteroKey: 'PNOPE', doi: '10.1/x' })
  expect(r.found).toBe(false)
  expect(r.inIndex).toBe(false)
  expect(r.reason).toBe('not_in_wiki')
})

/* ------------------------------ DOI 命中 + 解析未完成 ------------------------------ */

test('DOI 命中但 parseStatus=pending → found:false, inIndex:true, reason=parse_pending, 仍带 abstract', () => {
  writeIndex([{
    attachmentKey: 'A4',
    parentItemKey: 'P4',
    doi: '10.5555/foo',
    parseStatus: 'pending',
    mdPath: null,
    abstract: 'we propose ...',
  }])
  const r = handleWikiLookup({ doi: '10.5555/FOO' })
  expect(r.found).toBe(false)
  expect(r.inIndex).toBe(true)
  expect(r.parseStatus).toBe('pending')
  expect(r.reason).toBe('parse_pending')
  expect(r.abstract).toBe('we propose ...')
  expect(r.mdPath).toBeUndefined()
})

test('DOI 大小写 / 前缀 https://doi.org/ 都规范化', () => {
  writeIndex([{ doi: '10.1038/Nature12373', parseStatus: 'completed', mdPath: '/abs/x.md' }])
  const r = handleWikiLookup({ doi: 'https://doi.org/10.1038/nature12373' })
  expect(r.found).toBe(true)
})

test('DOI 命中但 parseStatus=failed → reason=parse_failed', () => {
  writeIndex([{ doi: '10.1/fail', parseStatus: 'failed', mdPath: null }])
  const r = handleWikiLookup({ doi: '10.1/fail' })
  expect(r.found).toBe(false)
  expect(r.inIndex).toBe(true)
  expect(r.reason).toBe('parse_failed')
})

/* ------------------------------ title + authors + year ------------------------------ */

test('title 完全相等 + authors 全部姓氏匹配 + year 一致 → 命中', () => {
  writeIndex([{
    title: 'A/B Testing: A Systematic Literature Review',
    authors: ['Quin, Federico', 'Weyns, Danny', 'Galster, Matthias'],
    year: '2024',
    parseStatus: 'completed',
    mdPath: '/abs/q.md',
  }])
  const r = handleWikiLookup({
    title: 'a b testing  a systematic literature review',
    authors: ['Quin', 'Weyns'],
    year: 2024,
  })
  expect(r.found).toBe(true)
})

test('year 不一致 → 不匹配', () => {
  writeIndex([{
    title: 'Same Title',
    authors: ['Smith, John'],
    year: '2020',
    parseStatus: 'completed',
    mdPath: '/abs/s.md',
  }])
  const r = handleWikiLookup({ title: 'same title', authors: ['Smith'], year: 2021 })
  expect(r.found).toBe(false)
  expect(r.reason).toBe('not_in_wiki')
})

test('输入作者多于 entry 作者 → 不匹配（缺哪个姓氏都不行）', () => {
  writeIndex([{
    title: 'The Paper',
    authors: ['Smith, John'],
    year: '2024',
    parseStatus: 'completed',
    mdPath: '/abs/x.md',
  }])
  const r = handleWikiLookup({ title: 'the paper', authors: ['Smith', 'Jones'], year: 2024 })
  expect(r.found).toBe(false)
})

test('输入只给标题（无 authors/year）→ 多条命中视为歧义', () => {
  writeIndex([
    { attachmentKey: 'A5', title: 'Common Title', parseStatus: 'completed', mdPath: '/abs/a5.md' },
    { attachmentKey: 'A6', title: 'Common Title', parseStatus: 'completed', mdPath: '/abs/a6.md' },
  ])
  const r = handleWikiLookup({ title: 'common title' })
  expect(r.found).toBe(false)
  expect(r.inIndex).toBe(true)
  expect(r.reason).toBe('ambiguous')
})

/* ------------------------------ pdfPath 输出 ------------------------------ */

test('imported_url linkMode → pdfPath 用 buildAttachmentPath 拼出', () => {
  writeIndex([{
    attachmentKey: 'KEY9',
    filename: 'paper.pdf',
    linkMode: 'imported_url',
    parseStatus: 'completed',
    mdPath: '/abs/KEY9.md',
    doi: '10.9/x',
  }])
  const r = handleWikiLookup({ doi: '10.9/x' })
  expect(r.found).toBe(true)
  expect(r.pdfPath).toContain(join('Zotero', 'storage', 'KEY9', 'paper.pdf'))
})

test('linked_url linkMode → pdfPath 省略（无本地文件）', () => {
  writeIndex([{
    linkMode: 'linked_url',
    parseStatus: 'completed',
    mdPath: '/abs/x.md',
    doi: '10.x/u',
  }])
  const r = handleWikiLookup({ doi: '10.x/u' })
  expect(r.found).toBe(true)
  expect(r.pdfPath).toBeUndefined()
})

/* ------------------------------ articlePath 输出 ------------------------------ */

test('articleStatus=completed + articlePath 非空 → 透传 articlePath + articleStatus', () => {
  writeIndex([{
    parseStatus: 'completed',
    mdPath: '/abs/wiki/KEYA.md',
    doi: '10.a/r1',
    articleStatus: 'completed',
    articlePath: '/abs/wiki/KEYA.article.md',
  }])
  const r = handleWikiLookup({ doi: '10.a/r1' })
  expect(r.found).toBe(true)
  expect(r.mdPath).toBe('/abs/wiki/KEYA.md')
  expect(r.articlePath).toBe('/abs/wiki/KEYA.article.md')
  expect(r.articleStatus).toBe('completed')
})

test('articleStatus=pending → articlePath 不返回，articleStatus 透传供下游决策', () => {
  writeIndex([{
    parseStatus: 'completed',
    mdPath: '/abs/wiki/KEYB.md',
    doi: '10.a/r2',
    articleStatus: 'pending',
    articlePath: null,
  }])
  const r = handleWikiLookup({ doi: '10.a/r2' })
  expect(r.found).toBe(true)
  expect(r.mdPath).toBe('/abs/wiki/KEYB.md')
  expect(r.articlePath).toBeUndefined()
  expect(r.articleStatus).toBe('pending')
})

test('articleStatus=completed 但 articlePath 为空（异常态）→ articlePath 不返回', () => {
  writeIndex([{
    parseStatus: 'completed',
    mdPath: '/abs/wiki/KEYC.md',
    doi: '10.a/r3',
    articleStatus: 'completed',
    articlePath: null,
  }])
  const r = handleWikiLookup({ doi: '10.a/r3' })
  expect(r.found).toBe(true)
  expect(r.articlePath).toBeUndefined()
})

test('旧索引 articleStatus=null（v3 之前） → 两字段都不返回', () => {
  writeIndex([{
    parseStatus: 'completed',
    mdPath: '/abs/wiki/KEYD.md',
    doi: '10.a/r4',
    articleStatus: null,
    articlePath: null,
  }])
  const r = handleWikiLookup({ doi: '10.a/r4' })
  expect(r.found).toBe(true)
  expect(r.articlePath).toBeUndefined()
  expect(r.articleStatus).toBeUndefined()
})

/* ----------------------------- txtPath 运行时 stat ----------------------------- */

test('txtPath：仅 .txt 物理文件存在 → 返回 txtPath（不返回 articlePath）', () => {
  writeIndex([{
    attachmentKey: 'KEYTXT01',
    parseStatus: 'completed',
    mdPath: '/abs/wiki/KEYTXT01.md',
    doi: '10.txt/only',
    articleStatus: null,
    articlePath: null,
  }])
  // 真实物理 .txt 文件
  writeFileSync(getZoteroWikiStructuredTxtPath('KEYTXT01'), 'dummy structured content', 'utf-8')

  const r = handleWikiLookup({ doi: '10.txt/only' })
  expect(r.found).toBe(true)
  expect(r.txtPath).toBe(getZoteroWikiStructuredTxtPath('KEYTXT01'))
  expect(r.articlePath).toBeUndefined()
})

test('txtPath + articlePath 同时存在 → 两者都返回（让下游按优先级选）', () => {
  writeIndex([{
    attachmentKey: 'KEYBOTH1',
    parseStatus: 'completed',
    mdPath: '/abs/wiki/KEYBOTH1.md',
    doi: '10.both/one',
    articleStatus: 'completed',
    articlePath: '/abs/wiki/KEYBOTH1.article.md',
  }])
  writeFileSync(getZoteroWikiStructuredTxtPath('KEYBOTH1'), 'dummy', 'utf-8')

  const r = handleWikiLookup({ doi: '10.both/one' })
  expect(r.found).toBe(true)
  expect(r.articlePath).toBe('/abs/wiki/KEYBOTH1.article.md')
  expect(r.txtPath).toBe(getZoteroWikiStructuredTxtPath('KEYBOTH1'))
})

test('txtPath：仅 .md 存在（无 .txt 物理文件） → 不返回 txtPath', () => {
  writeIndex([{
    attachmentKey: 'KEYMDON1',
    parseStatus: 'completed',
    mdPath: '/abs/wiki/KEYMDON1.md',
    doi: '10.md/only',
    articleStatus: null,
    articlePath: null,
  }])
  // 故意不写 .txt 文件
  const r = handleWikiLookup({ doi: '10.md/only' })
  expect(r.found).toBe(true)
  expect(r.txtPath).toBeUndefined()
  expect(r.articlePath).toBeUndefined()
})
