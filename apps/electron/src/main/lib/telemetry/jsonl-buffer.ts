/**
 * 本地 JSONL 缓冲（ADR-011）
 *
 * 遥测事件 / 自进化信号的本地落盘出口：
 *   - dev 门控下这是唯一出口（不发真实网络）
 *   - prod 下作为上报失败的回落与自进化端点未就绪时的缓冲
 *
 * 追加型写入（CLAUDE.md「追加型日志走 JSONL」）；单文件超上限轮转
 * （events.jsonl → events.1.jsonl → events.2.jsonl，最多 N 个，超出删最旧），
 * 防止无界增长。同步 I/O（主进程服务惯例，写入频率低、单条小）。
 */
import { appendFileSync, existsSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { getTelemetryDir } from '../config-paths.ts'

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024 // 5MB
const DEFAULT_MAX_ROTATIONS = 2 // 主文件 + 2 个轮转 ≈ 总上限 15MB

export interface JsonlBufferOptions {
  maxBytes?: number
  maxRotations?: number
}

export class JsonlBuffer {
  private readonly filePath: string
  private readonly maxBytes: number
  private readonly maxRotations: number
  /** 主文件当前字节数的内存追踪（首次惰性 stat，之后随写入累加，免每条 stat） */
  private currentBytes: number | undefined

  /**
   * @param fileName 缓冲文件名（如 'events.jsonl'），落 ~/.asci/telemetry/ 下
   */
  constructor(fileName: string, options?: JsonlBufferOptions) {
    this.filePath = join(getTelemetryDir(), fileName)
    this.maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES
    this.maxRotations = options?.maxRotations ?? DEFAULT_MAX_ROTATIONS
  }

  /** 追加一条记录；写入失败静默吞掉（遥测绝不影响主功能） */
  append(record: unknown): void {
    try {
      this.rotateIfNeeded()
      const line = `${JSON.stringify(record)}\n`
      appendFileSync(this.filePath, line, 'utf-8')
      this.currentBytes = (this.currentBytes ?? 0) + Buffer.byteLength(line, 'utf-8')
    } catch (err) {
      console.warn(`[遥测] JSONL 写入失败（忽略）: ${this.filePath}`, err)
    }
  }

  /** 当前主文件路径（测试与手动验收用） */
  get path(): string {
    return this.filePath
  }

  private rotateIfNeeded(): void {
    if (this.currentBytes === undefined) {
      // 首次（进程内）惰性 stat 一次，拿到历史残留大小
      this.currentBytes = existsSync(this.filePath) ? statSync(this.filePath).size : 0
    }
    if (this.currentBytes < this.maxBytes) return

    // 从最旧开始滚动：.2 删除、.1 → .2、主文件 → .1
    const rotated = (n: number) => this.filePath.replace(/\.jsonl$/, `.${n}.jsonl`)
    const oldest = rotated(this.maxRotations)
    if (existsSync(oldest)) unlinkSync(oldest)
    for (let n = this.maxRotations - 1; n >= 1; n--) {
      if (existsSync(rotated(n))) renameSync(rotated(n), rotated(n + 1))
    }
    if (existsSync(this.filePath)) renameSync(this.filePath, rotated(1))
    this.currentBytes = 0
  }
}
