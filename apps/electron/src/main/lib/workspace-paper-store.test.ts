import { test, expect, beforeEach, afterEach, describe } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PaperRecord, WorkspacePaperEntry } from '@asci/shared'

let tmpHome: string
let originalHome: string | undefined
let testCounter = 0

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'asci-papers-'))
  originalHome = process.env.ASCI_CONFIG_HOME
  process.env.ASCI_CONFIG_HOME = tmpHome
  process.env.ASCI_DEV = ''
  testCounter++
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.ASCI_CONFIG_HOME
  else process.env.ASCI_CONFIG_HOME = originalHome
  rmSync(tmpHome, { recursive: true, force: true })
})

// 每个测试使用独立的 slug，避免跨测试污染
function getSlug(): string {
  return `demo-${testCounter}`
}

function makePaperRecord(overrides: Partial<PaperRecord> = {}): PaperRecord {
  return {
    ts: '2026-04-23T10:00:00.000Z',
    query: 'cancer',
    source: 'tool:WebFetch',
    title: 'Sample paper title',
    authors: ['Alice'],
    year: 2024,
    venue: 'Nature',
    doi: '10.1234/abc',
    url: null,
    abstract: 'sample abstract',
    extra: undefined,
    ...overrides,
  }
}

describe('workspace-paper-store.appendOrMerge', () => {
  test('首次写入：创建条目，status=unread, sessionRefs/seenCount 初始化', async () => {
    const mod = await import(`./workspace-paper-store.ts?cb=${Math.random()}`)
    const slug = `test-${Math.random()}`
    const result = mod.appendOrMerge(slug, [makePaperRecord()], 'session-1')
    expect(result).toHaveLength(1)
    const e = result[0] as WorkspacePaperEntry
    expect(e.status).toBe('unread')
    expect(e.starred).toBe(false)
    expect(e.tags).toEqual([])
    expect(e.note).toBeNull()
    expect(e.linkedZoteroKey).toBeNull()
    expect(e.sessionRefs).toEqual(['session-1'])
    expect(e.seenCount).toBe(1)
    expect(e.firstSeenAt).toBe(e.lastSeenAt)
    expect(e.key).toBe('doi:10.1234/abc')
  })

  test('同 DOI 第二次：seenCount + sessionRefs 累加，lastSeenAt 更新，firstSeenAt 不变', async () => {
    const mod = await import(`./workspace-paper-store.ts?cb=${Math.random()}`)
    const slug = `test-${Math.random()}`
    mod.appendOrMerge(slug, [makePaperRecord({ ts: '2026-04-23T10:00:00.000Z' })], 'session-1')
    const result = mod.appendOrMerge(slug, [makePaperRecord({ ts: '2026-04-24T10:00:00.000Z' })], 'session-2')
    const e = result[0] as WorkspacePaperEntry
    expect(e.sessionRefs.sort()).toEqual(['session-1', 'session-2'])
    expect(e.seenCount).toBe(2)
    expect(e.firstSeenAt).toBe('2026-04-23T10:00:00.000Z')
    expect(e.lastSeenAt).toBe('2026-04-24T10:00:00.000Z')
  })

  test('用户标注层不被升级覆盖：星标 / tags / note / status 必须保留', async () => {
    const mod = await import(`./workspace-paper-store.ts?cb=${Math.random()}`)
    const slug = `test-${Math.random()}`
    mod.appendOrMerge(slug, [makePaperRecord({ authors: ['Alice'] })], 'session-1')
    mod.update(slug, 'doi:10.1234/abc', { starred: true, tags: ['methods'], note: 'Q3 相关', status: 'saved' })
    const richer = makePaperRecord({ authors: ['Alice', 'Bob', 'Carol'], abstract: 'much longer abstract...' })
    const result = mod.appendOrMerge(slug, [richer], 'session-2')
    const e = result[0] as WorkspacePaperEntry
    expect(e.authors.length).toBe(3)
    expect(e.abstract).toBe('much longer abstract...')
    expect(e.starred).toBe(true)
    expect(e.tags).toEqual(['methods'])
    expect(e.note).toBe('Q3 相关')
    expect(e.status).toBe('saved')
  })

  test('#685 缺摘要→有摘要：单独回填 abstract，绕过 isRicherIdentity 的 +2 门槛', async () => {
    const mod = await import(`./workspace-paper-store.ts?cb=${Math.random()}`)
    const slug = `test-${Math.random()}`
    // 已有条目：作者/年/刊/url 齐全但缺摘要（典型 well-indexed 论文，#685 场景）
    const base = {
      authors: ['Alice', 'Bob', 'Carol'],
      year: 2009,
      venue: 'Nature Methods',
      url: 'https://doi.org/10.1234/abc',
      abstract: null,
    }
    mod.appendOrMerge(slug, [makePaperRecord(base)], 'session-1')
    // 第二次：同 DOI 仅补上 abstract（其它身份字段不变 → 仅 +1 分，过不了 +2 门槛）
    const recovered = 'Recovered abstract from Europe PMC fallback.'
    const result = mod.appendOrMerge(slug, [makePaperRecord({ ...base, abstract: recovered })], 'session-2')
    const e = result[0] as WorkspacePaperEntry
    expect(e.abstract).toBe(recovered)
  })

  test('#685 已有摘要不被回填路径覆盖（仅在缺失时补）', async () => {
    const mod = await import(`./workspace-paper-store.ts?cb=${Math.random()}`)
    const slug = `test-${Math.random()}`
    const base = {
      authors: ['Alice', 'Bob', 'Carol'],
      year: 2009,
      venue: 'Nature Methods',
      url: 'https://doi.org/10.1234/abc',
      abstract: '原始摘要',
    }
    mod.appendOrMerge(slug, [makePaperRecord(base)], 'session-1')
    // 同 DOI、非整体升级、abstract 不同 → 不走回填（已有摘要保留，不被冲掉）
    const result = mod.appendOrMerge(slug, [makePaperRecord({ ...base, abstract: '另一个摘要' })], 'session-2')
    const e = result[0] as WorkspacePaperEntry
    expect(e.abstract).toBe('原始摘要')
  })

  test('无 DOI 但有 title+year 时使用 title+year 弱兜底 key', async () => {
    const mod = await import(`./workspace-paper-store.ts?cb=${Math.random()}`)
    const r = mod.appendOrMerge(`test-${Math.random()}`, [makePaperRecord({ doi: null, title: 'Title X', year: 2023 })], 's1')
    expect(r[0]?.key).toBe('t:title x|y:2023')
  })

  test('persist：重复 import 后 list 仍能看到上次写入', async () => {
    const mod = await import(`./workspace-paper-store.ts?cb=${Math.random()}`)
    const slug = `test-${Math.random()}`
    mod.appendOrMerge(slug, [makePaperRecord()], 'session-1')
    const mod2 = await import(`./workspace-paper-store.ts?cb=${Math.random()}`)
    const list = mod2.list(slug, {})
    expect(list).toHaveLength(1)
  })

  test('同 session 重复检索同一篇：seenCount 不重复 +1', async () => {
    const mod = await import(`./workspace-paper-store.ts?cb=${Math.random()}`)
    const slug = `test-${Math.random()}`
    mod.appendOrMerge(slug, [makePaperRecord()], 'session-1')
    // 同 session 再写一次（Agent 在同一会话内反复检索常见）
    const result = mod.appendOrMerge(slug, [makePaperRecord({ ts: '2026-04-25T10:00:00.000Z' })], 'session-1')
    const e = result[0] as WorkspacePaperEntry
    expect(e.seenCount).toBe(1)  // 不变
    expect(e.sessionRefs).toEqual(['session-1'])
    // lastSeenAt 仍可更新（因为本次确实又被检到了一次）
    expect(e.lastSeenAt).toBe('2026-04-25T10:00:00.000Z')
  })

  test('一次写入多条：去重逻辑生效', async () => {
    const mod = await import(`./workspace-paper-store.ts?cb=${Math.random()}`)
    const r1 = makePaperRecord({ doi: '10.1/aaa' })
    const r2 = makePaperRecord({ doi: '10.1/aaa', authors: ['Bob'] })
    const r3 = makePaperRecord({ doi: '10.1/bbb' })
    const result = mod.appendOrMerge(`test-${Math.random()}`, [r1, r2, r3], 's1')
    expect(result).toHaveLength(2)
  })
})

