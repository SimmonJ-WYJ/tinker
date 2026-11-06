/**
 * asr_audio: 对任意路径的音频文件做本机 ASR（sherpa-onnx + SenseVoice）
 *
 * 无 Zotero 依赖。任何音频绝对路径（MP3/AAC/FLAC/m4a/WAV/Opus…）都能跑。
 *
 * 缓存：{cacheRoot}/{sha256(absPath)}/{modelId}.json，mtime 守卫。
 * 可选关：enableCache=false 时每次重算。
 */

import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve, join } from 'node:path'
import { getFfmpegPath, loadSpeechRuntime, type ComponentProgress } from '../../optional-runtime'
import { AsrEngine, AsrEngineError, type AsrEngineOptions } from '../asr-engine.ts'
import { AsrCacheStore } from '../asr-cache-store.ts'

export interface AsrAudioInput {
  audioPath: string
  language?: 'zh' | 'en' | 'ja' | 'ko' | 'yue' | 'auto'
  /** 默认 true；false 时跳过缓存读写 */
  enableCache?: boolean
}

export interface AsrAudioOutput {
  text: string
  language?: string
  emotion?: string
  event?: string
  cached: boolean
  modelId: string
  durationMs: number
  audioDurationSeconds: number
}

export class AsrAudioToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly retryable?: boolean,
  ) {
    super(message)
    this.name = 'AsrAudioToolError'
  }
}

/**
 * 常驻 AsrEngine 单例：MCP 子进程生命期内第一次调用懒加载 ~228MB 模型，
 * 后续调用零开销复用。
 */
let engineInstance: AsrEngine | null = null
const getEngine = (): AsrEngine => {
  if (!engineInstance) {
    engineInstance = new AsrEngine(getModelDir())
  }
  return engineInstance
}

/** 测试用：重置单例 */
export const __resetEngineForTest = (): void => {
  engineInstance = null
}

export async function handleAsrAudio(
  input: AsrAudioInput,
  onProgress?: (done: number, total: number) => void | Promise<void>,
  onComponentProgress?: ComponentProgress,
): Promise<AsrAudioOutput> {
  const { audioPath, enableCache = true, language } = input
  const absPath = resolve(audioPath)

  if (!existsSync(absPath)) {
    throw new AsrAudioToolError('AUDIO_NOT_FOUND', `音频文件不存在：${absPath}`)
  }
  const stats = statSync(absPath)
  if (!stats.isFile()) {
    throw new AsrAudioToolError('AUDIO_NOT_FOUND', `路径不是文件：${absPath}`)
  }
  const mtime = stats.mtimeMs

  // 模型 id 需要知道，但只有 engine 内部写死了常量；这里硬编码同一值
  const modelId = 'sense-voice-zh-en-ja-ko-yue-2024-07-17'
  const cacheStore = enableCache ? new AsrCacheStore(getCacheRoot()) : null

  if (cacheStore) {
    const hit = cacheStore.get(absPath, modelId, mtime)
    if (hit) {
      return {
        text: hit.text,
        language: hit.language,
        emotion: hit.emotion,
        event: hit.event,
        cached: true,
        modelId,
        durationMs: hit.durationMs,
        audioDurationSeconds: hit.audioDurationSeconds,
      }
    }
  }

  let result
  try {
    await getFfmpegPath(onComponentProgress)
    await loadSpeechRuntime(onComponentProgress)
    const engineOptions: AsrEngineOptions = { language }
    result = await getEngine().recognize(absPath, engineOptions, onProgress)
  } catch (err) {
    if (err instanceof AsrEngineError) {
      throw new AsrAudioToolError(err.code, err.message, err.details, err.retryable)
    }
    throw err
  }

  if (cacheStore) {
    cacheStore.put({
      absPath,
      modelId,
      mtime,
      text: result.text,
      language: result.language,
      emotion: result.emotion,
      event: result.event,
      recognizedAt: Date.now(),
      durationMs: result.durationMs,
      audioDurationSeconds: result.audioDurationSeconds,
      sourceSize: stats.size,
    })
  }

  return {
    text: result.text,
    language: result.language,
    emotion: result.emotion,
    event: result.event,
    cached: false,
    modelId,
    durationMs: result.durationMs,
    audioDurationSeconds: result.audioDurationSeconds,
  }
}

export const asrAudioToolDefinition = {
  name: 'asr_audio',
  description:
    '本机 ASR 识别音频文字（sherpa-onnx + SenseVoice Small，离线、中/英/日/韩/粤）。'
    + '输入任意音频绝对路径（MP3/AAC/FLAC/m4a/WAV/Opus 等），内部先用 ffmpeg 解码为 16kHz mono PCM 再推理。'
    + '返回识别文本、语种、情绪、事件；按 (sha256(绝对路径), 修改时间, 模型) 缓存；'
    + 'enableCache=false 可禁用缓存。'
    + '配合 zotero_get_attachment_path 可处理 Zotero 音频附件。'
    + '若返回 MODEL_DOWNLOADING（retryable）说明权重正在后台下载，几分钟后重试即可；'
    + 'MODEL_MISSING 时请先启用 Zotero 集成或到设置→Zotero→ASR 模型手动下载。',
  inputSchema: {
    type: 'object',
    properties: {
      audioPath: { type: 'string', description: '音频绝对路径' },
      language: {
        type: 'string',
        enum: ['zh', 'en', 'ja', 'ko', 'yue', 'auto'],
        default: 'auto',
        description: '语种提示；默认 auto（模型自动识别）',
      },
      enableCache: { type: 'boolean', default: true },
    },
    required: ['audioPath'],
    additionalProperties: false,
  },
} as const

/** 模型目录：bundled / 源码均解析到 ~/.asci[-dev]/cache/asr-weights/<model> */
function getModelDir(): string {
  if (process.env.ASCI_ASR_MODEL_DIR) return process.env.ASCI_ASR_MODEL_DIR
  return join(homedir(), '.asci', 'cache', 'asr-weights', 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17')
}

function getCacheRoot(): string {
  if (process.env.ASCI_ASR_CACHE_ROOT) return process.env.ASCI_ASR_CACHE_ROOT
  return join(homedir(), '.asci', 'cache', 'asr')
}
