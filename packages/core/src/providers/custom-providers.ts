/** 自定义中转站的端点、模型清单和探针请求，零平台依赖。 */
import { openAIOutputLimit } from './openai-model-options.ts'
import type { FetchModelsResult, ProviderType } from '@asci/shared'
import type { ProviderProfile, ProfileFetchModelsInput } from './profile.ts'
import type { ProviderRequest } from './types.ts'
import { normalizeAnthropicBaseUrl } from './url-utils.ts'

export function normalizeOpenAIBaseUrl(baseUrl: string): string {
  const url = baseUrl.trim().replace(/\/+$/, '').replace(/\/(?:chat\/completions|images\/generations)$/, '')
  return /\/v\d+$/.test(url) ? url : `${url}/v1`
}

export function validateCustomEndpoint(baseUrl: string): void {
  const url = new URL(baseUrl)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Base URL must be an HTTP(S) URL without credentials, query or fragment')
  }
}

export function buildCustomProbe(provider: ProviderType, baseUrl: string, apiKey: string, model: string): ProviderRequest {
  validateCustomEndpoint(baseUrl)
  if (!model.trim()) throw new Error('A model ID is required')
  const openai = provider !== 'custom-anthropic'
  if (provider === 'custom-image') return {
    url: `${normalizeOpenAIBaseUrl(baseUrl)}/images/generations`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: model.trim(), prompt: 'A small blue circle on a white background.', n: 1 }),
  }
  return {
    url: openai ? `${normalizeOpenAIBaseUrl(baseUrl)}/chat/completions` : `${normalizeAnthropicBaseUrl(baseUrl)}/messages`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, ...(!openai ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } : {}) },
    body: JSON.stringify({ model: model.trim(), ...(openai ? openAIOutputLimit(model, 1) : { max_tokens: 1 }), messages: [{ role: 'user', content: 'hi' }] }),
  }
}

async function fetchCustomModels(openai: boolean, input: ProfileFetchModelsInput): Promise<FetchModelsResult> {
  validateCustomEndpoint(input.baseUrl)
  const response = await input.fetchFn(`${openai ? normalizeOpenAIBaseUrl(input.baseUrl) : normalizeAnthropicBaseUrl(input.baseUrl)}/models`, {
    redirect: 'error', signal: AbortSignal.timeout(30_000),
    headers: { Authorization: `Bearer ${input.apiKey}`, ...(!openai ? { 'x-api-key': input.apiKey, 'anthropic-version': '2023-06-01' } : {}) },
  })
  if (!response.ok) return { success: false, message: `HTTP ${response.status}`, models: [] }
  const body = await response.json() as { data?: { id?: unknown; name?: unknown; display_name?: unknown }[] }
  if (!Array.isArray(body.data)) return { success: false, message: 'Invalid model list', models: [] }
  const models = new Map<string, { id: string; name: string; enabled: boolean }>()
  for (const item of body.data) {
    if (typeof item.id !== 'string' || !item.id.trim()) continue
    const label = item.display_name ?? item.name
    models.set(item.id, { id: item.id, name: typeof label === 'string' ? label : item.id, enabled: true })
  }
  return { success: true, message: `${models.size} models`, models: [...models.values()] }
}

export function createCustomProfile(providerType: 'custom-anthropic' | 'custom-openai' | 'custom-image'): ProviderProfile {
  return {
    providerType,
    defaultProbeModel: () => '',
    extraHeaders: () => ({}),
    defaultCapabilities: () => ({ supportsPdfDocumentBlock: false }),
    fetchModels: input => fetchCustomModels(providerType !== 'custom-anthropic', input),
  }
}
