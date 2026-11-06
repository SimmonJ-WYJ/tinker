/**
 * Provider 适配器注册表
 *
 * 所有 provider 均走 Anthropic Messages API：原生 Anthropic 以及提供 Anthropic 兼容端点的
 * 第三方（DeepSeek / Moonshot / Zhipu / MiniMax / Doubao / Qwen / OpenRouter / 自定义），
 * 全部映射到 AnthropicAdapter。OpenRouter 的 "Anthropic Skin" 与原生协议完全兼容。
 */

import type { ProviderType } from '@asci/shared'
import type { ProviderAdapter } from './types.ts'
import { OpenAIAdapter } from './openai-adapter.ts'
import { AnthropicAdapter } from './anthropic-adapter.ts'

// 导出所有类型和工具
export * from './types.ts'
export * from './sse-reader.ts'
export * from './url-utils.ts'

// 导出适配器类
export { AnthropicAdapter } from './anthropic-adapter.ts'

/** 供应商适配器注册表 — 全部使用 AnthropicAdapter */
const adapterRegistry = new Map<ProviderType, ProviderAdapter>(
  (['anthropic', 'minimax', 'kimi', 'moonshot', 'deepseek', 'openrouter', 'glm', 'custom-anthropic'] as ProviderType[])
    .map((p) => [p, new AnthropicAdapter()] as const),
)

/**
 * 根据供应商类型获取适配器
 *
 * @param provider 供应商类型
 * @returns 对应的适配器实例
 * @throws Error 如果供应商类型不支持
 */
export function getAdapter(provider: ProviderType): ProviderAdapter {
  if (provider === 'custom-openai') return new OpenAIAdapter()
  const adapter = adapterRegistry.get(provider)
  if (!adapter) {
    throw new Error(`不支持的供应商: ${provider}。你可能过去使用的是 ASCI 商业版，请重新下载商业版覆盖安装，当前版本为开源版本。`)
  }
  return adapter
}

// Provider Profile（D-2）
export type {
  ProviderProfile,
  FetchFn,
  EndpointValidation,
  AuthErrorFormat,
  ProfileFetchModelsInput,
} from './profile.ts'
export { ALL_PROVIDER_TYPES } from './profile.ts'
export { getProfile, getAllProfiles } from './profile-registry.ts'
export { getDefaultCapabilities, getEffectiveCapabilities } from './capabilities.ts'

export * from './custom-providers.ts'
export * from './openai-compat.ts'

export * from './image-response.ts'

export * from './gemini-image.ts'
