import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OcrCacheStore, type OcrCacheEntry } from './ocr-cache-store.ts'

let root: string
let store: OcrCacheStore

const makeEntry = (overrides: Partial<OcrCacheEntry> = {}): OcrCacheEntry => ({
  absPath: '/tmp/whatever/image.jpg',
  modelId: 'paddleocr-v5-mobile',
  mtime: 1000000,
  text: '识别结果',
  lines: [{ text: '识别结果', confidence: 0.99, bbox: { x: 0, y: 0, width: 100, height: 30 } }],
  recognizedAt: Date.now(),
  durationMs: 250,
  sourceSize: 42,
  ...overrides,
})

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'asci-ocr-cache-'))
  store = new OcrCacheStore(root)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

test('get 不存在条目 → null', () => {
  expect(store.get('/never/seen.png', 'paddleocr-v5-mobile', 0)).toBeNull()
})

test('put 后 get 命中（相同 mtime）', () => {
  const e = makeEntry()
  store.put(e)
  const hit = store.get(e.absPath, e.modelId, e.mtime)
  expect(hit).toEqual(e)
})

test('mtime 不同 → miss，并删除旧条目', () => {
  const e = makeEntry({ mtime: 1000 })
  store.put(e)
  expect(store.get(e.absPath, e.modelId, 1000)).not.toBeNull()
  expect(store.get(e.absPath, e.modelId, 2000)).toBeNull()
  expect(store.get(e.absPath, e.modelId, 1000)).toBeNull() // 旧条目已删
})

test('不同 path 互不干扰（哈希隔离）', () => {
  store.put(makeEntry({ absPath: '/a.png', text: 'A' }))
  store.put(makeEntry({ absPath: '/b.png', text: 'B' }))
  expect(store.get('/a.png', 'paddleocr-v5-mobile', 1000000)?.text).toBe('A')
  expect(store.get('/b.png', 'paddleocr-v5-mobile', 1000000)?.text).toBe('B')
})

test('不同 modelId 互不干扰', () => {
  store.put(makeEntry({ modelId: 'paddleocr-v5-mobile', text: 'P' }))
  store.put(makeEntry({ modelId: 'tesseract', text: 'T' }))
  expect(store.get('/tmp/whatever/image.jpg', 'paddleocr-v5-mobile', 1000000)?.text).toBe('P')
  expect(store.get('/tmp/whatever/image.jpg', 'tesseract', 1000000)?.text).toBe('T')
})

test('clearAll 清空所有缓存并返回统计', () => {
  store.put(makeEntry({ absPath: '/a.png' }))
  store.put(makeEntry({ absPath: '/b.png' }))
  const res = store.clearAll()
  expect(res.filesRemoved).toBe(2)
  expect(store.stats()).toEqual({ entryCount: 0, totalBytes: 0 })
})

test('stats 反映当前条目数 + 总字节', () => {
  store.put(makeEntry({ absPath: '/a.png' }))
  store.put(makeEntry({ absPath: '/b.png' }))
  const s = store.stats()
  expect(s.entryCount).toBe(2)
  expect(s.totalBytes).toBeGreaterThan(0)
})

test('读到损坏 json → 返 null 并自愈', () => {
  const e = makeEntry()
  store.put(e)
  // 定位到实际文件，写脏数据
  const result = store.get(e.absPath, e.modelId, e.mtime)
  expect(result).not.toBeNull()

  // 手动找到缓存文件并破坏
  const hash = require('node:crypto').createHash('sha256').update(e.absPath).digest('hex')
  const corruptPath = join(root, hash, `${e.modelId}.json`)
  writeFileSync(corruptPath, 'NOT JSON')
  expect(store.get(e.absPath, e.modelId, e.mtime)).toBeNull()
  expect(existsSync(corruptPath)).toBe(false)
})

test('原子写：中间 tmp 文件不会影响正常读取', () => {
  const e = makeEntry({ text: 'V1' })
  store.put(e)
  // 在目录下放个 .tmp 文件
  const hash = require('node:crypto').createHash('sha256').update(e.absPath).digest('hex')
  const dir = join(root, hash)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, '.leftover.tmp'), 'corrupt')
  expect(store.get(e.absPath, e.modelId, e.mtime)?.text).toBe('V1')
})