describe('workspace-paper-store.appendOrMerge — onlyExisting 仅刷新模式（#702）', () => {
  test('已存在条目（缺摘要）二次检索带摘要：abstract 回填 + lastSeenAt 刷新', async () => {
    const mod = await import(`./workspace-paper-store.ts?cb=${Math.random()}`)
    const slug = `test-${Math.random()}`
    // 用户先把论文加入文献库（缺摘要）
    const base = {
      authors: ['Alice', 'Bob', 'Carol'],
      year: 2009,
      venue: 'Nature Methods',
      url: 'https://doi.org/10.1234/abc',
      abstract: null,
    }
    mod.appendOrMerge(slug, [makePaperRecord({ ...base, ts: '2026-06-17T10:00:00.000Z' })], 'session-1')
    // 后续 retrieve 命中同篇且带摘要，走 onlyExisting 回流
    const recovered = 'Recovered abstract from a later retrieve.'
    const result = mod.appendOrMerge(
      slug,
      [makePaperRecord({ ...base, abstract: recovered, ts: '2026-06-25T10:00:00.000Z' })],
      'session-2',
      { onlyExisting: true },
    )
    expect(result).toHaveLength(1)
    const e = result[0] as WorkspacePaperEntry
    expect(e.abstract).toBe(recovered)
    expect(e.lastSeenAt).toBe('2026-06-25T10:00:00.000Z')
  })

  test('未存在条目：onlyExisting 不新建（length 不增）', async () => {
    const mod = await import(`./workspace-paper-store.ts?cb=${Math.random()}`)
    const slug = `test-${Math.random()}`
    // 文献库已有 A
    mod.appendOrMerge(slug, [makePaperRecord({ doi: '10.1/exists', title: 'Existing' })], 'session-1')
    // retrieve 命中一篇未加入的 B + 已加入的 A
    const result = mod.appendOrMerge(
      slug,
      [
        makePaperRecord({ doi: '10.1/exists', title: 'Existing', abstract: 'new abs' }),
        makePaperRecord({ doi: '10.1/fresh', title: 'Not in library' }),
      ],
      'session-2',
      { onlyExisting: true },
    )
    // 只刷新已存在的 A，不新建 B
    expect(result).toHaveLength(1)
    expect(result[0]!.key).toBe('doi:10.1/exists')
    expect(mod.list(slug, {})).toHaveLength(1)
    expect(mod.get(slug, 'doi:10.1/fresh')).toBeNull()
  })

  test('用户标注层在 onlyExisting 回流后不被覆盖', async () => {
    const mod = await import(`./workspace-paper-store.ts?cb=${Math.random()}`)
    const slug = `test-${Math.random()}`
    mod.appendOrMerge(slug, [makePaperRecord({ abstract: null })], 'session-1')
    mod.update(slug, 'doi:10.1234/abc', { starred: true, tags: ['methods'], note: 'note', status: 'saved' })
    mod.appendOrMerge(
      slug,
      [makePaperRecord({ abstract: '回流补的摘要' })],
      'session-2',
      { onlyExisting: true },
    )
    const e = mod.get(slug, 'doi:10.1234/abc') as WorkspacePaperEntry
    expect(e.abstract).toBe('回流补的摘要')
    expect(e.starred).toBe(true)
    expect(e.tags).toEqual(['methods'])
    expect(e.note).toBe('note')
    expect(e.status).toBe('saved')
  })

  test('默认（不传 opts）仍新建条目，向后兼容 INGEST_RECORDS 路径', async () => {
    const mod = await import(`./workspace-paper-store.ts?cb=${Math.random()}`)
    const slug = `test-${Math.random()}`
    const result = mod.appendOrMerge(slug, [makePaperRecord()], 'session-1')
    expect(result).toHaveLength(1)
    expect(mod.list(slug, {})).toHaveLength(1)
  })

  test('lastSeenAt 单调不减：一批含同论文新旧两条（ts 降序），不回退到最旧 ts', async () => {
    const mod = await import(`./workspace-paper-store.ts?cb=${Math.random()}`)
    const slug = `test-${Math.random()}`
    mod.appendOrMerge(slug, [makePaperRecord({ ts: '2026-06-20T10:00:00.000Z' })], 'session-1')
    // reflow 重 merge 整个 session 历史：listSessionPapers 按 ts 降序传入（新→旧）
    const result = mod.appendOrMerge(
      slug,
      [
        makePaperRecord({ ts: '2026-06-25T10:00:00.000Z' }), // 新（turn2）
        makePaperRecord({ ts: '2026-06-22T10:00:00.000Z' }), // 旧（turn1）
      ],
      'session-2',
      { onlyExisting: true },
    )
    const e = result[0] as WorkspacePaperEntry
    // 取较新值，不被最后处理的最旧条目冲掉
    expect(e.lastSeenAt).toBe('2026-06-25T10:00:00.000Z')
  })
})

