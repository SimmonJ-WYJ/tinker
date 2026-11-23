/**
 * 渠道（Channel）相关类型定义
 *
 * 渠道是用户配置的 AI 供应商连接，包含 API Key、模型列表等信息。
 * API Key 使用 Electron safeStorage 加密后存储在本地配置文件中。
 */

/**
 * 支持的 AI 供应商类型
 *
 * 已接入：Anthropic 原生、MiniMax、Kimi Code、Moonshot Anthropic、DeepSeek、OpenRouter、GLM（智谱，均为 Anthropic 兼容端点）。
 * OpenRouter 走 "Anthropic Skin"（POST /api/v1/messages），透传 thinking / tools / image / PDF，
 * 但模型 ID 必须带 namespace 前缀（如 anthropic/claude-sonnet-4.6）。
 * GLM 走智谱 BigModel 的 Anthropic 兼容端点（https://open.bigmodel.cn/api/anthropic）。
 * 新增时同步更新 PROVIDER_DEFAULT_URLS / PROVIDER_LABELS 与 providers 注册表。
 */
export type ProviderType =
  | 'anthropic'
  | 'minimax'
  | 'kimi'
  | 'moonshot'
  | 'deepseek'
  | 'openrouter'
  | 'glm'
  | 'custom-anthropic'
  | 'custom-openai'
  | 'custom-image'

/**
 * 各供应商的默认 Base URL（Anthropic 兼容端点）
 *
 * openrouter：填 https://openrouter.ai/api 即可，normalize 会补 /v1，请求时再拼 /messages，
 * 与 SDK 内部 ANTHROPIC_BASE_URL 拼接逻辑保持一致。
 */
export const PROVIDER_DEFAULT_URLS: Record<ProviderType, string> = {
  anthropic: 'https://api.anthropic.com',
  minimax: 'https://api.minimaxi.com/anthropic',
  kimi: 'https://api.kimi.com/coding',
  moonshot: 'https://api.moonshot.cn/anthropic',
  deepseek: 'https://api.deepseek.com/anthropic',
  openrouter: 'https://openrouter.ai/api',
  glm: 'https://open.bigmodel.cn/api/anthropic',
  'custom-anthropic': '',
  'custom-openai': '',
  'custom-image': '',
}

/**
 * 供应商显示名称
 */
export const PROVIDER_LABELS: Record<ProviderType, string> = {
  anthropic: 'Anthropic',
  minimax: 'MiniMax',
  kimi: 'Kimi Code',
  moonshot: 'Moonshot Anthropic',
  deepseek: 'DeepSeek',
  openrouter: 'OpenRouter',
  glm: 'GLM',
  'custom-anthropic': 'Custom · Anthropic',
  'custom-openai': 'Custom · OpenAI',
  'custom-image': 'Custom · Image generation',
}

/** 生图渠道协议，用户显式选择；不根据模型别名自动猜测。 */
export type ImageProtocol = 'openai-images' | 'gemini-content' | 'gemini-interactions'

/** 原生宿主可投影给用户的固定渠道错误。 */
export const NATIVE_CHANNEL_ERROR_CODES = [
  'channelUnauthorized', 'channelPaymentRequired', 'channelForbidden', 'channelRateLimited',
  'channelTimeout', 'sourceChannelUnavailable', 'modelCapabilityMismatch', 'imageModelDiscussion',
] as const
export function isNativeChannelError(value: unknown): value is typeof NATIVE_CHANNEL_ERROR_CODES[number] {
  return NATIVE_CHANNEL_ERROR_CODES.some(code => code === value)
}

export interface ChannelModel {
  /** 受管渠道已验证的输出能力。旧记录继续使用文字路由。 */
  capability?: 'text' | 'image' | 'unsupported'
  supportsImageEdits?: boolean
  /** 原生宿主声明的推理能力；空列表表示不发送推理档位。 */
  supportedEfforts?: string[]
  /** 模型唯一标识（如 claude-sonnet-4-5-20250929） */
  id: string
  /** 模型显示名称 */
  name: string
  /** 是否启用 */
  enabled: boolean
}

/**
 * 渠道能力开关
 *
 * 用于声明渠道兼容性约束，供 Orchestrator 决策走哪条工具/编码路径。
 * 任一字段缺省都回退到 provider 的默认值（见 utils/channel-capabilities.ts）。
 */
export interface ChannelCapabilities {
  imageProtocol?: ImageProtocol
  /** 生图偏好，复杂任务自动选择时优先；不代表厂商质量认证。 */
  imageQualityPriority?: number
  /** 渠道声明的参考图上限（0 表示仅文生图）。 */
  imageMaxReferences?: number
  /**
   * 是否支持 Anthropic Messages API 的 `type:"document"` 内容块（PDF base64 注入）。
   *
   * Moonshot Anthropic 兼容端点对该 block 返回 HTTP 500（issue #74）。该值 false 时
   * ASCI 会在 Agent 侧禁用 `Read` 工具对 .pdf 路径的调用，改让 Agent 走
   * `mcp__pdf_parser__pdf_parse_batch` 抽文本注入下一轮。
   *
   * 缺省（undefined）时由 `getEffectiveCapabilities` 回退到 provider 默认。
   */
  supportsPdfDocumentBlock?: boolean
}

