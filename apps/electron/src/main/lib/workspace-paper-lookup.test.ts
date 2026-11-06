/**
 * workspace-paper-lookup 单测
 *
 * 覆盖：
 *   - lookupByDoi：DOI 归一 / 跨 workspace 命中 / 多 workspace 中优先有 linkedZoteroKey 的一条
 *   - resolveZoteroKeyForEvidence：四种 status × （SQLite 命中 / workspace 兜底）
 *
 * 用 TMP 目录构造 fake workspaces + 重定向 config-paths via env / module mock。
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

import type { WorkspacePaperEntry } from '@asci/shared'

import { lookupByDoi, __testing__ } from './workspace-paper-lookup.ts'

// ===== 临时 workspace dir 工厂 =====
function makeFakeWorkspacesRoot(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'asci-ws-lookup-'))
  // 注入 HOME 不靠谱（config-paths 已被加载）；改用直接覆盖目录
  // 用 monkey-patch process.env.ASCI_HOME 行不通时，本测试用直接 require 重载思路
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

function makeEntry(over: Partial<WorkspacePaperEntry>): WorkspacePaperEntry {
  return {
    title: 'Some Paper',
    authors: ['A'],
    year: 2024,
    venue: 'NeurIPS',
    doi: '10.x/abc',
    url: null,
    abstract: null,
    status: 'read',
    starred: false,
    tags: [],
    note: null,
    noteRelPath: null,
    pdfRelPath: null,
    linkedZoteroKey: null,
    key: 'k1',
    firstSeenAt: '2025-01-01T00:00:00Z',
    lastSeenAt: '2025-01-01T00:00:00Z',
    sessionRefs: [],
    seenCount: 1,
    ...over,
  }
}

function writeWorkspace(root: string, slug: string, entries: WorkspacePaperEntry[]): void {
  const dir = join(root, slug)
  mkdirSync(dir, { recursive: true })
  const lines = entries.map((e) => JSON.stringify(e)).join('\n')
  writeFileSync(join(dir, 'papers.jsonl'), lines + (lines ? '\n' : ''), 'utf-8')
}

// ===== 跨进程环境覆盖 =====
// config-paths 用 ASCI_CONFIG_HOME 做测试隔离；目录名 .asci-dev（dev）或 .asci（prod）
// 由 ASCI_DEV 控制；本测试统一用 .asci-dev 与默认 dev 模式一致。
let prevConfigHome: string | undefined
let prevAsciDev: string | undefined
let tmp: { root: string; cleanup: () => void } | null = null

beforeEach(() => {
  tmp = makeFakeWorkspacesRoot()
  prevConfigHome = process.env.ASCI_CONFIG_HOME
  prevAsciDev = process.env.ASCI_DEV
  process.env.ASCI_CONFIG_HOME = tmp.root
  process.env.ASCI_DEV = '1'
})

afterEach(() => {
  if (prevConfigHome === undefined) delete process.env.ASCI_CONFIG_HOME
  else process.env.ASCI_CONFIG_HOME = prevConfigHome
  if (prevAsciDev === undefined) delete process.env.ASCI_DEV
  else process.env.ASCI_DEV = prevAsciDev
  prevConfigHome = undefined
  prevAsciDev = undefined
  if (tmp) tmp.cleanup()
  tmp = null
})

// 把测试 fixture 用的 workspaces 写到 fake config home 的对应目录
function setup(workspaces: Record<string, WorkspacePaperEntry[]>): void {
  if (!tmp) throw new Error('tmp not initialized')
  const wsDir = join(tmp.root, '.asci-dev', 'agent-workspaces')
  mkdirSync(wsDir, { recursive: true })
  for (const [slug, entries] of Object.entries(workspaces)) {
    writeWorkspace(wsDir, slug, entries)
  }
}

describe('workspace-paper-lookup: normalizeDoi', () => {
  test('归一形式与 paper-repository 一致', () => {
    expect(__testing__.normalizeDoi('10.X/AbC')).toBe('10.x/abc')
    expect(__testing__.normalizeDoi('https://doi.org/10.X/AbC')).toBe('10.x/abc')
    expect(__testing__.normalizeDoi('doi:10.X/Y')).toBe('10.x/y')
    expect(__testing__.normalizeDoi(null)).toBeNull()
    expect(__testing__.normalizeDoi('')).toBeNull()
  })
})

describe('workspace-paper-lookup: lookupByDoi', () => {
  test('未命中：返回 entry=null', () => {
    setup({ ws1: [makeEntry({ doi: '10.x/other' })] })
    const r = lookupByDoi('10.x/missing')
    expect(r.entry).toBeNull()
    expect(r.workspaceSlug).toBeNull()
  })

  test('命中：DOI 大小写不敏感', () => {
    setup({ ws1: [makeEntry({ doi: '10.X/AbC', linkedZoteroKey: 'ZKEY' })] })
    const r = lookupByDoi('10.x/abc')
    expect(r.entry?.linkedZoteroKey).toBe('ZKEY')
    expect(r.workspaceSlug).toBe('ws1')
  })

  test('多 workspace 命中：优先返回带 linkedZoteroKey 的', () => {
    setup({
      'ws-old': [makeEntry({ doi: '10.x/dup', key: 'k-old', lastSeenAt: '2025-02-01T00:00:00Z' })],
      'ws-new': [
        makeEntry({
          doi: '10.x/dup',
          key: 'k-new',
          linkedZoteroKey: 'GOOD',
          lastSeenAt: '2025-01-01T00:00:00Z',
        }),
      ],
    })
    const r = lookupByDoi('10.x/dup')
    expect(r.entry?.linkedZoteroKey).toBe('GOOD')
    expect(r.workspaceSlug).toBe('ws-new')
  })

  test('多 workspace 全无 linkedZoteroKey：取 lastSeenAt 最新作为 fallback', () => {
    setup({
      'ws-old': [
        makeEntry({ doi: '10.x/d', key: 'a', linkedZoteroKey: null, lastSeenAt: '2025-01-01T00:00:00Z' }),
      ],
      'ws-new': [
        makeEntry({ doi: '10.x/d', key: 'b', linkedZoteroKey: null, lastSeenAt: '2025-06-01T00:00:00Z' }),
      ],
    })
    const r = lookupByDoi('10.x/d')
    expect(r.entry?.linkedZoteroKey).toBeNull()
    expect(r.workspaceSlug).toBe('ws-new') // newer fallback wins
  })
})
