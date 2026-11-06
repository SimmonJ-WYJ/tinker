/**
 * zotero-paper-sync 单测
 *
 * 覆盖：
 *   - record.parent=null / title 缺失 → skip
 *   - added/modified 都被同步
 *   - first-baseline / skipped 状态不动 DB
 *   - zoteroKey 用父条目 itemKey（不是 attachmentKey）
 *   - creators / date 解析
 */

import { beforeEach, describe, expect, test } from 'bun:test'

import type { ZoteroPdfDiffResult, ZoteroPdfRecord } from '@asci/shared'

import { openTestDb } from './objects/repositories/_helpers.test.ts'
import { listPapers, findPaperByZoteroKey } from './objects/repositories/paper-repository.ts'
import { __testing__, applyDiffToPapers, applySnapshotToPapers } from './zotero-paper-sync.ts'

function makeRecord(overrides: Partial<ZoteroPdfRecord>): ZoteroPdfRecord {
  return {
    attachmentKey: 'ATT1',
    parentItemKey: 'PARENT1',
    version: 0,
    linkMode: 'imported_file',
    contentType: 'application/pdf',
    filename: 'p.pdf',
    title: 'p.pdf',
    dateModified: null,
    parse: {
      status: 'pending',
      attempts: 0,
      lastAttemptAt: null,
      lastError: null,
      mdRelPath: null,
      mdSize: null,
      mdMtime: null,
    } as ZoteroPdfRecord['parse'],
    parent: null,
    article: null,
    ...overrides,
  }
}

function makeDiff(overrides: Partial<ZoteroPdfDiffResult>): ZoteroPdfDiffResult {
  return {
    status: 'diff',
    total: 0,
    added: [],
    modified: [],
    deleted: [],
    ...overrides,
  }
}

describe('zotero-paper-sync: recordToPaperSyncInput', () => {
  test('完整 parent → 完整 PaperSyncInput', () => {
    const rec = makeRecord({
      parent: {
        itemKey: 'PARENT1',
        itemType: 'journalArticle',
        title: 'Long-Context vs RAG',
        creators: [
          { firstName: 'Alice', lastName: 'Wu', creatorType: 'author' },
          { name: 'Anthropic Research', creatorType: 'author' },
        ],
        date: '2024-05',
        DOI: '10.1/foo',
        url: 'https://example.com',
        abstractNote: 'abs',
        publicationTitle: 'NeurIPS',
      },
    })
    expect(__testing__.recordToPaperSyncInput(rec)).toEqual({
      source: 'zotero',
      title: 'Long-Context vs RAG',
      authors: ['Alice Wu', 'Anthropic Research'],
      abstract: 'abs',
      year: 2024,
      venue: 'NeurIPS',
      doi: '10.1/foo',
      url: 'https://example.com',
      zoteroKey: 'PARENT1',
    })
  })

  test('parent=null → 跳过 (null)', () => {
    expect(__testing__.recordToPaperSyncInput(makeRecord({ parent: null }))).toBeNull()
  })

  test('title 缺失 → 跳过 (null)', () => {
    const rec = makeRecord({
      parent: {
        itemKey: 'P',
        itemType: 'journalArticle',
        title: null,
        creators: [],
        date: null,
        DOI: null,
        url: null,
        abstractNote: null,
        publicationTitle: null,
      },
    })
    expect(__testing__.recordToPaperSyncInput(rec)).toBeNull()
  })

  test('zoteroKey 用父条目 itemKey 而非 attachmentKey', () => {
    const rec = makeRecord({
      attachmentKey: 'ATT-XYZ',
      parent: {
        itemKey: 'PARENT-ABC',
        itemType: 'journalArticle',
        title: 'T',
        creators: [],
        date: null,
        DOI: null,
        url: null,
        abstractNote: null,
        publicationTitle: null,
      },
    })
    const input = __testing__.recordToPaperSyncInput(rec)
    expect(input?.zoteroKey).toBe('PARENT-ABC')
  })
})

describe('zotero-paper-sync: extractYearFromDate', () => {
  test('多种 date 格式', () => {
    expect(__testing__.extractYearFromDate('2012')).toBe(2012)
    expect(__testing__.extractYearFromDate('2012-05')).toBe(2012)
    expect(__testing__.extractYearFromDate('May 2012')).toBe(2012)
    expect(__testing__.extractYearFromDate('2024-05-15')).toBe(2024)
    expect(__testing__.extractYearFromDate(null)).toBeNull()
    expect(__testing__.extractYearFromDate('not a date')).toBeNull()
  })
})

