import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { handleOcrImage, __resetEngineForTest } from './ocr-image.ts'

let tmpDir: string

const makeTextImage = async (name: string, text: string): Promise<string> => {
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="120">
      <rect width="100%" height="100%" fill="white"/>
      <text x="20" y="80" font-family="Helvetica, Arial, sans-serif" font-size="48" fill="black">${text}</text>
    </svg>`,
  )
  const p = join(tmpDir, name)
  await sharp(svg).png().toFile(p)
  return p
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'asci-ocr-img-tool-'))
  process.env.ASCI_OCR_CACHE_ROOT = join(tmpDir, 'cache')
  __resetEngineForTest()
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  delete process.env.ASCI_OCR_CACHE_ROOT
})

test('首次调用识别图片 → cached=false，含 text/lines/modelId', async () => {
  const img = await makeTextImage('a.png', 'HELLO')
  const result = await handleOcrImage({ imagePath: img })
  expect(result.cached).toBe(false)
  expect(result.modelId).toBe('paddleocr-v5-mobile')
  expect(result.text.toLowerCase()).toContain('hello')
  expect(result.lines.length).toBeGreaterThan(0)
  expect(result.durationMs).toBeGreaterThanOrEqual(0)
}, 30_000)

test('第二次调用同路径 → 命中缓存，cached=true', async () => {
  const img = await makeTextImage('b.png', 'WORLD')
  const first = await handleOcrImage({ imagePath: img })
  const second = await handleOcrImage({ imagePath: img })
  expect(second.cached).toBe(true)
  expect(second.text).toBe(first.text)
}, 30_000)

test('enableCache=false → 强制重算，cached=false 两次', async () => {
  const img = await makeTextImage('c.png', 'RUN')
  const r1 = await handleOcrImage({ imagePath: img, enableCache: false })
  const r2 = await handleOcrImage({ imagePath: img, enableCache: false })
  expect(r1.cached).toBe(false)
  expect(r2.cached).toBe(false)
}, 30_000)

test('图片路径不存在 → IMAGE_NOT_FOUND', async () => {
  try {
    await handleOcrImage({ imagePath: join(tmpDir, 'nope.png') })
    throw new Error('不应走到这里')
  } catch (err) {
    expect(err).toHaveProperty('code', 'IMAGE_NOT_FOUND')
  }
})

test('路径是目录而非文件 → IMAGE_NOT_FOUND', async () => {
  mkdirSync(join(tmpDir, 'subdir'))
  try {
    await handleOcrImage({ imagePath: join(tmpDir, 'subdir') })
    throw new Error('不应走到这里')
  } catch (err) {
    expect(err).toHaveProperty('code', 'IMAGE_NOT_FOUND')
  }
})

test('非图片文件 → IMAGE_DECODE_FAILED', async () => {
  const p = join(tmpDir, 'fake.png')
  writeFileSync(p, 'NOT AN IMAGE')
  try {
    await handleOcrImage({ imagePath: p })
    throw new Error('不应走到这里')
  } catch (err) {
    expect(err).toHaveProperty('code', 'IMAGE_DECODE_FAILED')
  }
})
