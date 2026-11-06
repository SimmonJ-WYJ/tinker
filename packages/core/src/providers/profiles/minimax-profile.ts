/**
 * MiniMax profile：静态返回 MiniMax M2 系列；其 Anthropic 兼容端点不暴露 /models
 *
 * 镜像 channel-manager.ts:fetchMinimaxModels（包含原硬编码清单）
 *
 * MiniMax 官方未开放 /models 接口（api.minimaxi.com/v1/models 与 api.minimax.io/v1/models 均返回 404），
 * 因此这里内置一份基于官方文档维护的已知模型清单。
 * 新增模型时需手动更新，最新以 https://platform.minimax.io/docs/guides/models-intro 为准。
 */
import type { ProviderProfile } from '../profile.ts'
import { DEFAULT_CLAUDE_MODEL_ID } from '@asci/shared'

export const minimaxProfile: ProviderProfile = {
  providerType: 'minimax',
  defaultProbeModel: () => DEFAULT_CLAUDE_MODEL_ID,
  extraHeaders: () => ({}),
  defaultCapabilities: () => ({ supportsPdfDocumentBlock: true }),
  fetchModels: async () => {
    // 静态清单：MiniMax 未开放 /models 端点，直接返回内置列表，不发起网络请求
    const models = [
      { id: 'MiniMax-M2.7', name: 'MiniMax-M2.7', enabled: true },
      { id: 'MiniMax-M2.7-highspeed', name: 'MiniMax-M2.7 High Speed', enabled: true },
      { id: 'MiniMax-M2.5', name: 'MiniMax-M2.5', enabled: true },
      { id: 'MiniMax-M2.5-highspeed', name: 'MiniMax-M2.5 High Speed', enabled: true },
      { id: 'M2-her', name: 'M2-her', enabled: true },
      { id: 'MiniMax-M2.1', name: 'MiniMax-M2.1 (Legacy)', enabled: true },
      { id: 'MiniMax-M2.1-highspeed', name: 'MiniMax-M2.1 High Speed (Legacy)', enabled: true },
      { id: 'MiniMax-M2', name: 'MiniMax-M2 (Legacy)', enabled: true },
    ]

    return {
      success: true,
      message: `已加载 ${models.length} 个内置模型（MiniMax 未开放 /models 接口，清单来自官方文档，最新请到 platform.minimaxi.com / platform.minimax.io 查询）`,
      models,
    }
  },
}
