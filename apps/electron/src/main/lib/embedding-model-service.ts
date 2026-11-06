/**
 * EmbeddingModelService — 嵌入模型权重下载 / 校验 / 存储管理
 *
 * 职责（与 AsrWeightsService 同构）：
 *   1. 从 HuggingFace（主源）/ hf-mirror.com（国内镜像兜底）拉 multilingual-e5-small 量化权重
 *   2. 三个文件逐个流式下载到 ~/.asci/models/{modelId}/
 *   3. 校验必需文件存在且大小匹配
 *   4. 暴露状态 + 进度事件，供 IPC 转发给渲染进程
 *
 * 状态机：missing → downloading → verifying → ready / error
 *
 * 与 ASR 的差异：
 *   - 多文件（无压缩包，无解压阶段）
 *   - 走 undici fetch + 用户代理设置（getEffectiveProxyUrl），主源失败自动切镜像
 *
 * 健壮性：
 *   - 下载中断（cancel / 网络断）→ 清理半成品目录，回到 missing/error
 *   - 重复 startDownload（进行中）→ 复用当前 promise
 *   - 单文件已存在且大小正确 → 跳过（断点续传到文件粒度）
 */

import { createWriteStream, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from 'undici'
import type {
  ZoteroEmbeddingModelProgress,
  ZoteroEmbeddingModelStatus,
} from '@asci/shared'
import { EMBEDDING_MODEL } from './zotero-embedding-index/embedder.ts'
import { getEmbeddingModelsDir } from './config-paths.ts'
import { getEffectiveProxyUrl } from './proxy-settings-service.ts'

/** 模型文件清单：repo 内路径 → 本地文件名 + 预期大小（进度与校验用） */
const MODEL_FILES = [
  { repoPath: 'onnx/model_quantized.onnx', localName: 'model_quantized.onnx', expectedBytes: 118_308_185 },
  { repoPath: 'tokenizer.json', localName: 'tokenizer.json', expectedBytes: 17_082_730 },
  { repoPath: 'tokenizer_config.json', localName: 'tokenizer_config.json', expectedBytes: 443 },
] as const

const TOTAL_EXPECTED_BYTES = MODEL_FILES.reduce((s, f) => s + f.expectedBytes, 0)

/** 下载源（按序尝试）：HF 主源 → 国内镜像 */
const SOURCES = [
  'https://huggingface.co/Xenova/multilingual-e5-small/resolve/main',
  'https://hf-mirror.com/Xenova/multilingual-e5-small/resolve/main',
] as const

/** 大小校验容差：HF 文件偶有 CDN 元数据差异，±1% 内视为有效 */
function sizeLooksValid(actual: number, expected: number): boolean {
  if (expected < 10_000) return actual > 0 // 小文件只查非空
  return Math.abs(actual - expected) / expected < 0.01
}

interface InternalState {
  state: ZoteroEmbeddingModelStatus['state']
  progress?: ZoteroEmbeddingModelProgress
  error?: string
}

export class EmbeddingModelService extends EventEmitter {
  private stateInternal: InternalState = { state: 'missing' }
  private downloadAbort: AbortController | null = null
  private currentDownloadPromise: Promise<void> | null = null

  constructor(private readonly rootDir: string = getEmbeddingModelsDir()) {
    super()
    this.refreshFromDisk()
  }

  /** 按磁盘状态刷新内部 state */
  refreshFromDisk(): void {
    this.stateInternal = this.filesReady() ? { state: 'ready' } : { state: 'missing' }
    this.emitStatus()
  }

  getStatus(): ZoteroEmbeddingModelStatus {
    return {
      modelId: EMBEDDING_MODEL.modelId,
      displayName: EMBEDDING_MODEL.displayName,
      state: this.stateInternal.state,
      progress: this.stateInternal.progress,
      error: this.stateInternal.error,
      modelPath: this.stateInternal.state === 'ready' ? this.modelDir() : undefined,
      expectedBytes: TOTAL_EXPECTED_BYTES,
    }
  }

  modelDir(): string {
    return join(this.rootDir, EMBEDDING_MODEL.modelId)
  }

  isReady(): boolean {
    return this.stateInternal.state === 'ready'
  }

  /** 触发下载（幂等：进行中则复用同一 promise；已就绪立即返回） */
  startDownload(): Promise<void> {
    if (this.stateInternal.state === 'ready') return Promise.resolve()
    if (this.currentDownloadPromise) return this.currentDownloadPromise
    this.currentDownloadPromise = this.runDownload().finally(() => {
      this.currentDownloadPromise = null
    })
    return this.currentDownloadPromise
  }

  /** 取消正在进行的下载 */
  cancel(): void {
    this.downloadAbort?.abort()
  }

  /** 删除模型目录（设置页"删除模型"用） */
  async delete(): Promise<void> {
    if (this.currentDownloadPromise) {
      this.cancel()
      try {
        await this.currentDownloadPromise
      } catch {
        // 取消引发的 reject 在此吞掉
      }
    }
    const dir = this.modelDir()
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
    this.refreshFromDisk()
  }

  // ===== 内部 =====

  private filesReady(): boolean {
    const dir = this.modelDir()
    return MODEL_FILES.every((f) => {
      const p = join(dir, f.localName)
      return existsSync(p) && sizeLooksValid(statSync(p).size, f.expectedBytes)
    })
  }

  private async runDownload(): Promise<void> {
    const ac = new AbortController()
    this.downloadAbort = ac
    const dir = this.modelDir()
    mkdirSync(dir, { recursive: true })

    const proxyUrl = await getEffectiveProxyUrl()
    const dispatcher: Dispatcher | undefined =
      proxyUrl && proxyUrl.trim() ? new ProxyAgent(proxyUrl.trim()) : undefined

    try {
      let bytesDoneBefore = 0
      for (const file of MODEL_FILES) {
        const dest = join(dir, file.localName)
        // 文件粒度断点：已存在且大小匹配则跳过
        if (existsSync(dest) && sizeLooksValid(statSync(dest).size, file.expectedBytes)) {
          bytesDoneBefore += file.expectedBytes
          continue
        }
        await this.downloadFileWithFallback(file, dest, bytesDoneBefore, dispatcher, ac.signal)
        bytesDoneBefore += file.expectedBytes
      }

      this.setState({ state: 'verifying' })
      if (!this.filesReady()) {
        throw new Error('下载完成但文件校验未通过（大小不符）')
      }
      this.setState({ state: 'ready' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const isAbort = ac.signal.aborted || /abort/i.test(message)
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

  /** 主源 → 镜像逐个尝试下载单个文件 */
  private async downloadFileWithFallback(
    file: (typeof MODEL_FILES)[number],
    dest: string,
    bytesDoneBefore: number,
    dispatcher: Dispatcher | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    let lastErr: unknown
    for (const base of SOURCES) {
      if (signal.aborted) throw new Error('下载已取消')
      try {
        await this.downloadFile(`${base}/${file.repoPath}`, file, dest, bytesDoneBefore, dispatcher, signal)
        return
      } catch (err) {
        lastErr = err
        if (signal.aborted) throw err
        console.warn(`[嵌入模型] 从 ${base} 下载 ${file.repoPath} 失败，尝试下一源：`, err)
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
  }

  /** 流式下载单文件 + 进度推送（undici fetch 自动跟随重定向） */
  private async downloadFile(
    url: string,
    file: (typeof MODEL_FILES)[number],
    dest: string,
    bytesDoneBefore: number,
    dispatcher: Dispatcher | undefined,
    signal: AbortSignal,
  ): Promise<void> {
    const tmp = `${dest}.downloading`
    const res = await undiciFetch(url, {
      signal,
      dispatcher,
      headers: { 'user-agent': 'ASCI-Desktop' },
    })
    if (!res.ok || !res.body) {
      throw new Error(`HTTP ${res.status} 拉 ${url} 失败`)
    }

    let fileDone = 0
    const startTs = Date.now()
    let lastReport = 0
    const reportProgress = () => {
      const now = Date.now()
      if (now - lastReport < 200) return // 节流：最多 5 次/秒
      lastReport = now
      const totalDone = bytesDoneBefore + fileDone
      const elapsed = (now - startTs) / 1000
      const speed = elapsed > 0 ? fileDone / elapsed : 0
      const remaining = TOTAL_EXPECTED_BYTES - totalDone
      this.setState({
        state: 'downloading',
        progress: {
          file: file.localName,
          bytesDone: totalDone,
          bytesTotal: TOTAL_EXPECTED_BYTES,
          etaSeconds: speed > 0 && remaining > 0 ? Math.round(remaining / speed) : undefined,
        },
      })
    }

    const counter = new Readable({ read() {} })
    const reader = res.body.getReader()
    const pump = async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          fileDone += value.byteLength
          reportProgress()
          counter.push(Buffer.from(value))
        }
        counter.push(null)
      } catch (err) {
        counter.destroy(err instanceof Error ? err : new Error(String(err)))
      }
    }
    void pump()
    await pipeline(counter, createWriteStream(tmp))

    // 原子落位
    rmSync(dest, { force: true })
    const { renameSync } = await import('node:fs')
    renameSync(tmp, dest)
  }

  private cleanupPartial(): void {
    const dir = this.modelDir()
    if (!existsSync(dir)) return
    for (const f of MODEL_FILES) {
      const tmp = join(dir, `${f.localName}.downloading`)
      if (existsSync(tmp)) {
        try {
          rmSync(tmp, { force: true })
        } catch {
          // 清理失败不阻塞
        }
      }
    }
  }

  private setState(next: InternalState): void {
    this.stateInternal = next
    this.emitStatus()
  }

  private emitStatus(): void {
    this.emit('status-changed', this.getStatus())
  }
}

/** 主进程单例（懒加载，避免 app 未 ready 时取配置目录） */
let singleton: EmbeddingModelService | null = null
export function getEmbeddingModelService(): EmbeddingModelService {
  if (!singleton) singleton = new EmbeddingModelService()
  return singleton
}
