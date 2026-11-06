/**
 * 渠道管理器
 *
 * 负责渠道的 CRUD 操作、API Key 加密/解密、连接测试。
 * 使用 Electron safeStorage 进行 API Key 加密（底层使用 OS 级加密）。
 * 数据持久化到 ~/.asci/channels.json。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { getChannelsPath } from './config-paths'
import type {
  Channel,
  ChannelCreateInput,
  ChannelUpdateInput,
  ChannelsConfig,
  ChannelTestResult,
  FetchModelsInput,
  FetchModelsResult,
  ProviderType,
} from '@asci/shared'
import { nowMs } from '@asci/shared'
import { getDefaultCapabilities, getProfile, normalizeAnthropicBaseUrl, buildCustomProbe, parseGeneratedImage, buildGeminiImageRequest, parseGeminiImage, geminiImageBaseUrl } from '@asci/core'
import { getFetchFn } from './proxy-fetch'
import { getEffectiveProxyUrl } from './proxy-settings-service'
import { t } from './i18n-main'

/** 当前配置版本 */
const CONFIG_VERSION = 1

/**
 * 读取渠道配置文件
 */
function readConfig(): ChannelsConfig {
  const configPath = getChannelsPath()

  if (!existsSync(configPath)) {
    return { version: CONFIG_VERSION, channels: [] }
  }

  try {
    const raw = readFileSync(configPath, 'utf-8')
    const parsed = JSON.parse(raw) as ChannelsConfig
    // 兼容旧文件：缺 capabilities 字段时按 provider 兜底，不持久化（首次 update 时落盘）
    parsed.channels = parsed.channels.map((c) =>
      c.capabilities ? c : { ...c, capabilities: getDefaultCapabilities(c.provider) },
    )
    return parsed
  } catch (error) {
    console.error('[渠道管理] 读取配置文件失败:', error)
    return { version: CONFIG_VERSION, channels: [] }
  }
}

/**
 * 写入渠道配置文件
 */
function writeConfig(config: ChannelsConfig): void {
  const configPath = getChannelsPath()

  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
  } catch (error) {
    console.error('[渠道管理] 写入配置文件失败:', error)
    throw new Error('写入渠道配置失败')
  }
}

/**
 * 加密 API Key
 *
 * 使用 Electron safeStorage 加密，底层使用：
 * - macOS: Keychain
 * - Windows: DPAPI
 * - Linux: Secret Service API
 *
 * @returns base64 编码的加密字符串
 */
function encryptApiKey(plainKey: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[渠道管理] safeStorage 加密不可用，将以明文存储')
    return plainKey
  }

  const encrypted = safeStorage.encryptString(plainKey)
  return encrypted.toString('base64')
}

/**
 * 解密 API Key
 *
 * @param encryptedKey base64 编码的加密字符串
 * @returns 明文 API Key
 */
function decryptKey(encryptedKey: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    // 如果加密不可用，假设存储的是明文
    return encryptedKey
  }

  try {
    const buffer = Buffer.from(encryptedKey, 'base64')
    return safeStorage.decryptString(buffer)
  } catch (error) {
    console.error('[渠道管理] 解密 API Key 失败:', error)
    throw new Error('解密 API Key 失败')
  }
}

/**
 * 获取所有渠道
 *
 * 返回的渠道中 apiKey 保持加密状态。
 */
export function listChannels(): Channel[] {
  const config = readConfig()
  return config.channels
}

/**
 * 按 ID 获取渠道
 *
 * 返回的渠道中 apiKey 保持加密状态。
 */
export function getChannelById(id: string): Channel | undefined {
  const config = readConfig()
  return config.channels.find((c) => c.id === id)
}

/**
 * 创建新渠道
 *
 * @param input 渠道创建数据（apiKey 为明文，会自动加密）
 * @returns 创建后的渠道（apiKey 为加密态）
 */
