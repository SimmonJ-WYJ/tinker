/**
 * 嵌入 worker 单测：增量判定（content_hash）/ 三层语料 / 源缺失清理。
 * vdb 用 bun:sqlite 适配（FTS-only），embed 注入 stub。
 */

import { describe, expect, test } from 'bun:test'
import type { ZoteroPdfRecord } from '@asci/shared'

import { contentHash, runOne, type WorkerDeps } from './worker.ts'
import { openTestVectorDb } from './test-helpers.ts'

const LITE_MD = `# PDF

> attachmentKey: \`KEY1\`

---

This paragraph talks about grouped query attention and KV cache.

Another paragraph about evaluation results.`

const ARTICLE_MD = `---
title: x
---

# OUTLINE

- 1. Intro

# CONTENT

<p id="p1_1">Summary of the attention cost story.</p>`

function makeRec(overrides?: Partial<ZoteroPdfRecord>): ZoteroPdfRecord {
  return {
    attachmentKey: 'KEY1',
    parentItemKey: 'P1',
    version: 0,
    linkMode: 'imported_file',
    contentType: 'application/pdf',
    filename: 'x.pdf',
    title: 'Fallback Title',
    dateModified: null,
    parse: { status: 'completed', mdPath: '/wiki/KEY1.md' } as ZoteroPdfRecord['parse'],
    parent: {
      itemKey: 'P1',
      itemType: 'journalArticle',
      title: 'GQA for Long-Context',
      creators: [{ lastName: 'Chen', firstName: 'Yingfa', creatorType: 'author' }],
      date: '2025-03',
      DOI: null,
      url: null,
      abstractNote: 'Grouped-Query Attention is widely adopted...',
      publicationTitle: null,
    },
    article: null,
    ...overrides,
  } as ZoteroPdfRecord
}

function makeDeps(vdb: ZoteroVectorDb, opts?: {
  rec?: ZoteroPdfRecord | undefined
  files?: Record<string, string>
  embedCalls?: string[][]
}): WorkerDeps {
  const files = opts?.files ?? { '/wiki/KEY1.md': LITE_MD }
  return {
    // 'rec' 键显式存在时尊重其值（含 undefined = 模拟 record 已被删除）
    getRecord: () => (opts && 'rec' in opts ? opts.rec : makeRec()),
    getMdPath: (k) => `/wiki/${k}.md`,
    getStructuredTxtPath: (k) => `/wiki/${k}.txt`,
    getArticleMdPath: (k) => `/wiki/${k}.article.md`,
    readFile: (p) => {
      const c = files[p]
      if (c === undefined) throw new Error(`no file: ${p}`)
      return c
    },
    fileExists: (p) => files[p] !== undefined,
    vdb,
    embed: (texts) => {
      opts?.embedCalls?.push(texts)
      return Promise.resolve(texts.map(() => new Float32Array(4)))
    },
  }
}

describe('runOne — 增量嵌入', () => {
  test('首跑：raw + title_abstract 两层入库（无 article）', async () => {
    const vdb = openTestVectorDb({ modelId: 'test', embedDim: 4 })
    const results = await runOne('KEY1', makeDeps(vdb))
    const embedded = results.filter((r) => r.action === 'embedded')
    expect(embedded.map((r) => r.textKind).sort()).toEqual(['raw', 'title_abstract'])
    expect(vdb.getContentHash('KEY1', 'raw')).toBe(contentHash(LITE_MD))
    expect(vdb.countChunks()).toBeGreaterThanOrEqual(2)
  })

  test('重跑未变更 → 全层 skipped-fresh，不触发嵌入', async () => {
    const vdb = openTestVectorDb({ modelId: 'test', embedDim: 4 })
    await runOne('KEY1', makeDeps(vdb))
    const embedCalls: string[][] = []
    const results = await runOne('KEY1', makeDeps(vdb, { embedCalls }))
    expect(results.every((r) => r.action === 'skipped-fresh')).toBe(true)
    expect(embedCalls).toHaveLength(0)
  })

  test('raw 内容变更 → 仅 raw 层重嵌，title_abstract 跳过', async () => {
    const vdb = openTestVectorDb({ modelId: 'test', embedDim: 4 })
    await runOne('KEY1', makeDeps(vdb))
    const changed = `${LITE_MD}\n\nA brand new appended paragraph.`
    const results = await runOne('KEY1', makeDeps(vdb, { files: { '/wiki/KEY1.md': changed } }))
    const byKind = Object.fromEntries(results.map((r) => [r.textKind, r.action]))
    expect(byKind.raw).toBe('embedded')
    expect(byKind.title_abstract).toBe('skipped-fresh')
    expect(vdb.getContentHash('KEY1', 'raw')).toBe(contentHash(changed))
  })

  test('article 完成后 → 追加 article 层', async () => {
    const vdb = openTestVectorDb({ modelId: 'test', embedDim: 4 })
    await runOne('KEY1', makeDeps(vdb))
    const rec = makeRec({
      article: { status: 'completed', articlePath: '/wiki/KEY1.article.md' } as ZoteroPdfRecord['article'],
    })
    const results = await runOne(
      'KEY1',
      makeDeps(vdb, {
        rec,
        files: { '/wiki/KEY1.md': LITE_MD, '/wiki/KEY1.article.md': ARTICLE_MD },
      }),
    )
    const byKind = Object.fromEntries(results.map((r) => [r.textKind, r.action]))
    expect(byKind.article).toBe('embedded')
    expect(byKind.raw).toBe('skipped-fresh')
    // article 层段落锚点保留
    const hits = vdb.search({ queryText: 'attention cost story', maxResults: 5 })
    expect(hits.some((h) => h.textKind === 'article' && h.anchorStart === 'p1_1')).toBe(true)
  })

  test('raw 层优先 structured .txt（存在时用 .txt，段落锚点）', async () => {
    const vdb = openTestVectorDb({ modelId: 'test', embedDim: 4 })
    const STRUCTURED = `---\ntitle: x\n---\n\n# CONTENT\n\n<p id="p2_3">Structured paragraph with clean layout text.</p>`
    await runOne(
      'KEY1',
      makeDeps(vdb, { files: { '/wiki/KEY1.md': LITE_MD, '/wiki/KEY1.txt': STRUCTURED } }),
    )
    const hits = vdb.search({ queryText: 'clean layout', maxResults: 5 })
    expect(hits.length).toBe(1)
    expect(hits[0].textKind).toBe('raw')
    expect(hits[0].anchorStart).toBe('p2_3') // 段落锚点而非字节偏移，证明用了 .txt
  })

  test('无 .txt 时 raw 层回退 lite .md（字节偏移锚点）', async () => {
    const vdb = openTestVectorDb({ modelId: 'test', embedDim: 4 })
    await runOne('KEY1', makeDeps(vdb)) // 只有 /wiki/KEY1.md
    const hits = vdb.search({ queryText: 'grouped query attention', maxResults: 5 })
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].anchorStart).toMatch(/^b\d+$/)
  })

  test('record 不在 / 未解析完成 → 清理残留索引', async () => {
    const vdb = openTestVectorDb({ modelId: 'test', embedDim: 4 })
    await runOne('KEY1', makeDeps(vdb))
    expect(vdb.countChunks()).toBeGreaterThan(0)
    const results = await runOne('KEY1', makeDeps(vdb, { rec: undefined }))
    expect(results[0]!.action).toBe('missing-source')
    expect(vdb.countChunks()).toBe(0)
  })
})
