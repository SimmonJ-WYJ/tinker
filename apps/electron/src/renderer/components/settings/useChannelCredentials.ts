/** 原表单凭据和显式探测；受管模式从不解密或自动发起网络请求。 */
import * as React from 'react'
import { isNativeChannelError } from '@asci/shared'
import type { Channel, ChannelModel, ChannelTestResult, FetchModelsResult, ProviderType, ImageProtocol } from '@asci/shared'
import { useT } from '@/hooks/useT'

interface Props {
  intentFields: unknown[]
  channel: Channel | null
  provider: ProviderType
  baseUrl: string
  apiKey: string
  imageProtocol: ImageProtocol
  models: ChannelModel[]
  setModels: React.Dispatch<React.SetStateAction<ChannelModel[]>>
  setApiKey: React.Dispatch<React.SetStateAction<string>>
  agentChannelId: string | null
  agentModelId: string | null
}
const isStaticManifestProvider = (p: ProviderType) => ['minimax', 'kimi', 'moonshot', 'deepseek'].includes(p)

export function useChannelCredentials({
  channel,
  provider,
  baseUrl,
  apiKey,
  imageProtocol,
  models,
  setModels,
  setApiKey,
  agentChannelId,
  agentModelId,
  intentFields
}: Props) {
  const { t } = useT('settings')
  const { t: tErrors } = useT('errors')
  function probeError(error: unknown, fallback: string): string {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
    return isNativeChannelError(code) ? tErrors(`desktopRuntime.${code}`) : fallback
  }
  const isEdit = channel !== null
  const isCustom = provider.startsWith('custom-')
  const [mode, setMode] = React.useState<'loading' | 'managed' | 'legacy'>('loading')
  const managed = mode === 'managed'
  const ready = mode !== 'loading'
  const [apiKeyLoaded, setApiKeyLoaded] = React.useState(false)
  const [credentialPresent, setCredentialPresent] = React.useState(channel?.hasCredential === true)
  const bindingMatches = channel?.provider === provider && channel.baseUrl.replace(/\/+$/, '') === baseUrl.replace(/\/+$/, '')
  const hasUsableKey = ready && (Boolean(apiKey.trim()) || managed && credentialPresent && bindingMatches)
  const intentSignature = JSON.stringify(intentFields)
  const credentialIntentId = React.useMemo(() => crypto.randomUUID(), [provider, baseUrl, apiKey, models, intentSignature])
  const latestIntent = React.useRef(credentialIntentId)
  latestIntent.current = credentialIntentId
  const fetching = React.useRef(false)
  const testingRef = React.useRef(false)
  React.useEffect(() => {
    let live = true
    const capability = window.electronAPI.getChannelCredentialMode
    Promise.resolve(capability ? capability() : 'legacy' as const).then(async value => {
      if (!live) return
      setMode(value)
      if (value === 'legacy' && channel) {
        try {
          const key = await window.electronAPI.decryptApiKey(channel.id)
          if (live) setApiKey(key)
        } catch { /* 失败保持空输入。 */ }
      }
      if (live) setApiKeyLoaded(true)
    }).catch(() => { /* 能力未知时保持关闭。 */ })
    return () => {
      live = false
    }
  }, [channel, setApiKey])
  const [testing, setTesting] = React.useState(false)
  const [lastTestResult, setTestResult] = React.useState<ChannelTestResult | null>(null)
  const probeModelId = (isEdit && channel?.id === agentChannelId && models.some(m => m.id === agentModelId && m.enabled) ? agentModelId : models.find(m => m.enabled)?.id) ?? ''
  const testIdentity = JSON.stringify([provider, baseUrl, apiKey, isCustom ? probeModelId : '', imageProtocol])
  const probeController = React.useMemo(() => new AbortController(), [testIdentity])
  React.useEffect(() => () => probeController.abort(), [probeController])
  const probeOptions: [] | [{
    signal: AbortSignal
  }] = managed ? [{
    signal: probeController.signal
  }] : []
  const currentIdentity = React.useRef(testIdentity)
  currentIdentity.current = testIdentity
  const requestId = React.useRef(0)
  const [testedIdentity, setTestedIdentity] = React.useState('')
  const testResult = testedIdentity === testIdentity ? lastTestResult : null
  const [fetchingModels, setFetchingModels] = React.useState(false)
  const [fetchResult, setFetchResult] = React.useState<FetchModelsResult | null>(null)
  /** 从供应商 API 拉取可用模型列表 */
  const handleFetchModels = async (): Promise<void> => {
    if (!ready || !hasUsableKey || !baseUrl.trim() || fetching.current) return
    fetching.current = true
    const identity = currentIdentity.current
    setFetchingModels(true)
    setFetchResult(null)
    try {
      const result = await window.electronAPI.fetchModels(managed && !apiKey.trim() && channel ? channel.id : {
        provider,
        baseUrl,
        apiKey,
        imageProtocol,
      }, ...probeOptions)
      if (identity !== currentIdentity.current) return
      if (result.success && result.models.length > 0) {
        // 合并拉取的模型：保留已有模型的启用状态
        // 静态清单（短、精选）尊重 provider 默认 enabled；动态拉取（如 Anthropic /v1/models）一律默认 false 由用户勾选
        const respectProviderDefault = isStaticManifestProvider(provider)
        const existingIds = new Set(models.map((m) => m.id))
        const newModels = result.models
          .filter((m) => !existingIds.has(m.id))
          .map((m) => (respectProviderDefault ? m : {
            ...m,
            enabled: false
          }))
        if (newModels.length > 0) {
          setModels((prev) => [...prev, ...newModels])
        }
        const fetchedCount = result.models.length
        const addedCount = newModels.length
        const totalCount = models.length + newModels.length
        const allFresh = addedCount === fetchedCount && totalCount === fetchedCount
        setFetchResult({
          ...result,
          message: allFresh
            ? t('channelForm.models.fetchSummary', {
              count: fetchedCount
            })
            : t('channelForm.models.fetchSummaryDetailed', {
              count: fetchedCount,
              added: addedCount,
              total: totalCount,
            }),
        })
      } else {
        setFetchResult(result)
      }
    } catch (error) {
      if (identity === currentIdentity.current) setFetchResult({
        success: false,
        message: probeError(error, t('channelForm.models.fetchRequestFailed')),
        models: []
      })
    } finally {
      fetching.current = false
      setFetchingModels(false)
    }
  }
  /**
   * 测试连接（直接使用表单当前值，无需先保存）
   *
   * 可选 override 用于 handleProviderChange 立即触发场景：状态刚被 setState 调度还未生效，
   * 直接用即将切换到的 provider / baseUrl 调用，避免读到旧值。
   * probeModel 优先级：调用时 override > 当前激活 Agent 模型（同 channel）> 第一个 enabled 模型 > 走主进程默认
   */
  const handleTest = async (
    providerOverride?: ProviderType,
    baseUrlOverride?: string,
    probeModelOverride?: string,
  ): Promise<void> => {
    const effectiveProvider = providerOverride ?? provider
    const effectiveBaseUrl = baseUrlOverride ?? baseUrl
    if (!ready || !hasUsableKey || !effectiveBaseUrl.trim() || testingRef.current) return
    testingRef.current = true
    let probeModel: string | undefined = probeModelOverride
    if (!probeModel && isEdit && channel && agentChannelId === channel.id && agentModelId) {
      const stillEnabled = models.find((m) => m.id === agentModelId && m.enabled)
      if (stillEnabled) probeModel = agentModelId
    }
    if (!probeModel) {
      probeModel = models.find((m) => m.enabled)?.id
    }
    const identity = JSON.stringify([effectiveProvider, effectiveBaseUrl, apiKey, effectiveProvider.startsWith('custom-') ? (probeModel ?? '') : '', imageProtocol])
    const thisRequest = ++requestId.current
    setTesting(true)
    // 不清空旧 testResult：连续输入会反复触发 debounce，清空会导致错误条/状态闪烁；
    // 让旧结果停留到新结果到达再原地替换
    try {
      const result = await (managed && !apiKey.trim() && channel ? window.electronAPI.testChannel(channel.id, ...probeOptions) : window.electronAPI.testChannelDirect({
        provider: effectiveProvider,
        baseUrl: effectiveBaseUrl,
        apiKey,
        probeModel,
        imageProtocol,
      }, ...probeOptions))
      if (identity !== currentIdentity.current || thisRequest !== requestId.current) return
      setTestedIdentity(identity)
      setTestResult(result)
      // 测试失败：清空当前 models 与拉取结果，避免用户看到上一轮残留的旧清单
      if (!result.success) {
        if (!isCustom) setModels([])
        setFetchResult(null)
      }
    } catch (error) {
      if (identity !== currentIdentity.current || thisRequest !== requestId.current) return
      setTestedIdentity(identity)
      setTestResult({
        success: false,
        message: probeError(error, t('channelForm.fields.testRequestFailed'))
      })
      if (!isCustom) setModels([])
      setFetchResult(null)
    } finally {
      testingRef.current = false
      setTesting(false)
    }
  }
  /**
   * 测试通过 → 自动拉取模型列表（所有 provider 通用）
   *
   * Why: provider 已被 testProviderConnection 验证可达，此时拉模型不会再被 401 干扰；
   *      静态/动态 provider 走同一个 handleFetchModels 入口，分支由 channel-manager 内部处理。
   *      统一逻辑取代旧的"Anthropic-only 拉取"effect 与"静态 provider 在 handleProviderChange 内立即拉"分支。
   */
  React.useEffect(() => {
    if (!ready || managed || !testResult?.success) return
    if (models.length > 0) return
    if (!apiKey.trim() && !isStaticManifestProvider(provider)) return
    if (!baseUrl.trim()) return
    const timer = setTimeout(() => {
      void handleFetchModels()
    }, 200)
    return () => clearTimeout(timer)
    // handleFetchModels 故意不进 deps：每次渲染新引用，effect 内已用 models.length / testResult?.success 守门
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, managed, provider, apiKey, baseUrl, models.length, testResult?.success])
  /**
   * 自动测试连接：apiKey + baseUrl 都填好后 debounce 1.5s 触发 handleTest
   *
   * Why: 把"测试连接"按钮从必点操作转为可选；用户填完凭证就能看到验证结果，
   *      也让"测试未通过则禁止创建"的守门可以自然解锁。每次 provider/apiKey/baseUrl 变化重新 debounce。
   */
  React.useEffect(() => {
    if (!ready || managed || provider === 'custom-image') return
    if (!apiKey.trim() || !baseUrl.trim()) return
    if (isCustom && !models.some(m => m.enabled)) return
    const timer = setTimeout(() => {
      void handleTest()
    }, 1500)
    return () => clearTimeout(timer)
    // handleTest 故意不进 deps：每次渲染新引用，effect 内已通过 trim 守门
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, managed, provider, apiKey, baseUrl, isCustom, isCustom ? models.find(m => m.enabled)?.id : undefined])
  const acknowledge = React.useCallback((acceptedIntent: string) => {
    if (!managed) return true
    setCredentialPresent(true)
    if (acceptedIntent !== latestIntent.current) return false
    setApiKey('')
    setTestResult(null)
    setTestedIdentity('')
    return true
  }, [managed, setApiKey])
  return {
    acknowledge,
    managed,
    ready,
    apiKeyLoaded,
    hasUsableKey,
    testing,
    testResult,
    fetchingModels,
    fetchResult,
    probeModelId,
    requestId,
    setTestResult,
    setTestedIdentity,
    setFetchResult,
    testedIdentity,
    handleTest,
    handleFetchModels,
    credentialIntentId
  }
}