describe('zotero-paper-sync: applyDiffToPapers', () => {
  let repo: ReturnType<typeof openTestDb>['repo']
  beforeEach(() => {
    ;({ repo } = openTestDb())
  })

  test('added → create paper', () => {
    const diff = makeDiff({
      added: [
        makeRecord({
          attachmentKey: 'ATT1',
          parent: {
            itemKey: 'PK1',
            itemType: 'journalArticle',
            title: 'P1',
            creators: [{ firstName: 'A', lastName: 'B', creatorType: 'author' }],
            date: '2024',
            DOI: '10.1/p1',
            url: null,
            abstractNote: null,
            publicationTitle: null,
          },
        }),
      ],
    })
    const r = applyDiffToPapers(repo, diff)
    expect(r.created).toBe(1)
    expect(r.updated).toBe(0)
    const p = findPaperByZoteroKey(repo, 'PK1')!
    expect(p.title).toBe('P1')
    expect(p.year).toBe(2024)
    expect(p.doi).toBe('10.1/p1')
  })

  test('modified → update existing paper（补空）', () => {
    // 第一次 diff 建出来
    applyDiffToPapers(
      repo,
      makeDiff({
        added: [
          makeRecord({
            attachmentKey: 'ATT1',
            parent: {
              itemKey: 'PK1',
              itemType: 'journalArticle',
              title: 'P1',
              creators: [],
              date: null,
              DOI: '10.1/p1',
              url: null,
              abstractNote: null,
              publicationTitle: null,
            },
          }),
        ],
      }),
    )
    // modified: 父条目补 year + abstract
    const r = applyDiffToPapers(
      repo,
      makeDiff({
        modified: [
          {
            prev: makeRecord({ attachmentKey: 'ATT1' }),
            now: makeRecord({
              attachmentKey: 'ATT1',
              parent: {
                itemKey: 'PK1',
                itemType: 'journalArticle',
                title: 'P1',
                creators: [],
                date: '2024',
                DOI: '10.1/p1',
                url: null,
                abstractNote: 'new abs',
                publicationTitle: null,
              },
            }),
          },
        ],
      }),
    )
    expect(r.updated).toBe(1)
    const p = findPaperByZoteroKey(repo, 'PK1')!
    expect(p.year).toBe(2024)
    expect(p.abstract).toBe('new abs')
  })

  test('first-baseline 不动 DB', () => {
    const r = applyDiffToPapers(
      repo,
      makeDiff({ status: 'first-baseline', total: 5 }),
    )
    expect(r).toEqual({ created: 0, updated: 0, skipped: 0 })
    expect(listPapers(repo)).toHaveLength(0)
  })

  test('skipped-noop / skipped-disabled / error 不动 DB', () => {
    for (const status of ['skipped-noop', 'skipped-disabled', 'skipped-zotero-offline', 'error'] as const) {
      const r = applyDiffToPapers(repo, makeDiff({ status }))
      expect(r).toEqual({ created: 0, updated: 0, skipped: 0 })
    }
    expect(listPapers(repo)).toHaveLength(0)
  })

  test('parent=null 的 record 静默跳过；其他正常 add', () => {
    const r = applyDiffToPapers(
      repo,
      makeDiff({
        added: [
          makeRecord({ attachmentKey: 'A1', parent: null }),
          makeRecord({
            attachmentKey: 'A2',
            parent: {
              itemKey: 'PK2',
              itemType: 'journalArticle',
              title: 'Has Parent',
              creators: [],
              date: null,
              DOI: null,
              url: null,
              abstractNote: null,
              publicationTitle: null,
            },
          }),
        ],
      }),
    )
    expect(r.created).toBe(1)
    expect(listPapers(repo)).toHaveLength(1)
  })
})

describe('zotero-paper-sync: applySnapshotToPapers（全量 reconcile）', () => {
  let repo: ReturnType<typeof openTestDb>['repo']
  beforeEach(() => {
    ;({ repo } = openTestDb())
  })

  test('全量同步：所有有 parent 的 record 都进 papers，幂等', () => {
    const records = [
      makeRecord({
        attachmentKey: 'A1',
        parent: {
          itemKey: 'PK1',
          itemType: 'journalArticle',
          title: 'FlashAttention',
          creators: [],
          date: '2022',
          DOI: '10.48550/arXiv.2205.14135',
          url: null,
          abstractNote: null,
          publicationTitle: 'arXiv',
        },
      }),
      makeRecord({
        attachmentKey: 'A2',
        parent: {
          itemKey: 'PK2',
          itemType: 'journalArticle',
          title: 'LoRA',
          creators: [],
          date: '2021',
          DOI: '10.x/lora',
          url: null,
          abstractNote: null,
          publicationTitle: null,
        },
      }),
    ]
    const r1 = applySnapshotToPapers(repo, records)
    expect(r1.created).toBe(2)
    // 第二次同样输入 → 全部命中现有行，不重复创建
    const r2 = applySnapshotToPapers(repo, records)
    expect(r2.created).toBe(0)
    expect(listPapers(repo)).toHaveLength(2)
    // 通过 zoteroKey 反查能拿到（parent.itemKey）
    expect(findPaperByZoteroKey(repo, 'PK1')?.title).toBe('FlashAttention')
    expect(findPaperByZoteroKey(repo, 'PK2')?.title).toBe('LoRA')
  })

  test('parent=null 的 record 静默跳过', () => {
    const r = applySnapshotToPapers(repo, [
      makeRecord({ attachmentKey: 'A1', parent: null }),
      makeRecord({
        attachmentKey: 'A2',
        parent: {
          itemKey: 'PK',
          itemType: 'journalArticle',
          title: 'OK',
          creators: [],
          date: null,
          DOI: null,
          url: null,
          abstractNote: null,
          publicationTitle: null,
        },
      }),
    ])
    expect(r.created).toBe(1)
    expect(listPapers(repo)).toHaveLength(1)
  })

  test('空数组 → 全 0', () => {
    const r = applySnapshotToPapers(repo, [])
    expect(r).toEqual({ created: 0, updated: 0, skipped: 0 })
  })
})