describe('workspace-paper-store.list / get / update / batchUpdate', () => {
  async function seed() {
    const mod = await import(`./workspace-paper-store.ts?cb=${Date.now()}`)
    const SLUG = getSlug()
    mod.appendOrMerge(SLUG, [
      makePaperRecord({ doi: '10.1/a', title: 'Paper A', year: 2024 }),
      makePaperRecord({ doi: '10.1/b', title: 'Paper B', year: 2023 }),
      makePaperRecord({ doi: '10.1/c', title: 'Paper C', year: 2024 }),
    ], 'session-1')
    return { mod, SLUG }
  }

  test('list 默认返回全部，按 lastSeenAt 倒序', async () => {
    const { mod, SLUG } = await seed()
    const result = mod.list(SLUG, {})
    expect(result).toHaveLength(3)
  })

  test('list 按 status 筛选', async () => {
    const { mod, SLUG } = await seed()
    mod.update(SLUG, 'doi:10.1/a', { status: 'saved' })
    const saved = mod.list(SLUG, { status: ['saved'] })
    expect(saved).toHaveLength(1)
    expect(saved[0]?.key).toBe('doi:10.1/a')
  })

  test('list 按 starred 筛选', async () => {
    const { mod, SLUG } = await seed()
    mod.update(SLUG, 'doi:10.1/a', { starred: true })
    expect(mod.list(SLUG, { starred: true })).toHaveLength(1)
    expect(mod.list(SLUG, { starred: false })).toHaveLength(2)
  })

  test('list 按 tags 取交集', async () => {
    const { mod, SLUG } = await seed()
    mod.update(SLUG, 'doi:10.1/a', { tags: ['methods', 'gpt'] })
    mod.update(SLUG, 'doi:10.1/b', { tags: ['methods'] })
    expect(mod.list(SLUG, { tags: ['methods'] })).toHaveLength(2)
    expect(mod.list(SLUG, { tags: ['methods', 'gpt'] })).toHaveLength(1)
  })

  test('list 按 keyword 在 title/authors/abstract 内查找', async () => {
    const { mod, SLUG } = await seed()
    expect(mod.list(SLUG, { keyword: 'paper a' })).toHaveLength(1)
    expect(mod.list(SLUG, { keyword: 'alice' })).toHaveLength(3)
  })

  test('list 支持 offset + limit 分页', async () => {
    const { mod, SLUG } = await seed()
    const page1 = mod.list(SLUG, { limit: 2, offset: 0 })
    const page2 = mod.list(SLUG, { limit: 2, offset: 2 })
    expect(page1).toHaveLength(2)
    expect(page2).toHaveLength(1)
  })

  test('get 返回精确条目，不存在返回 null', async () => {
    const { mod, SLUG } = await seed()
    expect(mod.get(SLUG, 'doi:10.1/a')?.title).toBe('Paper A')
    expect(mod.get(SLUG, 'doi:nonexistent')).toBeNull()
  })

  test('update 不存在的 key 抛错', async () => {
    const { mod, SLUG } = await seed()
    expect(() => mod.update(SLUG, 'doi:nonexistent', { starred: true })).toThrow(/不存在/)
  })

  test('update note 设为空字符串和 null 效果不同（null = 清空）', async () => {
    const { mod, SLUG } = await seed()
    mod.update(SLUG, 'doi:10.1/a', { note: '感想' })
    expect(mod.get(SLUG, 'doi:10.1/a')?.note).toBe('感想')
    mod.update(SLUG, 'doi:10.1/a', { note: null })
    expect(mod.get(SLUG, 'doi:10.1/a')?.note).toBeNull()
  })

  test('batchUpdate 只命中存在的 key，返回被改的条目', async () => {
    const { mod, SLUG } = await seed()
    const touched = mod.batchUpdate(SLUG, ['doi:10.1/a', 'doi:10.1/b', 'doi:nonexistent'], { starred: true })
    expect(touched).toHaveLength(2)
    expect(touched.every((e: WorkspacePaperEntry) => e.starred === true)).toBe(true)
  })
})

