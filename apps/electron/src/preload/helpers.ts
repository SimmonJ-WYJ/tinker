/** 纯订阅辅助函数：保留平台提供的取消订阅函数。 */
import type { PlatformTransport } from './transport.ts'

export function subscribe<T>(transport: PlatformTransport, channel: string, callback: (data: T) => void): () => void {
  return transport.subscribe(channel, callback)
}
