/**
 * Moonshot Anthropic 兼容 profile（api.moonshot.cn/anthropic）
 *
 * 镜像 channel-manager.ts 中：
 *  - fetchMoonshotModels（静态清单）
 *  - isMoonshotOpenAIEndpoint（OpenAI 端点拦截）
 *
 * Moonshot OpenAI 端点 /v1 不被 ASCI 支持（issue #25 历史），predicate 命中时
 * 返回 ok=false + i18n key，channel-manager 调用 t(key) 拼成最终提示。
 *
 * PDF document block 默认关闭（issue #74）。
 */
import type { ProviderProfile, EndpointValidation } from '../profile.ts'
import { DEFAULT_CLAUDE_MODEL_ID } from '@asci/shared'

function isMoonshotOpenAIEndpoint(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl.trim())
    const hostname = url.hostname.toLowerCase()
    const pathname = url.pathname.replace(/\/+$/, '')
    return (
      (hostname === 'api.moonshot.cn' || hostname === 'api.moonshot.ai') &&
      /^\/v\d+$/.test(pathname)
    )
  } catch {
    return false
  }
}

export const moonshotProfile: ProviderProfile = {
  providerType: 'moonshot',
  defaultProbeModel: () => DEFAULT_CLAUDE_MODEL_ID,
  extraHeaders: () => ({}),

  validateEndpoint: (baseUrl: string): EndpointValidation => {
    if (isMoonshotOpenAIEndpoint(baseUrl)) {
      return { ok: false, messageKey: 'errors.channelTest.moonshotOpenAIEndpoint' }
    }
    return { ok: true }
  },

  defaultCapabilities: () => ({ supportsPdfDocumentBlock: false }),

  fetchModels: async () => {
    const models = [
      { id: 'kimi-k2.6', name: 'Kimi K2.6', enabled: true },
      { id: 'kimi-k2.5', name: 'Kimi K2.5', enabled: true },
      { id: 'kimi-k2-thinking', name: 'Kimi K2 Thinking', enabled: false },
      { id: 'kimi-k2-thinking-turbo', name: 'Kimi K2 Thinking Turbo', enabled: false },
      { id: 'kimi-latest', name: 'Kimi Latest', enabled: false },
      { id: 'moonshot-v1-auto', name: 'Moonshot v1 Auto', enabled: false },
      { id: 'moonshot-v1-128k', name: 'Moonshot v1 128K', enabled: false },
    ]
    return {
      success: true,
      message: `已加载 ${models.length} 个内置模型（Moonshot Open Platform Key 请使用 https://api.moonshot.cn/anthropic 作为 Base URL）`,
      models,
    }
  },
}
