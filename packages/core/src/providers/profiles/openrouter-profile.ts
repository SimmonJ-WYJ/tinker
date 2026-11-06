/**
 * OpenRouter profile：Anthropic Skin（POST /api/v1/messages）+ 远程拉模型
 *
 * 镜像 channel-manager.ts 中：
 *  - fetchOpenRouterModels（远程 + 过滤 anthropic/*）
 *  - OPENROUTER_RANKING_HEADERS（让 ASCI 出现在 OpenRouter 排行榜）
 *  - testAnthropicCompat 中的 isOpenRouter ? 'anthropic/claude-haiku-4.5' : ... probe model 分支
 */
import type { ProviderProfile, ProfileFetchModelsInput } from '../profile.ts'
import { normalizeAnthropicBaseUrl } from '../url-utils.ts'
import type { FetchModelsResult, ChannelModel } from '@asci/shared'

const RANKING_HEADERS: Record<string, string> = {
  'HTTP-Referer': 'https://github.com/OPENSCI-Labs/ASCI-Alpha',
  'X-Title': 'ASCI Alpha',
}

interface OpenRouterModelItem {
  id: string
  name?: string
}

async function fetchOpenRouterModels(
  input: ProfileFetchModelsInput,
): Promise<FetchModelsResult> {
  const url = normalizeAnthropicBaseUrl(input.baseUrl)
  const response = await input.fetchFn(`${url}/models`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      ...RANKING_HEADERS,
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

  const data = (await response.json()) as { data?: OpenRouterModelItem[] }
  const items = data.data ?? []

  const models: ChannelModel[] = items
    .filter((item) => item.id.startsWith('anthropic/'))
    .map((item) => ({
      id: item.id,
      name: item.name || item.id,
      enabled: true,
    }))

  return {
    success: true,
    message: `成功获取 ${models.length} 个 Anthropic 模型（已过滤；OpenRouter 走 Anthropic Skin，仅 anthropic/* 兼容当前协议）`,
    models,
  }
}

export const openrouterProfile: ProviderProfile = {
  providerType: 'openrouter',
  defaultProbeModel: () => 'anthropic/claude-haiku-4.5',
  extraHeaders: () => ({ ...RANKING_HEADERS }),
  defaultCapabilities: () => ({ supportsPdfDocumentBlock: true }),
  fetchModels: fetchOpenRouterModels,
}
