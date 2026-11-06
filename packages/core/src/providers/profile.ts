/**
 * Provider Profile 契约
 *
 * 承载 6 个 Anthropic-skin provider 之间的"配置级差异"：
 * 端点合法性、probe model、额外请求头、401 文案、PDF 能力、模型清单策略。
 * Profile 是纯数据 + 薄逻辑，不依赖 Electron API；通过 `fetchFn` 依赖注入解耦 proxy。
 *
 * 与 ProviderAdapter（协议级：流式请求构建 / SSE 解析）正交。
 */

import type {
  ProviderType,
  ChannelCapabilities,
  FetchModelsResult,
} from '@asci/shared'

/** 注入的 fetch 函数（调用方负责 proxy 适配）*/
export type FetchFn = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; redirect?: RequestRedirect; signal?: AbortSignal },
) => Promise<Response>

/** validateEndpoint 返回值：端点合法 / 不合法（带 i18n key） */
export interface EndpointValidation {
  ok: boolean
  /** ok=false 时返回 i18n key，调用方走 t(key) 翻译 */
  messageKey?: string
}

/** formatAuthError 返回值：i18n key + 可选 detail snippet（已截断） */
export interface AuthErrorFormat {
  /** 基础文案 i18n key，例：'errors.channelTest.kimiCodeAuth' */
  baseMessageKey: string
  /** detail 片段（profile 内部已做长度截断）；undefined 表示无 detail */
  detailSnippet?: string
}

/** fetchModels 输入：调用方注入 fetchFn 与凭证 */
export interface ProfileFetchModelsInput {
  baseUrl: string
  apiKey: string
  fetchFn: FetchFn
}

export interface ProviderProfile {
  /** Provider 类型标识 */
  readonly providerType: ProviderType

  /** 连接测试用的默认 probe 模型（OpenRouter 必须用 namespaced 模型） */
  defaultProbeModel(baseUrl: string): string

  /** 额外请求头（OpenRouter ranking header；默认 {} ） */
  extraHeaders(baseUrl: string, apiKey: string): Record<string, string>

  /** 端点合法性预检查（Moonshot OpenAI 端点 / Kimi /coding 端点等异常拦截） */
  validateEndpoint?(baseUrl: string): EndpointValidation

  /**
   * 401 自定义文案
   *
   * 返回 i18n key + 可选的 detail snippet（已截断），调用方走
   * `t(baseMessageKey)` + 可选 `t('errors.channelTest.responseDetail', { detail })`
   * 拼出最终文案。profile 不依赖 i18n 运行时。
   *
   * 返回 null 表示走默认 401 文案。
   */
  formatAuthError?(baseUrl: string, responseBody: string): AuthErrorFormat | null

  /** 默认 channel capabilities（PDF document block 等） */
  defaultCapabilities(): ChannelCapabilities & Required<Pick<ChannelCapabilities, 'supportsPdfDocumentBlock'>>

  /** 拉取模型清单（静态返回 or 远程 fetch） */
  fetchModels(input: ProfileFetchModelsInput): Promise<FetchModelsResult>
}

/** 用于 task 9 的契约测试：枚举所有 ProviderType */
export const ALL_PROVIDER_TYPES: readonly ProviderType[] = [
  'anthropic',
  'minimax',
  'kimi',
  'moonshot',
  'deepseek',
  'openrouter',
  'glm',
  'custom-anthropic',
  'custom-openai',
  'custom-image',
] as const
