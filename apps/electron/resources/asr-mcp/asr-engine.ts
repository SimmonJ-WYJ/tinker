/**
 * AsrEngine - 基于 sherpa-onnx-node + SenseVoice 的本机 ASR 引擎
 *
 * 全本机推理，无渠道依赖。模型位于：
 *   ~/.asci/cache/asr-weights/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/
 *     - model.int8.onnx   ~228MB
 *     - tokens.txt        ~308KB
 *
 * 单例模式：一个 MCP 子进程生命期内常驻一个 AsrEngine 实例，
 * 第一次 recognize() 时懒加载模型到内存（~秒级），后续调用复用。
 */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
// 延迟 import sherpa-onnx-node：模块 require 时会初始化原生桩，成本高
import type sherpaOnnxModule from 'sherpa-onnx-node'
import { loadSpeechRuntime } from '../optional-runtime'
import { decodeAudioTo16kMono, AudioDecoderError, ASR_SAMPLE_RATE } from './audio-decoder.ts'

export interface AsrResult {
  /** SenseVoice 返回的完整识别文本（已做简单标点恢复） */
  text: string
  /** SenseVoice 额外返回的字段：语种 / 情绪 / 事件 */
  language?: string
  emotion?: string
  event?: string
  /** 模型 id，恒定 'sense-voice-zh-en-ja-ko-yue-2024-07-17' */
  modelId: string
  /** ASR 推理耗时（不含解码、不含加载） */
  durationMs: number
  /** 音频时长（秒） */
  audioDurationSeconds: number
}

export type AsrEngineErrorCode =
  | 'MODEL_MISSING'
  | 'MODEL_DOWNLOADING'
  | 'AUDIO_DECODE_FAILED'
  | 'AUDIO_NOT_FOUND'
  | 'FFMPEG_MISSING'
  | 'ASR_FAILED'

export class AsrEngineError extends Error {
  constructor(
    readonly code: AsrEngineErrorCode,
    message: string,
    readonly details?: unknown,
    readonly retryable?: boolean,
  ) {
    super(message)
    this.name = 'AsrEngineError'
  }
}

const MODEL_ID = 'sense-voice-zh-en-ja-ko-yue-2024-07-17'

export interface AsrEngineOptions {
  /** 语言提示（zh/en/ja/ko/yue）；默认 'auto' */
  language?: 'zh' | 'en' | 'ja' | 'ko' | 'yue' | 'auto'
  /** 是否开启逆文本规范化（把"五十二"转成"52"等） */
  useItn?: boolean
  /** 线程数（默认 4） */
  numThreads?: number
}

export class AsrEngine {
  private recognizerPromise: Promise<ReturnType<typeof sherpaOnnxModule.OfflineRecognizer['fromAsync']> extends Promise<infer R> ? R : never> | null = null

  constructor(private readonly modelDir: string) {}

  private async loadRecognizer() {
    if (this.recognizerPromise) return this.recognizerPromise

    this.recognizerPromise = (async () => {
      const modelPath = join(this.modelDir, 'model.int8.onnx')
      const tokensPath = join(this.modelDir, 'tokens.txt')
      if (!existsSync(modelPath) || !existsSync(tokensPath)) {
        // 兄弟目录有 .<modelId>.tar.bz2.downloading → 主进程正在下载
        // 同 modelDir 父目录命名约定（asr-weights-service.ts:123）
        const parentDir = dirname(this.modelDir)
        const downloadingMarker = `.${this.modelDir.split('/').pop()}.tar.bz2.downloading`
        const isDownloading = existsSync(join(parentDir, downloadingMarker))
        if (isDownloading) {
          throw new AsrEngineError(
            'MODEL_DOWNLOADING',
            `ASR 模型正在后台下载（首次启用时自动触发，约 1GB）。请在 ASCI 设置→Zotero→音频识别（ASR）模型查看进度，下载完成后重试本调用即可。`,
            undefined,
            true,
          )
        }
        throw new AsrEngineError(
          'MODEL_MISSING',
          `ASR 模型文件缺失：${this.modelDir}（需要 model.int8.onnx + tokens.txt）。`
          + '请在 ASCI 中启用 Zotero 集成（设置→Zotero）触发自动下载，或到"设置→Zotero→音频识别（ASR）模型"手动下载。',
        )
      }

      // 运行时 require，避免模块顶层加载原生桩
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sherpa = await loadSpeechRuntime() as typeof sherpaOnnxModule
      return new sherpa.OfflineRecognizer({
        modelConfig: {
          senseVoice: {
            model: modelPath,
            useInverseTextNormalization: 1,
            language: 'auto',
          },
          tokens: tokensPath,
          numThreads: 4,
          debug: 0,
        },
      })
    })().catch(err => { this.recognizerPromise = null; throw err })

    return this.recognizerPromise
  }

