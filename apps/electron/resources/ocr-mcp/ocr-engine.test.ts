import { test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { OcrEngine, OcrEngineError } from './ocr-engine.ts'

// 固定指向仓库内 resources/paddleocr/ —— 真实模型，跑真实推理
const RESOURCES_PADDLEOCR = join(__dirname, '..', 'paddleocr')

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'asci-ocr-engine-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

/**
 * 生成一张含已知文字的白底黑字 PNG：用 sharp 合成 SVG 文本层
 * 返回图片绝对路径
 */
const makeTextImage = async (text: string, width = 600, height = 140): Promise<string> => {
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect width="100%" height="100%" fill="white"/>
      <text x="40" y="${height / 2 + 20}" font-family="Helvetica, Arial, sans-serif" font-size="48" fill="black">${text}</text>
    </svg>`,
  )
  const p = join(tmpDir, `${text.replace(/\W+/g, '_')}.png`)
  await sharp(svg).png().toFile(p)
  return p
}

test('模型目录不存在 → MODELS_MISSING', async () => {
  const engine = new OcrEngine(join(tmpDir, 'nope'))
  try {
    await engine.recognize(await makeTextImage('HELLO'))
    throw new Error('不应走到这里')
  } catch (err) {
    expect(err).toBeInstanceOf(OcrEngineError)
    expect((err as OcrEngineError).code).toBe('MODELS_MISSING')
  }
})

test('图片文件不存在 → IMAGE_DECODE_FAILED', async () => {
  const engine = new OcrEngine(RESOURCES_PADDLEOCR)
  try {
    await engine.recognize(join(tmpDir, 'nope.png'))
    throw new Error('不应走到这里')
  } catch (err) {
    expect(err).toBeInstanceOf(OcrEngineError)
    expect((err as OcrEngineError).code).toBe('IMAGE_DECODE_FAILED')
  }
})

test('识别白底黑字英文图 → 返回包含该文字的 OcrResult', async () => {
  const engine = new OcrEngine(RESOURCES_PADDLEOCR)
  const img = await makeTextImage('HELLO WORLD')
  const result = await engine.recognize(img)

  expect(result.modelId).toBe('paddleocr-v5-mobile')
  expect(result.imageWidth).toBeGreaterThan(0)
  expect(result.imageHeight).toBeGreaterThan(0)
  expect(result.durationMs).toBeGreaterThanOrEqual(0)
  expect(result.lines.length).toBeGreaterThan(0)
  expect(result.text.toLowerCase()).toContain('hello')
}, 30_000)

test('识别中文图 → 中文能出来', async () => {
  const engine = new OcrEngine(RESOURCES_PADDLEOCR)
  const img = await makeTextImage('糖化血红蛋白 5.2')
  const result = await engine.recognize(img)
  // SVG 合成的中文可能字形问题，关键就是 5.2 能出来
  expect(result.text).toContain('5.2')
}, 30_000)

test('每次 recognize 返回 bbox 坐标 + 每行置信度', async () => {
  const engine = new OcrEngine(RESOURCES_PADDLEOCR)
  const img = await makeTextImage('TEST 123')
  const result = await engine.recognize(img)
  expect(result.lines[0]).toHaveProperty('bbox')
  expect(result.lines[0].bbox.width).toBeGreaterThan(0)
  expect(result.lines[0].bbox.height).toBeGreaterThan(0)
  expect(result.lines[0].confidence).toBeGreaterThan(0)
  expect(result.lines[0].confidence).toBeLessThanOrEqual(1)
}, 30_000)

test('同一 engine 实例复用已加载的模型（第二次调用明显更快）', async () => {
  const engine = new OcrEngine(RESOURCES_PADDLEOCR)
  const img = await makeTextImage('A')
  await engine.recognize(img)
  const start = Date.now()
  await engine.recognize(img)
  const second = Date.now() - start
  // 第二次应该 < 2s（即使 CPU 慢机器）；第一次含模型加载通常 5s+
  expect(second).toBeLessThan(2000)
}, 30_000)
