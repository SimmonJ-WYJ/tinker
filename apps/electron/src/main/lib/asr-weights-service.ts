/**
 * AsrWeightsService — ASR 模型权重下载 / 解压 / 校验 / 存储管理
 *
 * 职责：
 *   1. 从 k2-fsa sherpa-onnx releases 拉 SenseVoice int8 模型 tar.bz2
 *   2. 边下边流解压到 ~/.asci/cache/asr-weights/{modelId}/
 *   3. 校验 model.int8.onnx + tokens.txt 存在
 *   4. 暴露状态 + 进度事件，供 IPC 转发给渲染进程
 *
 * 状态机：missing → downloading → extracting → verifying → ready
 *
 * 健壮性：
 *   - 下载中断（cancel / 网络断）→ 清理半成品目录，回到 missing/error
 *   - 重复 startDownload（正在进行中）→ 复用当前 promise
 *   - HTTP 5xx/ETIMEDOUT → 由上层重试决定，本服务只暴露 error
 */

import { createWriteStream, createReadStream, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { pipeline } from 'node:stream/promises'
import { request } from 'node:https'
import { URL } from 'node:url'
import unbzip2Stream from 'unbzip2-stream'
import * as tar from 'tar'
import type { AsrWeightProgress, AsrWeightStatus } from '@asci/shared'
import { nowMs } from '@asci/shared'
import { getAsrWeightsDir } from './config-paths'

/** 目前支持一个模型：SenseVoice Small（中英日韩粤） */
const SENSE_VOICE = {
  modelId: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17',
  displayName: 'SenseVoice Small（中/英/日/韩/粤，Alibaba）',
  sourceUrl:
    'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2',
  /** tar.bz2 估算大小（~1GB），仅供进度条显示 */
  expectedBytes: 1_047_870_769,
  /** 解压后必须存在的两个文件（相对于 model 根目录） */
  requiredFiles: ['model.int8.onnx', 'tokens.txt'] as const,
} as const

interface InternalState {
  state: AsrWeightStatus['state']
  progress?: AsrWeightProgress
  error?: string
}

export class AsrWeightsService extends EventEmitter {
  private stateInternal: InternalState = { state: 'missing' }
  private downloadAbort: AbortController | null = null
  private currentDownloadPromise: Promise<void> | null = null

  constructor(private readonly rootDir: string = getAsrWeightsDir()) {
    super()
    // 启动时就看一下本机已就绪否
    this.refreshFromDisk()
  }

  /** 按磁盘状态刷新内部 state（启动时或外部变更后调用） */
  refreshFromDisk(): void {
    const modelDir = this.modelDir()
    const ready = SENSE_VOICE.requiredFiles.every((f) => existsSync(join(modelDir, f)))
    this.stateInternal = ready
      ? { state: 'ready' }
      : { state: 'missing' }
    this.emitStatus()
  }

  getStatus(): AsrWeightStatus {
    return {
      modelId: SENSE_VOICE.modelId,
      displayName: SENSE_VOICE.displayName,
      sourceUrl: SENSE_VOICE.sourceUrl,
      expectedBytes: SENSE_VOICE.expectedBytes,
      state: this.stateInternal.state,
      progress: this.stateInternal.progress,
      error: this.stateInternal.error,
      modelPath: this.stateInternal.state === 'ready' ? this.modelDir() : undefined,
    }
  }

  modelDir(): string {
    return join(this.rootDir, SENSE_VOICE.modelId)
  }

  /**
   * 触发下载（幂等：已在进行中则返回同一 promise）。
   * 已就绪时立即返回。
   */
  startDownload(): Promise<void> {
    if (this.stateInternal.state === 'ready') return Promise.resolve()
    if (this.currentDownloadPromise) return this.currentDownloadPromise

    this.currentDownloadPromise = this.runDownload()
      .finally(() => { this.currentDownloadPromise = null })
    return this.currentDownloadPromise
  }

  /** 取消正在进行的下载 / 解压 */
  cancel(): void {
    this.downloadAbort?.abort()
  }

  /** 删除已就绪的模型目录 */
  async delete(): Promise<void> {
    if (this.currentDownloadPromise) {
      this.cancel()
      try { await this.currentDownloadPromise } catch {}
    }
    const dir = this.modelDir()
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    this.refreshFromDisk()
  }

  // ===== 内部：下载 + 流解压流水线 =====

  private async runDownload(): Promise<void> {
    const ac = new AbortController()
    this.downloadAbort = ac
    this.setState({ state: 'downloading', progress: { phase: 'download', bytesDone: 0, bytesTotal: SENSE_VOICE.expectedBytes } })

    try {
      mkdirSync(this.rootDir, { recursive: true })
      const tmpArchive = join(this.rootDir, `.${SENSE_VOICE.modelId}.tar.bz2.downloading`)

      // 1. 下载 tar.bz2 → tmp
      await this.downloadTo(SENSE_VOICE.sourceUrl, tmpArchive, ac.signal)
      if (ac.signal.aborted) throw new Error('下载已取消')

      // 2. 解压 tar.bz2 → rootDir；解压完成后 modelDir() 下会出现需要的文件
      this.setState({ state: 'extracting', progress: { phase: 'extract', bytesDone: 0, bytesTotal: statSync(tmpArchive).size } })
      await this.extract(tmpArchive, this.rootDir, ac.signal)
      if (ac.signal.aborted) throw new Error('解压已取消')

      // 3. 校验
      this.setState({ state: 'verifying' })
      const modelDir = this.modelDir()
      for (const f of SENSE_VOICE.requiredFiles) {
        if (!existsSync(join(modelDir, f))) {
          throw new Error(`解压后缺少关键文件：${f}`)
        }
      }

      // 4. 清理 tmp
      try { rmSync(tmpArchive, { force: true }) } catch {}

      this.setState({ state: 'ready' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const isAbort = ac.signal.aborted || /aborted|AbortError/i.test(message)
      // 取消 → 清掉半成品 + 回到 missing
      if (isAbort) {
        this.cleanupPartial()
        this.setState({ state: 'missing' })
      } else {
        this.setState({ state: 'error', error: message })
      }
      throw err
    } finally {
      this.downloadAbort = null
    }
  }

  private cleanupPartial(): void {
    const modelDir = this.modelDir()
    if (existsSync(modelDir)) {
      const hasAll = SENSE_VOICE.requiredFiles.every((f) => existsSync(join(modelDir, f)))
      if (!hasAll) rmSync(modelDir, { recursive: true, force: true })
    }
    const tmp = join(this.rootDir, `.${SENSE_VOICE.modelId}.tar.bz2.downloading`)
    if (existsSync(tmp)) { try { rmSync(tmp, { force: true }) } catch {} }
  }

  /** 流式下载 URL 到本地文件，定期推进度。跟随 302/301 重定向。 */
  private downloadTo(urlStr: string, dest: string, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const visit = (target: string, redirectsLeft: number) => {
        const url = new URL(target)
        const req = request({
          method: 'GET',
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || 443,
          path: `${url.pathname}${url.search}`,
          signal,
          headers: { 'user-agent': 'ASCI-Desktop' },
        }, (res) => {
          // 跟随 301/302/303/307/308
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            if (redirectsLeft <= 0) return reject(new Error('重定向过多'))
            res.resume()
            return visit(new URL(res.headers.location, target).toString(), redirectsLeft - 1)
          }
          if (res.statusCode !== 200) {
            res.resume()
            return reject(new Error(`HTTP ${res.statusCode} 拉 ${target} 失败`))
          }
          const bytesTotal = Number(res.headers['content-length']) || SENSE_VOICE.expectedBytes
          let bytesDone = 0
          const startTs = nowMs()
          let lastReport = 0
          res.on('data', (chunk: Buffer) => {
            bytesDone += chunk.length
            const now = nowMs()
            if (now - lastReport >= 200) { // 节流：最多 5 次/秒
              lastReport = now
              const elapsed = (now - startTs) / 1000
              const speed = elapsed > 0 ? bytesDone / elapsed : 0
              const eta = speed > 0 && bytesTotal > bytesDone ? Math.round((bytesTotal - bytesDone) / speed) : undefined
              this.setState({
                state: 'downloading',
                progress: { phase: 'download', bytesDone, bytesTotal, etaSeconds: eta },
              })
            }
          })
          const out = createWriteStream(dest)
          pipeline(res, out)
            .then(() => {
              this.setState({
                state: 'downloading',
                progress: { phase: 'download', bytesDone, bytesTotal, etaSeconds: 0 },
              })
              resolve()
            })
            .catch(reject)
        })
        req.on('error', reject)
        req.end()
      }
      visit(urlStr, 5)
    })
  }

  /** 流式解压 tar.bz2 到目标目录 */
  private async extract(archive: string, destDir: string, signal: AbortSignal): Promise<void> {
    const totalBytes = statSync(archive).size
    let bytesDone = 0
    let lastReport = 0

    const src = createReadStream(archive)
    const cleanupAbort = () => src.destroy(new Error('解压已取消'))
    if (signal.aborted) cleanupAbort()
    else signal.addEventListener('abort', cleanupAbort, { once: true })

    src.on('data', (chunk: string | Buffer) => {
      bytesDone += chunk.length
      const now = nowMs()
      if (now - lastReport >= 200) {
        lastReport = now
        this.setState({
          state: 'extracting',
          progress: { phase: 'extract', bytesDone, bytesTotal: totalBytes },
        })
      }
    })

    // pipeline: tarball → unbzip2 → tar extract
    await pipeline(
      src,
      unbzip2Stream(),
      tar.x({ cwd: destDir }),
    )
  }

  private setState(patch: Partial<InternalState>): void {
    this.stateInternal = { ...this.stateInternal, ...patch }
    // 清掉上次的 error / progress，如果本次未指定
    if (patch.state && patch.state !== 'error' && !('error' in patch)) {
      delete this.stateInternal.error
    }
    if (patch.state === 'ready' || patch.state === 'missing') {
      delete this.stateInternal.progress
    }
    this.emitStatus()
  }

  private emitStatus(): void {
    this.emit('status', this.getStatus())
  }
}

/** 单例（按模块生命期复用） */
let instance: AsrWeightsService | null = null
export function getAsrWeightsService(): AsrWeightsService {
  if (!instance) instance = new AsrWeightsService()
  return instance
}