  /**
   * 识别音频并返回完整文本。
   *
   * 长音频会被切成 ~28s 窗口分段识别（SenseVoice 模型对 ≤30s 窗口效果最好），
   * 分段结果按时间顺序用 \n 拼接；每块识别完触发 onProgress(done, total)。
   */
  async recognize(
    audioPath: string,
    options: AsrEngineOptions = {},
    onProgress?: (done: number, total: number) => void | Promise<void>,
  ): Promise<AsrResult> {
    // 1. 解码音频 → 16kHz mono PCM
    let decoded
    try {
      decoded = await decodeAudioTo16kMono(audioPath)
    } catch (err) {
      if (err instanceof AudioDecoderError) {
        throw new AsrEngineError(err.code, err.message, err.details)
      }
      throw err
    }

    // 2. 加载识别器（单例懒加载）
    const recognizer = await this.loadRecognizer()

    // 3. 切窗 → 逐块推理 → 拼文本
    const chunks = chunkSamples(decoded.samples, ASR_SAMPLE_RATE)
    const total = chunks.length
    const texts: string[] = []
    let firstLang: string | undefined
    let firstEmotion: string | undefined
    let firstEvent: string | undefined
    const start = Date.now()

    for (let i = 0; i < total; i += 1) {
      const chunk = chunks[i]!
      try {
        const stream = recognizer.createStream()
        if (options.language && options.language !== 'auto') {
          stream.setOption('language', options.language)
        }
        stream.acceptWaveform({ samples: chunk, sampleRate: ASR_SAMPLE_RATE })
        recognizer.decode(stream)
        const raw = recognizer.getResult(stream) as {
          text: string
          lang?: string
          emotion?: string
          event?: string
        }
        if (raw.text) texts.push(raw.text.trim())
        // 取第一块的元信息（整段大概率是同一语种）
        if (i === 0) {
          firstLang = raw.lang
          firstEmotion = raw.emotion
          firstEvent = raw.event
        }
      } catch (err) {
        throw new AsrEngineError(
          'ASR_FAILED',
          `sherpa-onnx 第 ${i + 1}/${total} 段推理失败：${err instanceof Error ? err.message : String(err)}`,
          err,
        )
      }
      if (onProgress) {
        try { await onProgress(i + 1, total) } catch { /* 进度通知失败不阻断识别 */ }
      }
    }

    const durationMs = Date.now() - start

    return {
      text: texts.filter(Boolean).join('\n'),
      language: stripTag(firstLang),
      emotion: stripTag(firstEmotion),
      event: stripTag(firstEvent),
      modelId: MODEL_ID,
      durationMs,
      audioDurationSeconds: decoded.durationSeconds,
    }
  }
}

/** 每块 28s，不重叠；最后一块可短 */
const CHUNK_SECONDS = 28

export function chunkSamples(samples: Float32Array, sampleRate: number): Float32Array[] {
  const chunkSize = CHUNK_SECONDS * sampleRate
  if (samples.length <= chunkSize) return [samples]
  const chunks: Float32Array[] = []
  for (let offset = 0; offset < samples.length; offset += chunkSize) {
    chunks.push(samples.subarray(offset, Math.min(offset + chunkSize, samples.length)))
  }
  return chunks
}

/** SenseVoice 输出里元信息形如 <|zh|> / <|EMO_UNKNOWN|> / <|Speech|>，去掉 <| |> 包装 */
function stripTag(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const m = raw.match(/^<\|(.+?)\|>$/)
  return m ? m[1] : raw
}