export function createChannel(input: ChannelCreateInput): Channel {
  const config = readConfig()
  const now = nowMs()

  const channel: Channel = {
    id: randomUUID(),
    name: input.name,
    provider: input.provider,
    baseUrl: input.baseUrl,
    apiKey: encryptApiKey(input.apiKey),
    models: input.models,
    enabled: input.enabled,
    capabilities: input.capabilities ?? getDefaultCapabilities(input.provider),
    createdAt: now,
    updatedAt: now,
  }

  config.channels.push(channel)
  writeConfig(config)

  console.log(`[渠道管理] 已创建渠道: ${channel.name} (${channel.id})`)
  return channel
}

/**
 * 更新渠道
 *
 * @param id 渠道 ID
 * @param input 更新数据（apiKey 为明文，空字符串表示不更新）
 * @returns 更新后的渠道
 */
export function updateChannel(id: string, input: ChannelUpdateInput): Channel {
  const config = readConfig()
  const index = config.channels.findIndex((c) => c.id === id)

  if (index === -1) {
    throw new Error(`渠道不存在: ${id}`)
  }

  const existing = config.channels[index]!

  // provider 切换时重置能力为新 provider 默认（除非 input 显式提供 capabilities）；
  // 不切 provider 时保留已有能力。issue #74 code review 反馈
  const targetProvider = input.provider ?? existing.provider
  const providerSwitched = input.provider !== undefined && input.provider !== existing.provider
  const capabilities = input.capabilities
    ?? (providerSwitched ? getDefaultCapabilities(targetProvider) : existing.capabilities)
    ?? getDefaultCapabilities(targetProvider)

  const updated: Channel = {
    ...existing,
    name: input.name ?? existing.name,
    provider: targetProvider,
    baseUrl: input.baseUrl ?? existing.baseUrl,
    apiKey: input.apiKey ? encryptApiKey(input.apiKey) : existing.apiKey,
    models: input.models ?? existing.models,
    enabled: input.enabled ?? existing.enabled,
    capabilities,
    updatedAt: nowMs(),
  }

  config.channels[index] = updated
  writeConfig(config)

  console.log(`[渠道管理] 已更新渠道: ${updated.name} (${updated.id})`)
  return updated
}

/**
 * 删除渠道
 */
export function deleteChannel(id: string): void {
  const config = readConfig()
  const index = config.channels.findIndex((c) => c.id === id)

  if (index === -1) {
    throw new Error(`渠道不存在: ${id}`)
  }

  const removed = config.channels.splice(index, 1)[0]!
  writeConfig(config)

  console.log(`[渠道管理] 已删除渠道: ${removed.name} (${removed.id})`)
}

/**
 * 解密渠道的 API Key
 *
 * 仅在用户需要查看时调用。
 */
export function decryptApiKey(channelId: string): string {
  const config = readConfig()
  const channel = config.channels.find((c) => c.id === channelId)

  if (!channel) {
    throw new Error(`渠道不存在: ${channelId}`)
  }

  return decryptKey(channel.apiKey)
}

/**
 * 校验 API Key 字符合法性
 *
 * HTTP header 必须是 ByteString（code <= 255）。如果 apiKey 里混入了非 ASCII 字符
 * （常见于复制粘贴时误带入中文提示语，如"请填写..."），fetch 会抛出难以诊断的
 * "Cannot convert argument to a ByteString"。这里先预检，给出清晰错误。
 */
function validateApiKeyCharset(apiKey: string): string | null {
  for (let i = 0; i < apiKey.length; i++) {
    const code = apiKey.charCodeAt(i)
    if (code > 127) {
      return t('errors.channelTest.apiKeyNonAscii', {
        pos: i + 1,
        code: code.toString(16).toUpperCase().padStart(4, '0'),
      })
    }
  }
  return null
}

/**
 * 测试渠道连接
 *
 * 向供应商的 API 发送简单请求，验证 API Key 和连接是否有效。
 */
