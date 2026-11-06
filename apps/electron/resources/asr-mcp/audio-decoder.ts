/**
 * AudioDecoder - 任意音频格式 → 16kHz mono Float32 PCM
 *
 * 调 ffmpeg-static 打包的 ffmpeg 二进制，把 MP3 / AAC / FLAC / m4a / Opus / WAV
 * 统一解码成 sherpa-onnx 需要的 { samples: Float32Array, sampleRate: 16000 }。
 */

import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { getFfmpegPath, type ComponentProgress } from '../optional-runtime'

export const ASR_SAMPLE_RATE = 16_000

export interface DecodedAudio {
  samples: Float32Array
  sampleRate: typeof ASR_SAMPLE_RATE
  /** 时长秒数 */
  durationSeconds: number
}

export type AudioDecoderErrorCode =
  | 'FFMPEG_MISSING'
  | 'AUDIO_NOT_FOUND'
  | 'AUDIO_DECODE_FAILED'

export class AudioDecoderError extends Error {
  constructor(
    readonly code: AudioDecoderErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'AudioDecoderError'
  }
}

/**
 * 把任意音频文件解码为 16kHz mono Float32 PCM。
 *
 * 用 `-f f32le -ac 1 -ar 16000` 走 stdout 原始 PCM。
 */
export async function decodeAudioTo16kMono(absPath: string, onComponentProgress?: ComponentProgress): Promise<DecodedAudio> {
  if (!existsSync(absPath)) {
    throw new AudioDecoderError('AUDIO_NOT_FOUND', `音频文件不存在：${absPath}`)
  }
  if (!statSync(absPath).isFile()) {
    throw new AudioDecoderError('AUDIO_NOT_FOUND', `路径不是文件：${absPath}`)
  }

  const ffmpegPath = await getFfmpegPath(onComponentProgress)
  if (!ffmpegPath) {
    throw new AudioDecoderError('FFMPEG_MISSING', 'ffmpeg-static 未安装或路径不可用')
  }
  // ffmpeg-static 通过 postinstall (install.js) 下载二进制；若 trustedDependencies 未包含
  // ffmpeg-static 或下载失败，路径会指向不存在的文件 → spawn ENOENT。这里前置检查给出
  // 比 "spawn ENOENT" 更可执行的错误信息。
  if (!existsSync(ffmpegPath)) {
    throw new AudioDecoderError(
      'FFMPEG_MISSING',
      `ffmpeg 二进制不存在：${ffmpegPath}（检查根 package.json 的 trustedDependencies 是否包含 "ffmpeg-static"，然后重新 bun install）`,
    )
  }

  return new Promise((resolve, reject) => {
    const ff = spawn(ffmpegPath as string, [
      '-loglevel', 'error',
      '-i', absPath,
      '-f', 'f32le',
      '-ac', '1',
      '-ar', String(ASR_SAMPLE_RATE),
      '-',
    ])

    const chunks: Buffer[] = []
    const stderrParts: string[] = []
    ff.stdout.on('data', (c: Buffer) => chunks.push(c))
    ff.stderr.on('data', (c: Buffer) => stderrParts.push(String(c)))

    ff.on('error', (err) => {
      reject(new AudioDecoderError('AUDIO_DECODE_FAILED', `ffmpeg spawn 失败：${err.message}`, err))
    })

    ff.on('close', (code) => {
      if (code !== 0) {
        return reject(new AudioDecoderError(
          'AUDIO_DECODE_FAILED',
          `ffmpeg 退出码 ${code}: ${stderrParts.join('').slice(0, 400)}`,
        ))
      }
      const buf = Buffer.concat(chunks)
      if (buf.length === 0) {
        return reject(new AudioDecoderError('AUDIO_DECODE_FAILED', 'ffmpeg 输出为空，音频可能损坏'))
      }
      const samples = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4)
      // 独立拷贝，避免底层 Buffer 被 GC 导致 Float32Array 错乱
      const copied = new Float32Array(samples)
      resolve({
        samples: copied,
        sampleRate: ASR_SAMPLE_RATE,
        durationSeconds: copied.length / ASR_SAMPLE_RATE,
      })
    })
  })
}
