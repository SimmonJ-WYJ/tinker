/**
 * 自进化信号上报器（issue #427 / ADR-011）—— 可插拔通道
 *
 * 独立后端端点（与 PostHog 物理隔离）尚未建成（ADR-002 未拍板），
 * 本期行为：
 *   - 信号始终落本地 signals.jsonl（consent 闸门在 telemetry-service，
 *     到达这里的信号都是已获同意的）
 *   - endpoint 已配置（后端就绪后开闸）→ 额外批量 POST（BatchQueue，
 *     满 20 条或 30s flush）；失败不重试（本地已有副本，补传策略等后端定型）
 *
 * 验收 T-6（端点落库）显式等后端；T-5（schema 可查）由
 * schema/telemetry/*.schema.json 达成。
 */
import type { SelfEvolutionSignal } from '@asci/shared'
import { getFetchFn } from '../proxy-fetch.ts'
import { getEffectiveProxyUrl } from '../proxy-settings-service.ts'
import { BatchQueue } from './batch-queue.ts'
import type { JsonlBuffer } from './jsonl-buffer.ts'

export class SignalSender extends BatchQueue<SelfEvolutionSignal> {
  /**
   * @param endpoint 自进化后端端点 URL；undefined = 未就绪，仅本地缓冲
   * @param buffer 本地 signals.jsonl
   * @param deviceId 匿名设备标识（上报封皮用）
   */
  constructor(
    private readonly endpoint: string | undefined,
    private readonly buffer: JsonlBuffer,
    private readonly deviceId: string,
  ) {
    super(20, 30_000)
  }

  /** 接收一条已过 consent 闸门 + Zod 白名单的信号：写本地 + （有 endpoint 时）入队外发 */
  capture(signal: SelfEvolutionSignal): void {
    this.buffer.append(signal)
    if (!this.endpoint) return
    this.push(signal)
  }

  /** 只写本地缓冲、不外发（dev 上报未放行时用，保证本地仍可见） */
  bufferOnly(signal: SelfEvolutionSignal): void {
    this.buffer.append(signal)
  }

  protected async sendBatch(batch: SelfEvolutionSignal[]): Promise<void> {
    if (!this.endpoint) return
    try {
      const fetchFn = getFetchFn(await getEffectiveProxyUrl())
      const res = await fetchFn(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: this.deviceId, signals: batch }),
      })
      if (!res.ok) {
        throw new Error(`自进化端点响应 ${res.status}`)
      }
    } catch (err) {
      // 本地 signals.jsonl 已有副本，仅告警不重试
      console.warn('[遥测] 自进化信号上报失败（本地已有副本）:', err)
    }
  }
}