describe('workspace-paper-store — authors 字段兜底（#fix: authors string → string[]）', () => {
  test('JSONL 中 authors 为 string 时，list 返回的 authors 应为 string[]', async () => {
    const mod = await import(`./workspace-paper-store.ts?cb=${Math.random()}`)
    const slug = `test-dirty-${Math.random()}`
    // 直接写入一条 authors 为 string 的脏数据到 JSONL
    const dirtyEntry = {
      key: 'doi:10.9999/dirty',
      title: 'Dirty Authors Paper',
      authors: 'Alice, Bob, Carol',  // 错误：应为 string[] 但存为了 string
      year: 2024,
      venue: 'Nature',
      doi: '10.9999/dirty',
      url: null,
      abstract: null,
      extra: undefined,
      status: 'unread',
      starred: false,
      tags: [],
      note: null,
      noteRelPath: null,
      pdfRelPath: null,
      linkedZoteroKey: null,
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
      sessionRefs: ['s1'],
      seenCount: 1,
    }
    const papersDir = join(tmpHome, '.asci', 'agent-workspaces', slug)
    mkdirSync(papersDir, { recursive: true })
    writeFileSync(join(papersDir, 'papers.jsonl'), JSON.stringify(dirtyEntry) + '\n', 'utf-8')

    const result = mod.list(slug, {})
    expect(result).toHaveLength(1)
    const entry = result[0] as WorkspacePaperEntry
    // 关键断言：authors 被规范为 string[]，且 .slice().join() 不会 throw
    expect(Array.isArray(entry.authors)).toBe(true)
    expect(entry.authors).toEqual(['Alice', 'Bob', 'Carol'])
    expect(entry.authors.slice(0, 2).join(', ')).toBe('Alice, Bob')
  })

  test('JSONL 中 authors 为 null/undefined 时，list 返回空数组', async () => {
    const mod = await import(`./workspace-paper-store.ts?cb=${Math.random()}`)
    const slug = `test-null-${Math.random()}`
    const dirtyEntry = {
      key: 'doi:10.9999/null',
      title: 'Null Authors Paper',
      authors: null,
      year: 2024,
      venue: null,
      doi: '10.9999/null',
      url: null,
      abstract: null,
      extra: undefined,
      status: 'unread',
      starred: false,
      tags: [],
      note: null,
      noteRelPath: null,
      pdfRelPath: null,
      linkedZoteroKey: null,
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
      sessionRefs: ['s1'],
      seenCount: 1,
    }
    const papersDir = join(tmpHome, '.asci', 'agent-workspaces', slug)
    mkdirSync(papersDir, { recursive: true })
    writeFileSync(join(papersDir, 'papers.jsonl'), JSON.stringify(dirtyEntry) + '\n', 'utf-8')

    const result = mod.list(slug, {})
    expect(result).toHaveLength(1)
    expect(Array.isArray(result[0]!.authors)).toBe(true)
    expect(result[0]!.authors).toEqual([])
  })

  test('正常 string[] authors 不受影响', async () => {
    const mod = await import(`./workspace-paper-store.ts?cb=${Math.random()}`)
    const slug = `test-normal-${Math.random()}`
    mod.appendOrMerge(slug, [makePaperRecord({ authors: ['X', 'Y'] })], 'session-1')
    const result = mod.list(slug, {})
    expect(result[0]!.authors).toEqual(['X', 'Y'])
  })
})
