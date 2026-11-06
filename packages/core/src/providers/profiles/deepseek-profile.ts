/**
 * DeepSeek profile：DeepSeek V4 系列静态清单（Anthropic 兼容端点不暴露 /models）
 *
 * 镜像 channel-manager.ts:fetchDeepseekModels
 */
import type { ProviderProfile } from '../profile.ts'
import { DEFAULT_CLAUDE_MODEL_ID } from '@asci/shared'

export const deepseekProfile: ProviderProfile = {
  providerType: 'deepseek',
  defaultProbeModel: () => DEFAULT_CLAUDE_MODEL_ID,
  extraHeaders: () => ({}),
  defaultCapabilities: () => ({ supportsPdfDocumentBlock: true }),
  fetchModels: async () => {
    const models = [
      { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro', enabled: true },
      { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', enabled: true },
    ]

    return {
      success: true,
      message: `已加载 ${models.length} 个内置模型（DeepSeek 的 Anthropic 端点未开放 /models 接口，清单来自官方文档，最新请到 api-docs.deepseek.com 查询）`,
      models,
    }
  },
}
