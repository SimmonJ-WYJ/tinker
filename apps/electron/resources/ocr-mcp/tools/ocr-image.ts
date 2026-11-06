/**
 * ocr_image: 对任意路径的图片文件做本机 OCR（PaddleOCR v5 mobile）
 *
 * 无 Zotero 依赖。任何图片绝对路径都能跑 —— Zotero 附件、工作区文件、
 * 用户截屏，都可先 resolve 到路径再调本工具。
 *
 * 缓存：{cacheRoot}/{sha256(absPath)}/{modelId}.json，mtime 守卫。
 * 可选关：enableCache=false 时每次重算。
 */

import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve, join } from 'node:path'
import { loadOnnxRuntime, type ComponentProgress } from '../../optional-runtime'
import { OcrEngine, OcrEngineError, type OcrLine } from '../ocr-engine.ts'
import { OcrCacheStore } from '../ocr-cache-store.ts'

export interface OcrImageInput {
  imagePath: string
  /** 默认 true；false 时跳过缓存读写 */
  enableCache?: boolean
}

export interface OcrImageOutput {
  text: string
  lines: OcrLine[]
  cached: boolean
  modelId: string
  durationMs: number
}

export class OcrImageToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly retryable?: boolean,
  ) {
    super(message)
    this.name = 'OcrImageToolError'
  }
}

/**
 * 常驻 OcrEngine 单例。
 * MCP 子进程生命期内第一次调用会懒加载 ~21MB 模型到内存，后续零开销复用。
 */
let engineInstance: OcrEngine | null = null
const getEngine = (): OcrEngine => {
  if (!engineInstance) {
    engineInstance = new OcrEngine(getModelsDir())
  }
  return engineInstance
}

/** 测试用：重置单例 */
export const __resetEngineForTest = (): void => {
  engineInstance = null
}

export async function handleOcrImage(input: OcrImageInput, onComponentProgress?: ComponentProgress): Promise<OcrImageOutput> {
  const { imagePath, enableCache = true } = input
  const absPath = resolve(imagePath)

  if (!existsSync(absPath)) {
    throw new OcrImageToolError(
      'IMAGE_NOT_FOUND',
      `图片文件不存在：${absPath}`,
    )
  }

  const stats = statSync(absPath)
  if (!stats.isFile()) {
    throw new OcrImageToolError(
      'IMAGE_NOT_FOUND',
      `路径不是文件：${absPath}`,
    )
  }
  const mtime = stats.mtimeMs

  const modelId = 'paddleocr-v5-mobile'
  const cacheStore = enableCache ? new OcrCacheStore(getCacheRoot()) : null

  if (cacheStore) {
    const hit = cacheStore.get(absPath, modelId, mtime)
    if (hit) {
      return {
        text: hit.text,
        lines: hit.lines,
        cached: true,
        modelId,
        durationMs: hit.durationMs,
      }
    }
  }

  let ocrResult
  try {
    await loadOnnxRuntime(onComponentProgress)
    ocrResult = await getEngine().recognize(absPath)
  } catch (err) {
    if (err instanceof OcrEngineError) {
      throw new OcrImageToolError(err.code, err.message, err.details)
    }
    throw err
  }

  if (cacheStore) {
    cacheStore.put({
      absPath,
      modelId,
      mtime,
      text: ocrResult.text,
      lines: ocrResult.lines,
      recognizedAt: Date.now(),
      durationMs: ocrResult.durationMs,
      sourceSize: stats.size,
    })
  }

  return {
    text: ocrResult.text,
    lines: ocrResult.lines,
    cached: false,
    modelId,
    durationMs: ocrResult.durationMs,
  }
}

export const ocrImageToolDefinition = {
  name: 'ocr_image',
  description:
    '本机 OCR 识别图片文字（PaddleOCR v5 mobile，离线、免费、支持中/英文印刷体）。'
    + '输入任意图片绝对路径，返回每行的文本、置信度、边界框坐标。'
    + '适合化验单、病历、票据、条码、屏幕截图等印刷体场景。'
    + '结果按 (sha256(绝对路径), 修改时间, 模型) 缓存；enableCache=false 可禁用缓存。'
    + '配合 zotero_get_attachment_path 可处理 Zotero 图片附件。',
  inputSchema: {
    type: 'object',
    properties: {
      imagePath: { type: 'string', description: '图片绝对路径（支持 PNG/JPEG/WebP/GIF）' },
      enableCache: { type: 'boolean', default: true },
    },
    required: ['imagePath'],
    additionalProperties: false,
  },
} as const

/** 模型目录默认 = resources/paddleocr/（bundled 或源码皆可） */
function getModelsDir(): string {
  if (process.env.ASCI_OCR_MODELS_DIR) return process.env.ASCI_OCR_MODELS_DIR
  const candidates = [
    join(__dirname, '..', 'paddleocr'),         // bundled: ocr-mcp/server.cjs → resources/paddleocr
    join(__dirname, '..', '..', 'paddleocr'),   // source/test: tools/ocr-image.ts → resources/paddleocr
  ]
  for (const c of candidates) {
    if (existsSync(join(c, 'det.onnx'))) return c
  }
  return candidates[0]
}

function getCacheRoot(): string {
  if (process.env.ASCI_OCR_CACHE_ROOT) return process.env.ASCI_OCR_CACHE_ROOT
  return join(homedir(), '.asci', 'cache', 'ocr')
}