export async function testChannel(channelId: string): Promise<ChannelTestResult> {
  const config = readConfig()
  const channel = config.channels.find((c) => c.id === channelId)

  if (!channel) {
    return { success: false, message: t('errors.channelTest.channelNotFound') }
  }

  const apiKey = decryptKey(channel.apiKey)

  const keyError = validateApiKeyCharset(apiKey)
  if (keyError) {
    return { success: false, message: keyError }
  }

  const proxyUrl = await getEffectiveProxyUrl()

  // 已保存的渠道 → 用 channel 当前启用的第一个模型作 probe，比硬编码更贴近真实使用
  const probeModel = channel.models.find((m) => m.enabled)?.id

  try {
    return await testProviderConnection(channel.provider, channel.baseUrl, apiKey, proxyUrl, probeModel, channel.capabilities?.imageProtocol)
  } catch (error) {
    const message = error instanceof Error ? error.message : t('errors.channelTest.unknownError')
    return { success: false, message: t('errors.channelTest.connectionTestFailed', { message }) }
  }
}

/**
 * 从 provider 错误响应体里抽出可读 message
 *
 * 兼容三种常见 schema：
 * - Anthropic：{ type:"error", error:{ type, message } }
 * - OpenAI 风格：{ error:{ message } } 或 { error:"…" }
 * - 顶层 message：{ message:"…" }
 *
 * 解析失败或字段缺失时，回退到原始文本截断；最终长度上限 200。
 */
function extractProviderErrorMessage(rawText: string): string {
  const text = rawText.trim()
  if (!text) return ''
  const raw = !text.startsWith('{') && !text.startsWith('[')
    ? text
    : (() => {
        try {
          const parsed: unknown = JSON.parse(text)
          if (parsed && typeof parsed === 'object') {
            const obj = parsed as Record<string, unknown>
            const err = obj.error
            if (err && typeof err === 'object') {
              const inner = (err as Record<string, unknown>).message
              if (typeof inner === 'string' && inner.trim()) return inner.trim()
            }
            if (typeof err === 'string' && err.trim()) return err.trim()
            const topMsg = obj.message
            if (typeof topMsg === 'string' && topMsg.trim()) return topMsg.trim()
          }
        } catch {
          // ignore JSON parse failure → 走原始文本
        }
        return text
      })()
  return localizeProviderMessage(raw).slice(0, 200)
}

/**
 * 把 provider 返回的英文常见错误片段替换为 UI 语言版本
 *
 * Why: provider 响应 body 永远是英文，按当前 UI 语言原地替换关键短语让中文用户也能秒懂。
 *      没命中的部分保留原样（截断由调用方控制）。
 */
