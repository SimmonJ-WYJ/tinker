/**
 * GLM profile：智谱 BigModel 的 Anthropic 兼容端点（https://open.bigmodel.cn/api/anthropic）
 *
 * 混合拉取策略：先远程拉 GET /models，与内置 seed 清单按 id 去重合并（seed 在前，保留展示名）；
 * 远程失败（网络 / 非 2xx）则回退到 seed 清单，仍返回 success=true，message 注明回退。
 * 401 单独提示 API Key 无效（镜像其他 profile）。
 */
import type { ProviderProfile, ProfileFetchModelsInput } from '../profile.ts'
import { normalizeAnthropicBaseUrl } from '../url-utils.ts'
import type { FetchModelsResult, ChannelModel } from '@asci/shared'

/** 内置 seed 清单（来自智谱官方文档，远程不可达时的兜底） */
const SEED_MODELS: readonly ChannelModel[] = [
  { id: 'glm-4.7', name: 'GLM-4.7', enabled: true },
  { id: 'glm-4.6', name: 'GLM-4.6', enabled: true },
  { id: 'glm-4.5', name: 'GLM-4.5', enabled: true },
  { id: 'glm-4.5-air', name: 'GLM-4.5-Air', enabled: true },
]

interface GlmModelItem {
  id: string
  display_name?: string
  name?: string
}

/** seed 兜底清单（seed id 互不冲突，远程合并时只需过滤掉与 seed 重复的 id） */
const seedFallback = (): ChannelModel[] => SEED_MODELS.map((m) => ({ ...m }))

async function fetchGlmModels(
  input: ProfileFetchModelsInput,
): Promise<FetchModelsResult> {
  const seed = seedFallback()
  const url = normalizeAnthropicBaseUrl(input.baseUrl)

  let response: Response
  try {
    response = await input.fetchFn(`${url}/models`, {
      method: 'GET',
      headers: {
        'x-api-key': input.apiKey,
        Authorization: `Bearer ${input.apiKey}`,
        'anthropic-version': '2023-06-01',
      },
    })
  } catch {
    // 网络异常：回退 seed 清单
    return {
      success: true,
      message: `远程模型接口不可达，已加载 ${seed.length} 个内置模型（智谱 GLM 内置精选，最新请到 docs.bigmodel.cn 查询）`,
      models: seed,
    }
  }

  if (response.status === 401) {
    const text = await response.text().catch(() => '')
    return {
      success: false,
      message: `API Key 无效${text ? `: ${text.slice(0, 150)}` : ''}`,
      models: [],
    }
  }

  if (!response.ok) {
    // 非 2xx（GLM 的 Anthropic skin 可能不开放 /models）：回退 seed 清单
    return {
      success: true,
      message: `远程模型接口未开放（${response.status}），已加载 ${seed.length} 个内置模型（智谱 GLM 内置精选，最新请到 docs.bigmodel.cn 查询）`,
      models: seed,
    }
  }

  const body = (await response.json().catch(() => ({}))) as { data?: GlmModelItem[] }
  const items = body.data ?? []
  // seed id 已固定且互不冲突 → 只过滤掉与 seed 重复的远程 id，seed 在前保留内置展示名
  const seedIds = new Set(seed.map((m) => m.id))
  const remote: ChannelModel[] = items
    .filter((item) => !seedIds.has(item.id))
    .map((item) => ({
      id: item.id,
      name: item.display_name ?? item.name ?? item.id,
      enabled: true,
    }))

  const models = [...seed, ...remote]
  return {
    success: true,
    message: `成功获取 ${models.length} 个模型（内置 ${seed.length} 个 + 远程新增 ${remote.length} 个，已按 id 去重）`,
    models,
  }
}

export const glmProfile: ProviderProfile = {
  providerType: 'glm',
  defaultProbeModel: () => 'glm-4.6',
  extraHeaders: () => ({}),
  defaultCapabilities: () => ({ supportsPdfDocumentBlock: true }),
  fetchModels: fetchGlmModels,
}
