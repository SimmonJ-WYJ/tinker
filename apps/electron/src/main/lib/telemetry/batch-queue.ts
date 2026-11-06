/**
 * 遥测批量队列（PosthogSender / SignalSender 共用的批量-定时 flush 骨架）
 *
 * 满 batchSize 条立即 flush，否则 flushIntervalMs 定时器到点 flush；
 * 定时器 unref 不阻止进程退出（遥测不能拖住 app quit）。
 * 子类只实现 sendBatch（网络细节与失败处理）。
 */
export abstract class BatchQueue<T> {
  private queue: T[] = []
  private flushTimer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly batchSize: number,
    private readonly flushIntervalMs: number,
  ) {}

  /** 入队一条；按批量阈值 / 定时器自动 flush */
  protected push(item: T): void {
    this.queue.push(item)
    if (this.queue.length >= this.batchSize) {
      void this.flush()
      return
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => void this.flush(), this.flushIntervalMs)
      this.flushTimer.unref?.()
    }
  }

  /** 立即发送当前队列（app 退出前可显式调用） */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }
    if (this.queue.length === 0) return
    const batch = this.queue
    this.queue = []
    await this.sendBatch(batch)
  }

  /** 发送一批（实现方负责网络失败的回落/告警，不向上抛） */
  protected abstract sendBatch(batch: T[]): Promise<void>
}
