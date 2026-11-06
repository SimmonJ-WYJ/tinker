/**
 * PostHog 上报器（issue #426 / ADR-011）
 *
 * 直接走 PostHog HTTP /batch/ API，不引 posthog-node——因为它用自带 http
 * 客户端，无法复用项目的 undici ProxyAgent（proxy-fetch.ts），科研用户
 * 大量在代理环境下会绕过代理丢数据。
 *
 * 行为：
 *   - 批量缓冲走 BatchQueue（满 10 条或 10s flush）
 *   - 无 API key（账号未开通）→ 不发网络，事件已由 telemetry-service
 *     落本地 events.jsonl，本 sender 直接丢弃
 *   - 网络失败 → 回落 events.jsonl（at-least-once 语义本期不做补传，
 *     留待自建后端统一设计）
 *
 * EU 数据驻留：host 固定 eu.i.posthog.com（ADR-011）。
 */
import { getFetchFn } from '../proxy-fetch.ts'
import { getEffectiveProxyUrl } from '../proxy-settings-service.ts'
import { BatchQueue } from './batch-queue.ts'
import type { JsonlBuffer } from './jsonl-buffer.ts'

/** PostHog EU 摄取/决策端点（capture 与 decide 共用，ADR-011 数据驻留） */
export const POSTHOG_HOST = 'https://eu.i.posthog.com'

export interface PosthogCaptureItem {
  event: string
  distinct_id: string
  properties: Record<string, unknown>
  timestamp: string
}

export class PosthogSender extends BatchQueue<PosthogCaptureItem> {
  /**
   * @param apiKey PostHog project API key（publishable）；undefined = 账号未开通，不发网络
   * @param fallbackBuffer 网络失败时的本地回落
   */
  constructor(
    private readonly apiKey: string | undefined,
    private readonly fallbackBuffer: JsonlBuffer,
  ) {
    super(10, 10_000)
  }

  /** 入队一条事件 */
  enqueue(item: PosthogCaptureItem): void {
    if (!this.apiKey) return // 无 key：事件已落本地 JSONL，这里不再处理
    this.push(item)
  }

  protected async sendBatch(batch: PosthogCaptureItem[]): Promise<void> {
    try {
      const fetchFn = getFetchFn(await getEffectiveProxyUrl())
      const res = await fetchFn(`${POSTHOG_HOST}/batch/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: this.apiKey, batch }),
      })
      if (!res.ok) {
        throw new Error(`PostHog /batch/ 响应 ${res.status}`)
      }
    } catch (err) {
      console.warn('[遥测] PostHog 上报失败，回落本地缓冲:', err)
      for (const item of batch) {
        this.fallbackBuffer.append({ ...item, _sendFailed: true })
      }
    }
  }
}
