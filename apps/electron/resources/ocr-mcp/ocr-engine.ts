/**
 * OcrEngine — 基于 PaddleOCR v5 mobile + ONNX Runtime 的本机 OCR 引擎
 *
 * 全本机推理，无渠道依赖。模型放 apps/electron/resources/paddleocr/：
 *   - det.onnx (~4.6MB)  文本检测
 *   - rec.onnx (~16MB)   文本识别
 *   - dict.txt (~200KB)  字符字典
 *
 * 使用模式：一个 MCP 子进程生命期内常驻一个 OcrEngine 实例，
 * 第一次 recognize() 时懒加载模型到内存（~70ms），后续调用复用。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadOnnxRuntime, type ComponentProgress } from '../optional-runtime'
import { PaddleOcrService } from 'paddleocr'
import sharp from 'sharp'

export interface OcrLineBBox {
  x: number
  y: number
  width: number
  height: number
}

export interface OcrLine {
  text: string
  confidence: number
  bbox: OcrLineBBox
}

export interface OcrResult {
  /** 按阅读顺序拼接好的完整文本（行间 \n 分隔） */
  text: string
  /** 每个文本块独立信息（带坐标 + 置信度） */
  lines: OcrLine[]
  /** 恒定 'paddleocr-v5-mobile'，用作缓存 key */
  modelId: string
  /** OCR 推理耗时，不含模型加载 */
  durationMs: number
  imageWidth: number
  imageHeight: number
}

export type OcrEngineErrorCode =
  | 'MODELS_MISSING'
  | 'IMAGE_DECODE_FAILED'
  | 'OCR_FAILED'

export class OcrEngineError extends Error {
  constructor(
    readonly code: OcrEngineErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'OcrEngineError'
  }
}

const MODEL_ID = 'paddleocr-v5-mobile'

export class OcrEngine {
  private servicePromise: Promise<PaddleOcrService> | null = null

  constructor(private readonly modelsDir: string, private readonly onComponentProgress?: ComponentProgress) {}

  /** 懒加载 PaddleOCR 服务。同一实例多次调用只加载一次。 */
  private loadService(): Promise<PaddleOcrService> {
    if (this.servicePromise) return this.servicePromise

    this.servicePromise = (async () => {
      const ort = await loadOnnxRuntime(this.onComponentProgress)
      const detPath = join(this.modelsDir, 'det.onnx')
      const recPath = join(this.modelsDir, 'rec.onnx')
      const dictPath = join(this.modelsDir, 'dict.txt')

      let detBuf: ArrayBuffer
      let recBuf: ArrayBuffer
      let dict: string[]
      try {
        detBuf = toArrayBuffer(readFileSync(detPath))
        recBuf = toArrayBuffer(readFileSync(recPath))
        dict = readFileSync(dictPath, 'utf-8').split('\n')
      } catch (err) {
        throw new OcrEngineError(
          'MODELS_MISSING',
          `PaddleOCR 模型文件缺失或不可读：${this.modelsDir}（需要 det.onnx / rec.onnx / dict.txt）`,
          err,
        )
      }

      return PaddleOcrService.createInstance({
        ort: ort as unknown as Parameters<typeof PaddleOcrService.createInstance>[0]['ort'],
        detection: { modelBuffer: detBuf },
        recognition: { modelBuffer: recBuf, charactersDictionary: dict },
      })
    })().catch(err => { this.servicePromise = null; throw err })

    return this.servicePromise
  }

  /** 识别图片。返回所有检测到的文本块（含坐标 + 置信度） */
  async recognize(imagePath: string): Promise<OcrResult> {
    const service = await this.loadService()

    let decoded: { data: Buffer; info: sharp.OutputInfo }
    try {
      decoded = await sharp(imagePath).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    } catch (err) {
      throw new OcrEngineError(
        'IMAGE_DECODE_FAILED',
        `图片解码失败：${imagePath}`,
        err,
      )
    }

    const start = Date.now()
    let rawLines: Awaited<ReturnType<PaddleOcrService['recognize']>>
    try {
      rawLines = await service.recognize({
        data: new Uint8Array(decoded.data),
        width: decoded.info.width,
        height: decoded.info.height,
      })
    } catch (err) {
      throw new OcrEngineError('OCR_FAILED', 'PaddleOCR 推理失败', err)
    }
    const durationMs = Date.now() - start

    const lines: OcrLine[] = rawLines.map((r) => ({
      text: r.text,
      confidence: r.confidence,
      bbox: { x: r.box.x, y: r.box.y, width: r.box.width, height: r.box.height },
    }))

    return {
      text: lines.map((l) => l.text).join('\n'),
      lines,
      modelId: MODEL_ID,
      durationMs,
      imageWidth: decoded.info.width,
      imageHeight: decoded.info.height,
    }
  }
}

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}
