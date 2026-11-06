/** 为 SDK 与科研评分子进程解析同一渠道的实际端点。 */
import type { Channel } from '@asci/shared'
import { createHash } from 'node:crypto'
import { createOpenAIBridge } from './openai-bridge.ts'
import type { OpenAIBridge } from './openai-bridge.ts'
import { getFetchFn } from './proxy-fetch.ts'
import { getEffectiveProxyUrl } from './proxy-settings-service.ts'

const bridges = new Map<string, { fingerprint: string; pending: Promise<OpenAIBridge> }>()
export async function resolveChannelEndpoint(channel: Pick<Channel, 'id' | 'provider' | 'baseUrl'>, apiKey: string): Promise<{ baseUrl: string; apiKey: string }> {
  if (channel.provider !== 'custom-openai') return { baseUrl: channel.baseUrl, apiKey }
  const proxy = await getEffectiveProxyUrl()
  const fingerprint = createHash('sha256').update(JSON.stringify([channel.baseUrl, apiKey, proxy])).digest('hex')
  const existing = bridges.get(channel.id)
  if (existing?.fingerprint === fingerprint) return existing.pending
  if (existing) void existing.pending.then(b => b.close()).catch(() => {})
  const pending = createOpenAIBridge({ baseUrl: channel.baseUrl, apiKey, fetchFn: getFetchFn(proxy) })
  const entry = { fingerprint, pending }
  bridges.set(channel.id, entry)
  try { return await pending } catch (error) {
    if (bridges.get(channel.id) === entry) bridges.delete(channel.id)
    throw error
  }
}
export function closeChannelBridges(): void {
  for (const entry of bridges.values()) void entry.pending.then(b => b.close()).catch(() => {})
  bridges.clear()
}
