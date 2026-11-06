/**
 * Anthropic 原生 profile：从 GET /v1/models 拉清单 + 过滤 type=model
 *
 * 镜像 channel-manager.ts:fetchAnthropicModels 行为。
 * 注意：相比原始实现，此 profile 额外过滤 type !== 'model' 的条目（新行为，PR-2 替换后生效）。
 */
import type { ProviderProfile, ProfileFetchModelsInput } from '../profile.ts'
import { normalizeAnthropicBaseUrl } from '../url-utils.ts'
import type { FetchModelsResult, ChannelModel } from '@asci/shared'
import { DEFAULT_CLAUDE_MODEL_ID } from '@asci/shared'

interface AnthropicModelItem {
  id: string
  display_name?: string
  type?: string
}

async function fetchAnthropicModels(
  input: ProfileFetchModelsInput,
): Promise<FetchModelsResult> {
  const url = normalizeAnthropicBaseUrl(input.baseUrl)
  const response = await input.fetchFn(`${url}/models`, {
    method: 'GET',
    headers: {
      'x-api-key': input.apiKey,
      Authorization: `Bearer ${input.apiKey}`,
      'anthropic-version': '2023-06-01',
    },
  })

  if (response.status === 401) {
    const text = await response.text().catch(() => '')
    return {
      success: false,
      message: `API Key 无效${text ? `: ${text.slice(0, 150)}` : ''}`,
      models: [],
    }
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    return {
      success: false,
      message: `请求失败 (${response.status}): ${text.slice(0, 200)}`,
      models: [],
    }
  }

  const body = (await response.json()) as { data?: AnthropicModelItem[] }
  const items = body.data ?? []
  const models: ChannelModel[] = items
    .filter((item) => item.type === 'model')
    .map((item) => ({
      id: item.id,
      name: item.display_name ?? item.id,
      enabled: true,
    }))

  return { success: true, message: `成功获取 ${models.length} 个模型`, models }
}

export const anthropicProfile: ProviderProfile = {
  providerType: 'anthropic',
  defaultProbeModel: () => DEFAULT_CLAUDE_MODEL_ID,
  extraHeaders: () => ({}),
  defaultCapabilities: () => ({ supportsPdfDocumentBlock: true }),
  fetchModels: fetchAnthropicModels,
}