/**
 * 渠道配置
 *
 * 存储在 ~/.asci/channels.json 中，apiKey 字段为加密后的 base64 字符串
 */
export interface Channel {
  /** 受管凭据存在性元数据，不含密钥。 */
  hasCredential?: boolean
  /** 渠道唯一标识 */
  id: string
  /** 渠道名称（用户自定义） */
  name: string
  /** AI 供应商类型 */
  provider: ProviderType
  /** API Base URL */
  baseUrl: string
  /** 加密后的 API Key（base64 编码） */
  apiKey: string
  /** 可用模型列表 */
  models: ChannelModel[]
  /** 是否启用 */
  enabled: boolean
  /** 创建时间戳 */
  createdAt: number
  /** 更新时间戳 */
  updatedAt: number
  /** 渠道能力开关（缺省回退到 provider 默认） */
  capabilities?: ChannelCapabilities
}

/**
 * 创建渠道时的输入数据（apiKey 为明文）
 */
export interface ChannelCreateInput {
  /** 原生文档内显式保存意图；不含密钥或密钥摘要。 */
  credentialIntentId?: string
  name: string
  provider: ProviderType
  baseUrl: string
  /** 明文 API Key，主进程会加密后存储 */
  apiKey: string
  models: ChannelModel[]
  enabled: boolean
  /** 渠道能力开关（缺省回退到 provider 默认） */
  capabilities?: ChannelCapabilities
}

/**
 * 更新渠道时的输入数据（所有字段可选）
 */
export interface ChannelUpdateInput {
  /** 原生文档内显式保存意图；不含密钥或密钥摘要。 */
  credentialIntentId?: string
  name?: string
  provider?: ProviderType
  baseUrl?: string
  /** 明文 API Key，为空字符串表示不更新 */
  apiKey?: string
  models?: ChannelModel[]
  enabled?: boolean
  /** 渠道能力开关（缺省回退到 provider 默认） */
  capabilities?: ChannelCapabilities
}

/**
 * 渠道配置文件格式
 */
export interface ChannelsConfig {
  /** 配置版本号 */
  version: number
  /** 渠道列表 */
  channels: Channel[]
}

/**
 * 连接测试结果
 */
export interface ChannelTestResult {
  /** 是否成功 */
  success: boolean
  /** 结果消息 */
  message: string
}

/**
 * 拉取模型的输入参数（无需已保存的渠道，直接传入凭证）
 *
 * probeModel 仅在直连测试（testChannelDirect）路径使用：
 * 让"测试连接"打到用户当前真正会用的模型，避免硬编码 probe 与所选模型不匹配。
 * fetchModels 路径忽略此字段。
 */
export interface FetchModelsInput {
  provider: ProviderType
  baseUrl: string
  /** 明文 API Key */
  apiKey: string
  /** 测试连接时的探针模型（可选）；缺省走硬编码 fallback */
  imageProtocol?: ImageProtocol
  probeModel?: string
}

/**
 * 拉取模型的结果
 */
export interface FetchModelsResult {
  /** 是否成功 */
  success: boolean
  /** 结果消息 */
  message: string
  /** 获取到的模型列表 */
  models: ChannelModel[]
}

/**
 * 模型选项（扁平化的渠道+模型组合）
 *
 * 用于渲染进程的模型选择器下拉列表。
 */
export interface ModelOption {
  capability?: ChannelModel['capability']
  /** 渠道 ID */
  channelId: string
  /** 渠道名称 */
  channelName: string
  /** 模型 ID */
  modelId: string
  /** 模型显示名称 */
  modelName: string
  /** AI 供应商类型 */
  provider: ProviderType
}

/**
 * 渠道相关 IPC 通道常量
 */
export const CHANNEL_IPC_CHANNELS = {
  /** 获取所有渠道列表 */
  LIST: 'channel:list',
  /** 创建渠道 */
  CREATE: 'channel:create',
  /** 更新渠道 */
  UPDATE: 'channel:update',
  /** 删除渠道 */
  DELETE: 'channel:delete',
  /** 解密获取明文 API Key */
  DECRYPT_KEY: 'channel:decrypt-key',
  /** 测试渠道连接 */
  TEST: 'channel:test',
  /** 从供应商拉取可用模型列表 */
  FETCH_MODELS: 'channel:fetch-models',
  /** 直接测试连接（无需已保存渠道，传入明文凭证） */
  TEST_DIRECT: 'channel:test-direct',
} as const
