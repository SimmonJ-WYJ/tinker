import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 只测试 getMediaCacheStats / clearMediaCache（接受 cacheRoot 参数，不触碰 electron）；
// getDefaultMediaCacheRoot() 用了延迟 require('electron')，仅在 Electron 运行时环境下调用。
import { getMediaCacheStats, clearMediaCache } from './media-cache-admin.ts'

let tmpRoot: string

const seedEntry = (root: string, itemKey: string, attachmentKey: string, modelId: string, sizeBytes: number) => {
  const dir = join(root, itemKey, attachmentKey)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${modelId}.json`), 'x'.repeat(sizeBytes))
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'asci-media-admin-'))
})

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

test('空目录 → stats = (0, 0)', () => {
  const s = getMediaCacheStats(tmpRoot)
  expect(s).toEqual({ entryCount: 0, totalBytes: 0 })
})

test('不存在的目录 → stats = (0, 0)', () => {
  const s = getMediaCacheStats(join(tmpRoot, 'nope'))
  expect(s).toEqual({ entryCount: 0, totalBytes: 0 })
})

test('3 个条目 → stats 反映实际计数和总字节数', () => {
  seedEntry(tmpRoot, 'I1', 'A1', 'm1', 100)
  seedEntry(tmpRoot, 'I1', 'A2', 'm2', 200)
  seedEntry(tmpRoot, 'I2', 'A1', 'm1', 300)
  const s = getMediaCacheStats(tmpRoot)
  expect(s.entryCount).toBe(3)
  expect(s.totalBytes).toBe(600)
})

test('忽略 .tmp 文件', () => {
  seedEntry(tmpRoot, 'I1', 'A1', 'm1', 100)
  writeFileSync(join(tmpRoot, 'I1', 'A1', '.leftover.tmp'), 'xxx')
  const s = getMediaCacheStats(tmpRoot)
  expect(s.entryCount).toBe(1)
})

test('clearMediaCache 删除整个目录', () => {
  seedEntry(tmpRoot, 'I1', 'A1', 'm1', 100)
  expect(existsSync(join(tmpRoot, 'I1'))).toBe(true)
  const result = clearMediaCache(tmpRoot)
  expect(result.filesRemoved).toBe(1)
  expect(result.bytesFreed).toBe(100)
  expect(existsSync(tmpRoot)).toBe(false)
})

test('clearMediaCache 对不存在目录幂等', () => {
  const result = clearMediaCache(join(tmpRoot, 'nope'))
  expect(result).toEqual({ filesRemoved: 0, bytesFreed: 0 })
})
