/**
 * article 生成器内存态队列（与 zotero-pdf-parser/queue.ts 同构）
 *
 * 任务持久化通过 snapshot.article.status 体现；进程重启时由 index.ts 的 startWorker
 * 重新扫描入队。
 */

import { nowMs } from '@asci/shared'

/** 默认并发：LLM 调用慢且按 token 计费，串行最稳 */
export const MAX_CONCURRENT = 1

/** 单任务最多重试次数（含成功的那次） */
export const MAX_ATTEMPTS = 3

export type RunOne = (attachmentKey: string) => Promise<void>

/**
 * 限并发队列（简化版，去掉 ParserQueue 的 dirty 重跑——article 的 dirty 通过
 * sourceMdMtimeMs 比对在 onMdReady 阶段判定，不需要队内 dirty 标记）。
 */
export class ArticleQueue {
  private pending = new Set<string>()
  private running = new Set<string>()
  private stopped = false

  constructor(
    private readonly runOne: RunOne,
    private readonly concurrency = MAX_CONCURRENT,
  ) {}

  enqueue(key: string): void {
    if (this.stopped) return
    if (this.running.has(key)) return
    if (this.pending.has(key)) return
    this.pending.add(key)
    console.log(
      `[Article Queue] + enqueue ${key} (pending=${this.pending.size}, running=${this.running.size})`,
    )
    this.tick()
  }

  enqueueMany(keys: string[]): void {
    for (const k of keys) this.enqueue(k)
  }

  /** 清空 pending（开关切关时用） */
  clearPending(): void {
    if (this.pending.size === 0) return
    console.log(`[Article Queue] 清空 pending (${this.pending.size} 个任务被取消)`)
    this.pending.clear()
  }

  private tick(): void {
    while (!this.stopped && this.running.size < this.concurrency && this.pending.size > 0) {
      const key = this.pending.values().next().value
      if (!key) break
      this.pending.delete(key)
      this.running.add(key)
      const startedAt = nowMs()
      console.log(
        `[Article Queue] ▶ start ${key} (pending=${this.pending.size}, running=${this.running.size})`,
      )
      void this.runOne(key)
        .catch(err => {
          console.error('[Article Queue] runOne 未处理异常:', key, err)
        })
        .finally(() => {
          const elapsed = ((nowMs() - startedAt) / 1000).toFixed(1)
          this.running.delete(key)
          console.log(
            `[Article Queue] ◀ finish ${key} (${elapsed}s, pending=${this.pending.size}, running=${this.running.size})`,
          )
          this.tick()
        })
    }
  }

  stop(): void {
    this.stopped = true
    this.pending.clear()
  }

  getRunningKeys(): string[] {
    return Array.from(this.running)
  }

  getCounts(): { pending: number; running: number } {
    return { pending: this.pending.size, running: this.running.size }
  }
}
