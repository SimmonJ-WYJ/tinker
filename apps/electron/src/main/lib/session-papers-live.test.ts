/**
 * session-papers-live 读取器测试
 *
 * 覆盖：snake_case → camelCase 映射、缺字段安全默认、phase/verdict 归一、
 * TTL 过期残留返回 null、文件不存在返回 null、损坏 JSON 返回 null 不抛。
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSessionPapersLive } from './session-papers-live.ts'

let tmpHome: string
let originalHome: string | undefined
let originalDev: string | undefined
let papersDir: string

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'asci-papers-live-'))
  originalHome = process.env.ASCI_CONFIG_HOME
  originalDev = process.env.ASCI_DEV
  process.env.ASCI_CONFIG_HOME = tmpHome
  process.env.ASCI_DEV = ''
  papersDir = join(tmpHome, '.asci', 'agent-sessions-papers')
  mkdirSync(papersDir, { recursive: true })
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.ASCI_CONFIG_HOME
  else process.env.ASCI_CONFIG_HOME = originalHome
  if (originalDev === undefined) delete process.env.ASCI_DEV
  else process.env.ASCI_DEV = originalDev
  rmSync(tmpHome, { recursive: true, force: true })
})

function writeLive(sessionId: string, payload: Record<string, unknown>): void {
  writeFileSync(join(papersDir, `${sessionId}.live.json`), JSON.stringify(payload))
}

describe('readSessionPapersLive', () => {
  test('snake_case 映射 + 字段归一', () => {
    writeLive('s1', {
      schema_version: 1,
      session_id: 's1',
      turn_id: 'turn-x',
      phase: 'processing',
      updated_at: Date.now() / 1000,
      sources: {
        arxiv: { verdict: 'ok', count: 12 },
        openalex: { verdict: 'bogus-value', count: 'not-a-number' },
      },
      records: [{ title: 'T', url: 'https://x' }],
      raw_total: 13,
    })
    const live = readSessionPapersLive('s1')
    expect(live).not.toBeNull()
    expect(live!.turnId).toBe('turn-x')
    expect(live!.phase).toBe('processing')
    expect(live!.sources.arxiv).toEqual({ verdict: 'ok', count: 12 })
    // 非法 verdict / count 落安全默认
    expect(live!.sources.openalex).toEqual({ verdict: 'pending', count: 0 })
    expect(live!.records).toHaveLength(1)
    expect(live!.rawTotal).toBe(13)
  })

  test('未知 phase 按 searching 兜底', () => {
    writeLive('s2', { updated_at: Date.now() / 1000, phase: 'whatever' })
    expect(readSessionPapersLive('s2')!.phase).toBe('searching')
  })

  test('TTL 过期残留返回 null', () => {
    // 超过 LIVE_TTL_MS（30min，#775 后从 5min 上调以覆盖 scoring/reporting 长阶段）才算残留
    writeLive('s3', { updated_at: Date.now() / 1000 - 31 * 60, phase: 'searching' })
    expect(readSessionPapersLive('s3')).toBeNull()
  })

  test('文件不存在返回 null', () => {
    expect(readSessionPapersLive('nope')).toBeNull()
  })

  test('损坏 JSON 返回 null 不抛', () => {
    writeFileSync(join(papersDir, 's4.live.json'), '{broken')
    expect(readSessionPapersLive('s4')).toBeNull()
  })
})
