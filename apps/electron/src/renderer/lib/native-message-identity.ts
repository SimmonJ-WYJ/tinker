/** 原生消息命名空间独立于调用 UUID；旧 SDK 保留原 DOM/reference 标识。 */
import type { SDKMessage } from '@asci/shared'
export function nativeMessageIdentity(message: SDKMessage): string | undefined {
  const m=message as Record<string,unknown>
  if(typeof m._desktopQueueChainId==='string' && typeof m._desktopQueueUuid==='string')return `native-queue:${JSON.stringify([m._desktopQueueChainId,m._desktopQueueUuid])}`
  if(typeof m._desktopRunId==='string' && typeof m.uuid==='string')return `native-run:${JSON.stringify([m._desktopRunId,m.uuid])}`
  return undefined
}
export function isPendingUserMessage(message: SDKMessage, legacyPending: ReadonlySet<string>): boolean {
  const m=message as Record<string,unknown>
  if(typeof m._desktopQueueChainId==='string')return typeof m._desktopRunId!=='string'
  return legacyPending.has(typeof m.uuid==='string' ? m.uuid : '')
}