function localizeProviderMessage(input: string): string {
  if (!input) return input
  const patterns: Array<[RegExp, string]> = [
    [/please carry the api secret key in the ['"]?X-Api-Key['"]? (?:field|header) of the request(?:\s+header)?/gi,
      t('errors.channelTest.providerPattern.carryXApiKey')],
    [/\blogin fail(?:ed|ure)?\b/gi, t('errors.channelTest.providerPattern.loginFail')],
    [/\bauthentication[_ ]error\b/gi, t('errors.channelTest.providerPattern.authenticationError')],
    [/\binvalid[_ ]api[_ ]key\b/gi, t('errors.channelTest.providerPattern.invalidApiKey')],
    [/\bincorrect api key\b/gi, t('errors.channelTest.providerPattern.incorrectApiKey')],
    [/\binvalid bearer token\b/gi, t('errors.channelTest.providerPattern.invalidBearerToken')],
    [/\brate limit(?:[_ ]exceeded)?\b/gi, t('errors.channelTest.providerPattern.rateLimit')],
    [/\binsufficient[_ ]quota\b/gi, t('errors.channelTest.providerPattern.insufficientQuota')],
    [/\bpermission[_ ]denied\b/gi, t('errors.channelTest.providerPattern.permissionDenied')],
    [/\bmodel(?:[_ ]not[_ ]found| does not exist)\b/gi, t('errors.channelTest.providerPattern.modelNotFound')],
  ]
  let out = input
  for (const [re, replacement] of patterns) {
    out = out.replace(re, replacement)
  }
  return out
}

/**
 * 测试 provider 连接（统一走 profile）
 *
 * 端点合法性预检（如 Moonshot OpenAI 端点拦截）由 profile.validateEndpoint 负责；
 * probe model / extra headers / 401 文案定制全部走 profile，channel-manager 不再
 * 对任何 provider 做硬编码分支。
 */
async function testProviderConnection(
  provider: ProviderType,
  baseUrl: string,
  apiKey: string,
  proxyUrl?: string,
  probeModelOverride?: string,
  imageProtocol?: import('@asci/shared').ImageProtocol,
): Promise<ChannelTestResult> {
  if (provider.startsWith('custom-')) {
    if (!probeModelOverride?.trim()) return { success: false, message: t('errors.channelTest.customModelRequired') }
    let request
    try { request = provider === 'custom-image' && imageProtocol && imageProtocol !== 'openai-images' ? buildGeminiImageRequest(baseUrl,apiKey,probeModelOverride,'A small blue circle on a white background.',[],imageProtocol) : buildCustomProbe(provider, baseUrl, apiKey, probeModelOverride) } catch {
      return { success: false, message: t('errors.channelTest.customInvalidUrl') }
    }
    const response = await getFetchFn(proxyUrl)(request.url, { method: 'POST', headers: request.headers, body: request.body, signal: AbortSignal.timeout(provider === 'custom-image' ? 180_000 : 30_000), redirect: 'error' })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      const safeDetail = extractProviderErrorMessage(detail).split(apiKey).join('[redacted]').slice(0, 300)
      return { success: false, message: `${t('errors.channelTest.customRequestFailed', { status: response.status })} ${safeDetail}` }
    }
    const body = await response.json().catch(() => null) as { choices?: unknown[]; content?: unknown[]; data?: Array<{ b64_json?: string; url?: string }>; error?: unknown } | null
    if (provider === 'custom-image') {
      try { imageProtocol && imageProtocol !== 'openai-images' ? parseGeminiImage(body) : parseGeneratedImage(body); return { success: true, message: t('errors.channelTest.success') } }
      catch (error) { return { success: false, message: error instanceof Error ? error.message : t('errors.channelTest.customInvalidResponse') } }
    }
    const valid = body && !body.error && (provider === 'custom-openai' ? Array.isArray(body.choices) && body.choices.length > 0 : Array.isArray(body.content))
    return valid ? { success: true, message: t('errors.channelTest.success') } : { success: false, message: t('errors.channelTest.customInvalidResponse') }
  }
  const profile = getProfile(provider)

  // profile 端点合法性预检（如 Moonshot OpenAI 端点）
  const validation = profile.validateEndpoint?.(baseUrl)
  if (validation && !validation.ok && validation.messageKey) {
    return { success: false, message: t(validation.messageKey) }
  }

  return testAnthropicCompat(profile, baseUrl, apiKey, proxyUrl, probeModelOverride)
}

/**
 * 测试 Anthropic 兼容 API 连接
 *
 * 所有 provider 均使用 Anthropic Messages API。对非原生端点（DeepSeek/MiniMax 等），
 * probe 模型 claude-sonnet-4-5-20250929 往往不存在，会返回业务错误（400/404/500），
 * 这里将"收到响应但非 401"统一视为连接 OK —— 因为鉴权已通过，端点可达。
 *
 * probe model / extra headers / 401 文案由 profile 提供。
 */
