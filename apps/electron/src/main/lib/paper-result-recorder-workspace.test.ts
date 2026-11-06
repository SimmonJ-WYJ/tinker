import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let tmpHome: string
let originalHome: string | undefined

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'asci-recorder-'))
  originalHome = process.env.ASCI_CONFIG_HOME
  process.env.ASCI_CONFIG_HOME = tmpHome
  process.env.ASCI_DEV = ''
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.ASCI_CONFIG_HOME
  else process.env.ASCI_CONFIG_HOME = originalHome
  if (existsSync(tmpHome)) rmSync(tmpHome, { recursive: true, force: true })
})

test('paper-result-recorder 把识别到的论文回流到 workspace papers.jsonl', async () => {
  const recorder = await import(`./paper-result-recorder.ts?cb=${Date.now()}-1`)
  const store = await import(`./workspace-paper-store.ts?cb=${Date.now()}-1`)

  const slug = `test-${Date.now()}-1`
  recorder.trackToolUse('s1', 'tu1', 'WebFetch', { url: 'x' }, slug)
  const fakeToolResult = JSON.stringify({
    title: 'Sample',
    authors: ['Alice'],
    doi: '10.9/sample',
    year: 2024,
  })
  await recorder.handleToolResult('s1', 'tu1', fakeToolResult)

  const list = store.list(slug, {})
  expect(list).toHaveLength(1)
  expect(list[0]?.doi).toBe('10.9/sample')
  expect(list[0]?.sessionRefs).toEqual(['s1'])
})

test('未传 workspaceSlug 时只写 session jsonl，不写 workspace 索引', async () => {
  const recorder = await import(`./paper-result-recorder.ts?cb=${Date.now()}-2`)
  const store = await import(`./workspace-paper-store.ts?cb=${Date.now()}-2`)

  const slug = `test-${Date.now()}-2`
  recorder.trackToolUse('s2', 'tu2', 'WebFetch', { url: 'x' })
  await recorder.handleToolResult('s2', 'tu2', JSON.stringify({
    title: 'X', authors: ['B'], doi: '10.9/x', year: 2024,
  }))
  expect(store.list(slug, {})).toHaveLength(0)
})

// ===== issue #90：summarizeSessionPapersForPrompt =====

test('summarizeSessionPapersForPrompt 在空会话返回 null', async () => {
  const recorder = await import(`./paper-result-recorder.ts?cb=${Date.now()}-empty`)
  expect(recorder.summarizeSessionPapersForPrompt('no-such-session')).toBeNull()
})

test('summarizeSessionPapersForPrompt 输出按 ts 倒序、按 recordKey 去重', async () => {
  const recorder = await import(`./paper-result-recorder.ts?cb=${Date.now()}-summary`)
  const sessionId = `s-sum-${Date.now()}`

  // 两次相同 DOI（应去重），加一条 arXiv 与一条 title-only
  recorder.trackToolUse(sessionId, 'tu1', 'WebFetch', { query: 'q1' })
  await recorder.handleToolResult(sessionId, 'tu1', JSON.stringify({
    items: [
      { title: 'Paper A', authors: ['Alice'], doi: '10.9/a', year: 2023 },
      { title: 'Paper A v2', authors: ['Alice'], doi: '10.9/a', year: 2023 },
      { title: 'Paper B', authors: ['Bob'], year: 2024, arxivId: '2401.12345' },
    ],
  }))

  const summary = recorder.summarizeSessionPapersForPrompt(sessionId)
  expect(summary).not.toBeNull()
  expect(summary?.total).toBe(2) // DOI 去重后 2 篇
  expect(summary?.truncated).toBe(0)
  expect(summary?.lines.length).toBe(2)
  // 至少包含 DOI 与 arXiv 标识
  const joined = summary?.lines.join('\n') ?? ''
  expect(joined).toContain('doi:10.9/a')
  expect(joined).toContain('arXiv:2401.12345')
  expect(joined).toContain('Paper A')
  expect(joined).toContain('Paper B')
})

test('summarizeSessionPapersForPrompt 超过 maxEntries 时截断并报告 truncated 数量', async () => {
  const recorder = await import(`./paper-result-recorder.ts?cb=${Date.now()}-trunc`)
  const sessionId = `s-trunc-${Date.now()}`

  const items = Array.from({ length: 8 }, (_, i) => ({
    title: `Paper ${i}`,
    authors: ['X'],
    doi: `10.9/p${i}`,
    year: 2024,
  }))
  recorder.trackToolUse(sessionId, 'tu1', 'WebFetch', { query: 'q' })
  await recorder.handleToolResult(sessionId, 'tu1', JSON.stringify({ items }))

  const summary = recorder.summarizeSessionPapersForPrompt(sessionId, 3)
  expect(summary?.total).toBe(8)
  expect(summary?.lines.length).toBe(3)
  expect(summary?.truncated).toBe(5)
})
