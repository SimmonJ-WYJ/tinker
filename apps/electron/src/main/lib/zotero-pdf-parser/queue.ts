/**
 * 内存态解析队列
 *
 * 不持久化任务列表本身——任务的"待办状态"已经通过 snapshot.json 中
 * record.parse.status 持久化（pending / failed-but-retryable）。
 *
 * 进程崩溃后启动时，由 worker 重新扫描 snapshot 把 pending / parsing 残留入队即可。
 */

/** 默认并发数；PDF 解析 IO + CPU 都重，2 是兼顾响应度和吞吐的稳妥值 */
export const MAX_CONCURRENT = 2

/** 单任务最多重试次数（含成功的那次） */
export const MAX_ATTEMPTS = 3

export type RunOne = (attachmentKey: string) => Promise<void>

/**
 * 限并发队列
 *
 * 同 attachmentKey 重复 enqueue 会被去重：
 *   - 已在 pending：忽略（和它一起被 tick 拉起来即可）
 *   - 已在 running：标记 dirty —— 当前正在跑的可能是"过时版本"（worker 跑的几秒
 *     内 Zotero 又改了同一 PDF），跑完 finally 时自动从 dirty 移回 pending 重跑一次。
 *     这是为了不漏掉解析任务（worker 拉到的 PDF 内容可能已经过期）。
 * stop() 后不再启动新任务，但 in-flight 的让其自然结束（Worker 内部的 try/catch 兜底）。
 */
export class ParserQueue {
  private pending = new Set<string>()
  private running = new Set<string>()
  /** 在 running 期间又被 enqueue 的 key —— 跑完后重新入队跑一次 */
  private dirty = new Set<string>()
  private stopped = false

  constructor(
    private readonly runOne: RunOne,
    private readonly concurrency = MAX_CONCURRENT,
  ) {}

  enqueue(key: string): void {
    if (this.stopped) return
    if (this.running.has(key)) {
      // 当前正在跑这个 key，跑的内容可能已过期。标记 dirty，跑完 finally 时会重新拉回 pending
      if (!this.dirty.has(key)) {
        this.dirty.add(key)
        console.log(`[Zotero PDF Parser Queue] ${key} 在 running 中又被 enqueue，标记 dirty 待重跑`)
      }
      return
    }
    if (this.pending.has(key)) return
    this.pending.add(key)
    this.tick()
  }

  enqueueMany(keys: string[]): void {
    for (const k of keys) this.enqueue(k)
  }

  /** 启动调度循环（幂等） */
  private tick(): void {
    while (!this.stopped && this.running.size < this.concurrency && this.pending.size > 0) {
      const key = this.pending.values().next().value
      if (!key) break
      this.pending.delete(key)
      this.running.add(key)
      void this.runOne(key)
        .catch(err => {
          // worker 内部已经 try/catch 处理，这里是兜底
          console.error('[Zotero PDF Parser Queue] runOne 未处理异常:', key, err)
        })
        .finally(() => {
          this.running.delete(key)
          // dirty 检查：跑解析期间又被 enqueue 同 key，重新移回 pending 跑一次
          if (this.dirty.has(key) && !this.stopped) {
            this.dirty.delete(key)
            this.pending.add(key)
            console.log(`[Zotero PDF Parser Queue] ${key} 解析完成但被标记 dirty，重新入队`)
          }
          this.tick()
        })
    }
  }

  stop(): void {
    this.stopped = true
    this.pending.clear()
    this.dirty.clear()
  }

  /** 当前 in-flight 的 attachmentKey 列表（用于状态摘要） */
  getRunningKeys(): string[] {
    return Array.from(this.running)
  }

  getCounts(): { pending: number; running: number } {
    return { pending: this.pending.size, running: this.running.size }
  }
}
