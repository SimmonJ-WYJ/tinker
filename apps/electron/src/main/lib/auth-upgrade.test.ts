// apps/electron/src/main/lib/auth-upgrade.test.ts
import { test, expect, describe, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { scanLocalData, writeOwnerMarker, readOwnerMarker } from './auth-upgrade.ts'

let base: string

beforeEach(() => {
  base = mkdtempSync(path.join(tmpdir(), 'asci-upgrade-'))
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

describe('scanLocalData', () => {
  test('空目录 → hasLocalData=false', async () => {
    const r = await scanLocalData(base)
    expect(r.hasLocalData).toBe(false)
    expect(r.counts).toEqual({ papers: 0, notes: 0, evidenceSets: 0 })
  })

  test('计数 papers / notes / evidence-sets', async () => {
    mkdirSync(path.join(base, 'papers'), { recursive: true })
    mkdirSync(path.join(base, 'notes'), { recursive: true })
    mkdirSync(path.join(base, 'evidence-sets'), { recursive: true })
    writeFileSync(path.join(base, 'papers', 'p1.json'), '{}')
    writeFileSync(path.join(base, 'papers', 'p2.json'), '{}')
    writeFileSync(path.join(base, 'notes', 'n1.json'), '{}')
    writeFileSync(path.join(base, 'evidence-sets', 'es1.json'), '{}')
    const r = await scanLocalData(base)
    expect(r.hasLocalData).toBe(true)
    expect(r.counts).toEqual({ papers: 2, notes: 1, evidenceSets: 1 })
  })

  test('owner.json 不存在 → attributedTo null', async () => {
    const r = await scanLocalData(base)
    expect(r.attributedTo).toBeNull()
  })

  test('owner.json 存在 → attributedTo 是 uid', async () => {
    writeFileSync(
      path.join(base, 'owner.json'),
      JSON.stringify({ uid: 'alice-uid', attributedAt: '2026-01-01T00:00:00Z' }),
    )
    const r = await scanLocalData(base)
    expect(r.attributedTo).toBe('alice-uid')
  })

  test('owner.json 损坏 → attributedTo null（不抛）', async () => {
    writeFileSync(path.join(base, 'owner.json'), 'not json')
    const r = await scanLocalData(base)
    expect(r.attributedTo).toBeNull()
  })
})

describe('owner.json read/write', () => {
  test('write 后 read 一致', async () => {
    await writeOwnerMarker(base, {
      uid: 'u1',
      attributedAt: '2026-05-28T00:00:00Z',
      attributedFrom: 'upgrade-notice',
      snapshot: { papers: 10, notes: 5, evidenceSets: 2 },
    })
    const r = await readOwnerMarker(base)
    expect(r?.uid).toBe('u1')
    expect(r?.snapshot.papers).toBe(10)
  })
})