async function testAnthropicCompat(
  profile: ReturnType<typeof getProfile>,
  baseUrl: string,
  apiKey: string,
  proxyUrl?: string,
  probeModelOverride?: string,
): Promise<ChannelTestResult> {
  const url = normalizeAnthropicBaseUrl(baseUrl)
  const fetchFn = getFetchFn(proxyUrl)

  const probeModel = probeModelOverride?.trim()
    ? probeModelOverride.trim()
    : profile.defaultProbeModel(baseUrl)

  const headers: Record<string, string> = {
    'x-api-key': apiKey,
    Authorization: `Bearer ${apiKey}`,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
    ...profile.extraHeaders(baseUrl, apiKey),
  }

  const response = await fetchFn(`${url}/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: probeModel,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    }),
  })

  if (response.ok) {
    return { success: true, message: t('errors.channelTest.success') }
  }

  if (response.status === 401) {
    const text = await response.text().catch(() => '')
    // profile 提供自定义 401 文案？（如 Kimi /coding）
    const formatted = profile.formatAuthError?.(baseUrl, extractProviderErrorMessage(text))
    if (formatted) {
      const base = t(formatted.baseMessageKey)
      if (!formatted.detailSnippet) return { success: false, message: base }
      return {
        success: false,
        message: `${base} ${t('errors.channelTest.responseDetail', { detail: formatted.detailSnippet })}`,
      }
    }
    const detail = extractProviderErrorMessage(text)
    return {
      success: false,
      message: detail
        ? t('errors.channelTest.invalidApiKeyWithDetail', { detail })
        : t('errors.channelTest.invalidApiKey'),
    }
  }

  if (response.status === 404) {
    return { success: false, message: t('errors.channelTest.endpointNotFound') }
  }

  // 鉴权已过（非 401），端点可达，视为连通
  return { success: true, message: t('errors.channelTest.success') }
}

// ===== 直接测试连接 =====

/**
 * 直接测试连接（无需已保存渠道）
 *
 * 使用传入的明文凭证直接向提供商发送测试请求。
 * 适用于创建/编辑渠道时用户在保存前先验证连接。
 */
export async function testChannelDirect(input: FetchModelsInput): Promise<ChannelTestResult> {
  const keyError = validateApiKeyCharset(input.apiKey)
  if (keyError) {
    return { success: false, message: keyError }
  }

  const proxyUrl = await getEffectiveProxyUrl()

  try {
    return await testProviderConnection(input.provider, input.baseUrl, input.apiKey, proxyUrl, input.probeModel, input.imageProtocol)
  } catch (error) {
    const message = error instanceof Error ? error.message : t('errors.channelTest.unknownError')
    return { success: false, message: t('errors.channelTest.connectionTestFailed', { message }) }
  }
}

// ===== 模型拉取相关 =====

/**
 * 从供应商 API 拉取可用模型列表
 *
 * 所有 provider 走 profile.fetchModels —— 静态清单 / 远程拉取的差异由 profile 内部决定。
 * 新增 provider 只需扩 ProviderType + profileRegistry，本函数零代码改动。
 */
export async function fetchModels(input: FetchModelsInput): Promise<FetchModelsResult> {
  const keyError = validateApiKeyCharset(input.apiKey)
  if (keyError) {
    return { success: false, message: keyError, models: [] }
  }

  const proxyUrl = await getEffectiveProxyUrl()

  try {
    if (input.provider === 'custom-image' && input.imageProtocol && input.imageProtocol !== 'openai-images') {
      const response = await getFetchFn(proxyUrl)(`${geminiImageBaseUrl(input.baseUrl)}/models`, {headers:{'x-goog-api-key':input.apiKey},redirect:'error',signal:AbortSignal.timeout(30_000)})
      if (!response.ok) return {success:false,message:`HTTP ${response.status}`,models:[]}
      const data=await response.json() as {models?:Array<{name:string;displayName?:string}>}
      return {success:true,message:'Models loaded',models:(data.models ?? []).filter(model=>typeof model.name==='string').map(model=>({id:model.name.replace(/^models\//,''),name:model.displayName ?? model.name,enabled:false}))}
    }
    const profile = getProfile(input.provider)
    return await profile.fetchModels({
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      fetchFn: getFetchFn(proxyUrl),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    console.error('[渠道管理] 拉取模型列表失败:', error)
    return { success: false, message: `拉取模型失败: ${message}`, models: [] }
  }
}

