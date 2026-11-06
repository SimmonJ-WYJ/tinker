/**
 * Kimi Code profile（api.kimi.com/coding）：静态清单 + /coding 端点 401 文案定制
 *
 * 镜像 channel-manager.ts 中：
 *  - fetchKimiModels（静态清单）
 *  - isKimiCodeEndpoint（端点判定）
 *  - kimiCodeAuthenticationMessage（401 文案拼接）
 *
 * PDF document block 默认关闭（兼容性未验证）。
 *
 * 注意：formatAuthError 内的文案字符串是 i18n key 的中文翻译值的临时占位；
 * PR-4 会将其替换为 t() 注入版本。
 */
import type { ProviderProfile, EndpointValidation, AuthErrorFormat } from '../profile.ts'
import { DEFAULT_CLAUDE_MODEL_ID } from '@asci/shared'

function isKimiCodeEndpoint(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl.trim())
    const hostname = url.hostname.toLowerCase()
    const pathname = url.pathname.replace(/\/+$/, '')
    return hostname === 'api.kimi.com' && (pathname === '/coding' || /^\/coding\/v\d+$/.test(pathname))
  } catch {
    return false
  }
}

export const kimiProfile: ProviderProfile = {
  providerType: 'kimi',
  defaultProbeModel: () => DEFAULT_CLAUDE_MODEL_ID,
  extraHeaders: () => ({}),

  // Kimi 端点 profile 不预检拦截；仅在 401 时定制文案
  validateEndpoint: (_baseUrl: string): EndpointValidation => ({ ok: true }),

  /**
   * 仅对 isKimiCodeEndpoint 为 true 的端点返回 i18n key + 截断后的 detail；
   * 其他端点返回 null 走默认 401 文案。
   *
   * 调用方拼装：t('errors.channelTest.kimiCodeAuth') + 可选
   * `t('errors.channelTest.responseDetail', { detail })`。
   */
  formatAuthError: (baseUrl: string, body: string): AuthErrorFormat | null => {
    if (!isKimiCodeEndpoint(baseUrl)) return null
    return {
      baseMessageKey: 'errors.channelTest.kimiCodeAuth',
      detailSnippet: body ? body.slice(0, 150) : undefined,
    }
  },

  defaultCapabilities: () => ({ supportsPdfDocumentBlock: false }),

  /**
   * Kimi Code 提供单一固定模型 ID 'kimi-for-coding'，后端自动路由到最新发布模型。
   * /anthropic 端点未开放 /models 接口，因此使用静态清单。
   * 文档：https://www.kimi.com/code/docs/
   */
  fetchModels: async () => ({
    success: true,
    message:
      '已加载 1 个内置模型（Kimi Code 提供单一路由模型，后端自动更新到最新版本；详情见 https://www.kimi.com/code/docs/）',
    models: [{ id: 'kimi-for-coding', name: 'Kimi for Coding', enabled: true }],
  }),
}
