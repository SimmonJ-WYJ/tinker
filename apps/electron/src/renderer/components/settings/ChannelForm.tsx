import { addQuickModels, type ProviderDraft } from '@/lib/channel-drafts'
import { useChannelCredentials } from './useChannelCredentials'
import { ChannelModels } from './ChannelModels'
import { ChannelProviderMark, getChannelProtocolLabel } from './ChannelProviderMark'
import './channel-form.css'
/**
 * ChannelForm - 模型配置编辑表单
 *
 * 支持创建和编辑模型配置，包含：
 * - 基本信息（名称、供应商、Base URL、API Key）
 * - 模型列表：搜索、拉取、自定义添加、勾选启用
 * - 连接测试
 *
 * 编辑模式下修改即时保存（auto-save），创建模式仍需手动提交。
 */

import * as React from 'react'
import {
  ArrowLeft,
  ChevronRight,
  AlertTriangle,
  Eye,
  EyeOff,
  Loader2,
  CheckCircle2,
  XCircle,
  Zap,
  Check,
} from 'lucide-react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  PROVIDER_DEFAULT_URLS,
  PROVIDER_LABELS,
  isModelEnabledInChannel,
  reconcileActiveModel,
} from '@asci/shared'
import { normalizeOpenAIBaseUrl, getDefaultCapabilities, geminiImageBaseUrl } from '@asci/core'
import type {
  Channel,
  ChannelCreateInput,
  ImageProtocol,
  ChannelModel,
  ChannelTestResult,
  ProviderType,
} from '@asci/shared'
import {
  agentChannelIdAtom,
  agentModelIdAtom,
  agentSessionModelMapAtom,
} from '@/atoms/agent-atoms'
import { channelsAtom } from '@/atoms/channels-atoms'
import {
  SettingsInput,
  SettingsSelect,
  SettingsToggle,
} from './primitives'
import { useT } from '@/hooks/useT'

interface ChannelFormProps {
  /** 编辑模式下传入已有渠道，创建模式传 null */
  channel: Channel | null
  onSaved: () => void
  onCancel: () => void
}

/** 所有可选供应商（全部走 Anthropic 兼容端点；OpenRouter 走其 "Anthropic Skin"） */
const PROVIDER_OPTIONS: ProviderType[] = ['anthropic', 'minimax', 'kimi', 'moonshot', 'deepseek', 'openrouter', 'glm', 'custom-anthropic', 'custom-openai', 'custom-image']

/**
 * 从 Base URL 域名推断 provider —— 用户填了官方端点就能自动定位
 *
 * API Key 格式上多家共用 sk- 前缀无法可靠识别，唯有 baseUrl 域名是稳定信号。
 */
function guessProviderFromBaseUrl(url: string): ProviderType | null {
  const u = url.toLowerCase()
  if (u.includes('anthropic.com')) return 'anthropic'
  if (u.includes('deepseek.com')) return 'deepseek'
  if (u.includes('moonshot.cn') || u.includes('moonshot.ai')) return 'moonshot'
  if (u.includes('minimaxi.com') || u.includes('minimax.io')) return 'minimax'
  if (u.includes('kimi.com')) return 'kimi'
  if (u.includes('bigmodel.cn') || u.includes('zhipu')) return 'glm'
  return null
}

/**
 * 从 API Key 推断 provider —— 仅 Anthropic 的 sk-ant- 前缀是稳定特征
 */
function guessProviderFromApiKey(key: string): ProviderType | null {
  if (key.startsWith('sk-ant-')) return 'anthropic'
  return null
}

/** 供应商选项（用于 SettingsSelect）——按显示名 a-z 排序 */
const PROVIDER_SELECT_OPTIONS = PROVIDER_OPTIONS.map((p) => ({
  value: p,
  label: PROVIDER_LABELS[p],
})).sort((a, b) => a.label.localeCompare(b.label))

/**
 * 生成 API 端点预览 URL
 *
 * 所有 provider 统一使用 Anthropic Messages API：补齐 /v1，末尾拼 /messages。
 */
function buildPreviewUrl(baseUrl: string, provider: ProviderType): string {
  if (provider === 'custom-image') return `${normalizeOpenAIBaseUrl(baseUrl)}/images/generations`
  if (provider === 'custom-openai') return `${normalizeOpenAIBaseUrl(baseUrl)}/chat/completions`
  let trimmed = baseUrl.trim().replace(/\/+$/, '')
  trimmed = trimmed.replace(/\/messages$/, '')
  if (trimmed.match(/\/v\d+$/)) {
    return `${trimmed}/messages`
  }
  return `${trimmed}/v1/messages`
}

/** 图片配置独立保存时仍校验 HTTP(S) 地址，不以付费请求代替格式校验。 */
function validImageBaseUrl(value: string): boolean {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname) }
  catch { return false }
}

/** auto-save 防抖延迟 */
const AUTO_SAVE_DELAY = 600

export function ChannelForm({ channel, onSaved, onCancel }: ChannelFormProps): React.ReactElement {
  const { t } = useT('settings')
  const isEdit = channel !== null

  // 激活渠道/模型相关 atoms — 用于 auto-save 后的 reconcile（issue #62）
  const agentChannelId = useAtomValue(agentChannelIdAtom)
  const [agentModelId, setAgentModelId] = useAtom(agentModelIdAtom)
  const setSessionModelMap = useSetAtom(agentSessionModelMapAtom)
  const setGlobalChannels = useSetAtom(channelsAtom)

  // 表单状态
  const [name, setName] = React.useState(channel?.name ?? '')
  const [provider, setProvider] = React.useState<ProviderType>(channel?.provider ?? 'anthropic')
  const [baseUrl, setBaseUrl] = React.useState(channel?.baseUrl ?? PROVIDER_DEFAULT_URLS.anthropic)
  const [apiKey, setApiKey] = React.useState('')
  const [imageProtocol,setImageProtocol] = React.useState<ImageProtocol>(channel?.capabilities?.imageProtocol ?? 'openai-images')
  const [imageQualityPriority,setImageQualityPriority] = React.useState(channel?.capabilities?.imageQualityPriority ?? 0)
  const [imageMaxReferences,setImageMaxReferences] = React.useState(channel?.capabilities?.imageMaxReferences ?? 4)
  const isCustom = provider.startsWith('custom-')
  const [showApiKey, setShowApiKey] = React.useState(false)
  const apiKeyId = React.useId()
  const [models, setModels] = React.useState<ChannelModel[]>(channel?.models ?? [])
  const [enabled, setEnabled] = React.useState(channel?.enabled ?? true)
  // 是否支持 PDF document content block（覆盖 provider 默认能力，见 #74）
  const [supportsPdfDocumentBlock, setSupportsPdfDocumentBlock] = React.useState(
    channel?.capabilities?.supportsPdfDocumentBlock
      ?? getDefaultCapabilities(channel?.provider ?? 'anthropic').supportsPdfDocumentBlock,
  )

  // 新模型输入
  const [newModelId, setNewModelId] = React.useState('')
  const [newModelName, setNewModelName] = React.useState('')
  /** 提示用户填错（如把 API Key 误填到模型 ID 框） */
  const [addModelError, setAddModelError] = React.useState<string | null>(null)
  /** 手动添加自定义模型区：默认折叠，仅在用户主动点入口时展开（低频场景） */
  const [showCustomInput, setShowCustomInput] = React.useState(Boolean(channel?.provider.startsWith('custom-') && !channel.models.length))

  // UI 状态
  const [saving, setSaving] = React.useState(false)
  const savingRef = React.useRef(false)
  const credentials = useChannelCredentials({channel,provider,baseUrl,apiKey,imageProtocol,models,setModels,setApiKey,agentChannelId,agentModelId,intentFields:[name,enabled,supportsPdfDocumentBlock,imageProtocol,imageQualityPriority,imageMaxReferences]})
  const {acknowledge,credentialIntentId,managed,ready,apiKeyLoaded,hasUsableKey,testing,testResult,fetchingModels,fetchResult,probeModelId,requestId,setTestResult,setTestedIdentity,setFetchResult,testedIdentity,handleTest,handleFetchModels} = credentials
  React.useEffect(() => {
    if (managed && !isEdit && provider === 'anthropic') { setProvider('custom-openai'); setBaseUrl('') }
  }, [managed, isEdit, provider])
  /** auto-save 状态指示 */
  const [autoSaveStatus, setAutoSaveStatus] = React.useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  // ===== Auto-save（仅编辑模式） =====
  const autoSaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 初始化完成标志，避免加载时触发 auto-save */
  const initializedRef = React.useRef(false)
  /** 持有最新 testResult 引用，供 doAutoSave 在 debounce 触发时实时判断（state 闭包过期） */
  const testResultRef = React.useRef<ChannelTestResult | null>(null)
  React.useEffect(() => { testResultRef.current = testResult }, [testResult])

  /** 执行 auto-save */
  const doAutoSave = React.useCallback(async (
    currentModels: ChannelModel[],
    currentName: string,
    currentProvider: ProviderType,
    currentBaseUrl: string,
    currentApiKey: string,
    currentEnabled: boolean,
    currentSupportsPdfDocumentBlock: boolean,
    explicit = false,
  ) => {
    if (!isEdit || !channel || !ready || (managed && !explicit)) return
    // 基本信息不完整：name / apiKey / baseUrl 任一空 → 跳过，避免把残缺态覆盖原配置
    if (!currentName.trim() || !(managed ? hasUsableKey : currentApiKey.trim()) || !currentBaseUrl.trim() || currentProvider === 'custom-image' && !validImageBaseUrl(currentBaseUrl)) {
      setAutoSaveStatus('idle')
      return
    }
    // 测试连接未通过时跳过：避免把无效凭证/坏 baseUrl 持久化覆盖原有可用配置
    if (currentProvider !== 'custom-image' && ((currentProvider.startsWith('custom-') && !testResultRef.current?.success) || (testResultRef.current && !testResultRef.current.success))) {
      setAutoSaveStatus('idle')
      return
    }
    setAutoSaveStatus('saving')
    try {
      await window.electronAPI.updateChannel(channel.id, {
        ...(managed ? {credentialIntentId: credentialIntentId} : {}),
        name: currentName,
        provider: currentProvider,
        baseUrl: currentBaseUrl,
        apiKey: currentApiKey || undefined,
        models: currentModels,
        enabled: currentEnabled,
        capabilities: { ...channel.capabilities, supportsPdfDocumentBlock: currentSupportsPdfDocumentBlock, imageProtocol, imageQualityPriority, imageMaxReferences },
      })
      const acknowledgedIntent = acknowledge(credentialIntentId)
      setAutoSaveStatus('saved')
      setTimeout(() => setAutoSaveStatus('idle'), 1500)

      // 持久化成功后：刷新全局 channels 缓存，并对当前激活模型做 reconcile（issue #62）
      // 仅在编辑的是 "Agent 当前激活的渠道" 时介入；否则只需刷新缓存
      try {
        const fresh = await window.electronAPI.listChannels()
        setGlobalChannels(fresh)

        if (agentChannelId === channel.id) {
          const updated = fresh.find((c) => c.id === channel.id) ?? null
          const result = reconcileActiveModel(updated, agentModelId)
          if (result.changed) {
            setAgentModelId(result.modelId)
            // 清理 per-session map：把指向已禁用模型的条目改成 fallback（或删除）
            setSessionModelMap((prev) => {
              let mutated = false
              const next = new Map(prev)
              for (const [sid, mid] of prev) {
                if (!isModelEnabledInChannel(updated, mid)) {
                  if (result.modelId) next.set(sid, result.modelId)
                  else next.delete(sid)
                  mutated = true
                }
              }
              return mutated ? next : prev
            })
            await window.electronAPI
              .updateSettings({ agentModelId: result.modelId ?? undefined })
              .catch((err) => console.error('[模型配置表单] 回写 agentModelId 失败:', err))

            if (result.valid && result.modelName) {
              toast.success(t('channelForm.modelFallback.switched', { name: result.modelName }))
            } else {
              toast.warning(t('channelForm.modelFallback.cleared'))
            }
          }
        }
      } catch (err) {
        // reconcile 是一个增强行为，失败时不影响 auto-save 主路径
        console.error('[模型配置表单] auto-save 后 reconcile 失败:', err)
      }
      return acknowledgedIntent
    } catch (error) {
      console.error('[模型配置表单] auto-save 失败:', error)
      setAutoSaveStatus('error')
      if (managed && error instanceof Error) toast.error(error.message)
      return false
    }
  }, [ready, managed, hasUsableKey, credentialIntentId, acknowledge, isEdit, channel, agentChannelId, agentModelId, setAgentModelId, setSessionModelMap, setGlobalChannels, t, imageProtocol, imageQualityPriority, imageMaxReferences])

  /** 触发防抖 auto-save */
  const scheduleAutoSave = React.useCallback((
    nextModels: ChannelModel[],
    nextName: string,
    nextProvider: ProviderType,
    nextBaseUrl: string,
    nextApiKey: string,
    nextEnabled: boolean,
    nextSupportsPdfDocumentBlock: boolean,
  ) => {
    if (managed || !ready || !isEdit || !initializedRef.current) return
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => {
      doAutoSave(
        nextModels,
        nextName,
        nextProvider,
        nextBaseUrl,
        nextApiKey,
        nextEnabled,
        nextSupportsPdfDocumentBlock,
      )
    }, AUTO_SAVE_DELAY)
  }, [managed, ready, isEdit, doAutoSave])

  // API Key 加载完成后标记初始化
  React.useEffect(() => {
    if (isEdit && apiKeyLoaded) {
      // 延迟标记，避免加载时触发
      const t = setTimeout(() => { initializedRef.current = true }, 100)
      return () => clearTimeout(t)
    }
    if (!isEdit) {
      initializedRef.current = true
    }
  }, [isEdit, apiKeyLoaded])

  // 监听字段变化触发 auto-save
  React.useEffect(() => {
    scheduleAutoSave(models, name, provider, baseUrl, apiKey, enabled, supportsPdfDocumentBlock)
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current) }
  }, [models, name, provider, baseUrl, apiKey, enabled, supportsPdfDocumentBlock, scheduleAutoSave, testResult?.success, testedIdentity])

  /** 用户是否主动在下拉里选过 provider —— 一旦选过就锁定，自动识别不再覆盖 */
  const userPickedProviderRef = React.useRef(false)

  /**
   * 切换供应商：同步默认 Base URL + 能力，清空 models 与上次测试结果，触发立即测试
   *
   * Why: provider 决定了端点协议与模型 ID 命名空间，旧 models 不再适用；测试通过后由
   *      统一的"成功 → 拉取"effect 接管，避免静态/动态 provider 分支逻辑分裂。
   */
  const providerDrafts = React.useRef(new Map<ProviderType, ProviderDraft>())

  const handleProviderChange = (newProvider: string): void => {
    const p = newProvider as ProviderType
    if (p === provider) return
    userPickedProviderRef.current = true
    providerDrafts.current.set(provider, {baseUrl, apiKey, models, supportsPdfDocumentBlock, imageProtocol, imageQualityPriority, imageMaxReferences, newModelId, newModelName})
    const draft = providerDrafts.current.get(p)
    requestId.current += 1
    setProvider(p)
    setBaseUrl(draft?.baseUrl ?? PROVIDER_DEFAULT_URLS[p])
    setApiKey(draft?.apiKey ?? '')
    setModels(draft?.models ?? [])
    setSupportsPdfDocumentBlock(draft?.supportsPdfDocumentBlock ?? getDefaultCapabilities(p).supportsPdfDocumentBlock)
    setImageProtocol(draft?.imageProtocol ?? 'openai-images')
    setImageQualityPriority(draft?.imageQualityPriority ?? 0)
    setImageMaxReferences(draft?.imageMaxReferences ?? 4)
    setNewModelId(draft?.newModelId ?? '')
    setNewModelName(draft?.newModelName ?? '')
    setTestResult(null)
    setTestedIdentity('')
    setFetchResult(null)
    setShowCustomInput(p.startsWith('custom-'))

  }

  /**
   * 自动识别 provider：仅新建模式 + 用户未在下拉手动选过
   *
   * 优先级：API Key 前缀 (sk-ant-) > Base URL 域名匹配
   * 命中 API Key 时连带覆盖 baseUrl 为默认值；命中 baseUrl 时只切 provider 不动用户已填的 URL。
   * 切换后由统一的 auto-test debounce 接力测试 → 测试通过自动拉模型。
   */
  React.useEffect(() => {
    if (!ready || managed || isEdit) return
    if (userPickedProviderRef.current || isCustom) return

    const fromKey = guessProviderFromApiKey(apiKey)
    if (fromKey && fromKey !== provider) {
      setProvider(fromKey)
      setBaseUrl(PROVIDER_DEFAULT_URLS[fromKey])
      setTestResult(null)
      setModels([])
      return
    }

    const fromUrl = guessProviderFromBaseUrl(baseUrl)
    if (fromUrl && fromUrl !== provider) {
      setProvider(fromUrl)
      setTestResult(null)
      setModels([])
    }
  }, [ready, managed, isEdit, apiKey, baseUrl, provider])

  /** 添加模型 */
  const handleAddModel = (): void => {
    if (!newModelId.trim()) return

    try {
      const next = addQuickModels(models, newModelId, newModelName)
      setModels(next)
      setAddModelError(null)
      setNewModelId('')
      setNewModelName('')
    } catch (error) {
      setAddModelError(t(error instanceof Error && error.message === 'apiKey' ? 'channelForm.models.addLooksLikeApiKey' : 'channelForm.models.invalidModelIds'))
    }
  }

  /** 切换模型启用状态（点击可用模型 → 启用，点击已启用模型 → 禁用） */
  const handleToggleModel = (modelId: string): void => {
    setModels((prev) =>
      prev.map((m) => (m.id === modelId ? { ...m, enabled: !m.enabled } : m))
    )
  }

  /** 创建渠道（仅新建模式） */
  const handleCreate = async (): Promise<void> => {
    if (!name.trim() || !apiKey.trim() || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      const input: ChannelCreateInput = {
        ...(managed ? {credentialIntentId: credentialIntentId} : {}),
        name,
        provider,
        baseUrl,
        apiKey,
        models,
        enabled,
        capabilities: { supportsPdfDocumentBlock, imageProtocol, imageQualityPriority, imageMaxReferences },
      }
      await window.electronAPI.createChannel(input)
      if (acknowledge(credentialIntentId)) onSaved()
    } catch (error) {
      console.error('[模型配置表单] 创建失败:', error)
      if (managed && error instanceof Error) toast.error(error.message)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  // ===== 模型列表 =====
  const enabledModelCount = models.filter((m) => m.enabled).length
  /**
   * "创建"按钮的守门项 —— 新建/编辑共用一套逻辑
   * 顺序：配置名 → API Key → Base URL → 启用模型 → 连接测试通过
   * 返回 null 表示一切就绪，按钮可点。
   */
  const submitMissing: string | null = !ready ? t('channelForm.fields.credentialLoading') : !name.trim()
    ? t('channelForm.createTooltip.noName')
    : !hasUsableKey
      ? t('channelForm.createTooltip.noKey')
      : !baseUrl.trim()
        ? t('channelForm.createTooltip.noBaseUrl')
      : provider === 'custom-image' && !validImageBaseUrl(baseUrl)
        ? t('channelForm.createTooltip.invalidUrl')
      : enabledModelCount === 0
        ? t('channelForm.createTooltip.noEnabledModel')
        : provider !== 'custom-image' && !testResult?.success
          ? t('channelForm.createTooltip.testNotPassed')
          : null

  const protocolLabel = getChannelProtocolLabel(provider, imageProtocol) ?? PROVIDER_LABELS[provider]

  return (
    <div className="channel-form mx-auto w-full">
      {/* 标题栏 - sticky 吸顶，确保新建模式的「创建」按钮始终可见 */}
      <div className="sticky top-0 z-10 -mx-6 -mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/70 bg-muted/45 px-6 py-2.5 backdrop-blur-md">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t('channelForm.fields.back')}
          disabled={saving}
          onClick={() => { isEdit ? onSaved() : onCancel() }}
        >
          <ArrowLeft size={18} className="!size-[18px]" />
        </Button>
        <h3 className="min-w-28 flex-1 text-sm font-semibold text-foreground">
          {isEdit ? t('channelForm.title.edit') : t('channelForm.title.create')}
        </h3>
        {/* 编辑模式：auto-save 状态指示 + 创建按钮（与新建共用同一 missing 守门，未满足时灰显） */}
        {isEdit && (
          <>
            {submitMissing && <span className="max-w-48 text-xs text-muted-foreground" role="status">{submitMissing}</span>}
            <span className={cn(
              'flex items-center justify-end gap-1.5 text-xs',
              autoSaveStatus === 'error' ? 'text-destructive' : 'text-muted-foreground',
              autoSaveStatus === 'idle' && 'hidden',
            )}>
              {autoSaveStatus === 'saving' && <Loader2 size={12} className="animate-spin" />}
              {autoSaveStatus === 'saved' && <Check size={12} className="text-success" />}
              {autoSaveStatus === 'error' && <XCircle size={12} />}
              <span>
                {autoSaveStatus === 'saving'
                  ? t('channelForm.autoSave.saving')
                  : autoSaveStatus === 'saved'
                    ? t('channelForm.autoSave.saved')
                    : t('channelForm.autoSave.error')}
              </span>
            </span>
            <Button
              size="sm"
              className="settings-channel-primary"
              onClick={async () => {
                if (savingRef.current) return
                savingRef.current = true
                if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
                setSaving(true)
                try {
                  if (await doAutoSave(models, name, provider, baseUrl, apiKey, enabled, supportsPdfDocumentBlock, true)) onSaved()
                } finally { savingRef.current = false; setSaving(false) }
              }}
              disabled={saving || submitMissing !== null}
              title={submitMissing ?? undefined}
            >
              <span>{t('channelForm.save')}</span>
            </Button>
          </>
        )}
        {/* 新建模式：创建按钮 —— 任一守门未达成 disable，按钮左侧实时提示缺什么 */}
        {!isEdit && (
          <>
            {submitMissing && (
              <span className="max-w-48 text-xs text-warning">
                {submitMissing}
              </span>
            )}
            <Button
              size="sm"
              className="settings-channel-primary"
              onClick={handleCreate}
              disabled={saving || submitMissing !== null}
              title={submitMissing ?? undefined}
            >
              {saving && <Loader2 size={14} className="animate-spin !size-3.5" />}
              <span>{t('channelForm.create')}</span>
            </Button>
          </>
        )}
      </div>

      {isEdit && (
        <div className="flex items-center gap-3 border-b border-border/70 py-3.5">
          <ChannelProviderMark provider={provider} imageProtocol={imageProtocol} />
          <div className="min-w-0 truncate text-lg font-semibold" title={name}>{name || channel?.name}</div>
          <span className="min-w-0 truncate rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">{protocolLabel}</span>
        </div>
      )}
      <section aria-label={t('channelForm.section.basicInfo')} className="space-y-3.5 py-4">
        <h4 className="text-sm font-semibold">{t('channelForm.section.basicInfo')}</h4>
        <div className="grid gap-3.5 min-[900px]:grid-cols-2">
          <SettingsInput
            className="min-w-0 p-0"
            label={t('channelForm.fields.name')}
            value={name}
            onChange={setName}
            disabled={managed && saving}
            placeholder={t('channelForm.fields.namePlaceholder')}
            required={!isEdit}
          />
          <SettingsSelect
            className="min-w-0 p-0"
            label={t('channelForm.fields.providerLabel')}
            value={provider}
            onValueChange={handleProviderChange}
            disabled={managed && saving}
            options={PROVIDER_SELECT_OPTIONS.filter(option => !managed || ['custom-openai','custom-anthropic'].includes(option.value)).map(option => ({ ...option, label: option.value === 'custom-image' ? t('channelForm.fields.customImage') : option.value === 'custom-anthropic' ? t('channelForm.fields.customAnthropic') : option.value === 'custom-openai' ? t('channelForm.fields.customOpenai') : option.label }))}
            placeholder={t('channelForm.fields.providerPlaceholder')}
          />
        </div>
        <SettingsInput
          className={cn('p-0', !baseUrl.trim() && 'channel-form-empty-url')}
          label={t('channelForm.fields.baseUrl')}
          value={baseUrl}
          onChange={setBaseUrl}
          disabled={managed && saving}
          placeholder={t('channelForm.fields.baseUrlPlaceholder')}
          description={baseUrl.trim() ? t('channelForm.fields.previewUrl', { url: provider === 'custom-image' && imageProtocol !== 'openai-images' ? `${safeGeminiPreview(baseUrl)}/${imageProtocol === 'gemini-interactions' ? 'interactions' : `models/${probeModelId}:generateContent`}` : buildPreviewUrl(baseUrl, provider) }) : t('channelForm.fields.baseUrlEmptyHint')}
          descriptionAfterInput
          required
        />
        {provider === 'custom-image' && (
          <SettingsSelect
            className="p-0"
            label={t('channelForm.fields.imageProtocol')}
            value={imageProtocol}
            onValueChange={(value) => setImageProtocol(value as ImageProtocol)}
            options={[
              { value: 'openai-images', label: 'OpenAI Images' },
              { value: 'gemini-content', label: 'Gemini · generateContent' },
              { value: 'gemini-interactions', label: 'Gemini · Interactions' },
            ]}
          />
        )}
        {/* API Key —— 自动测连接 effect 在凭证变化后 1.5s debounce 跑；这里保留"测试连接"按钮供用户立即重测 */}
        <div className="space-y-2">
          <label htmlFor={apiKeyId} className="block text-sm font-medium text-foreground">
            {t('channelForm.fields.apiKey')}
            {!isEdit && <span aria-hidden="true" className="ml-0.5 text-destructive">*</span>}
          </label>
          <div className="flex flex-wrap items-center gap-2.5 min-[761px]:flex-nowrap">
            <div className="relative min-w-0 flex-1 max-[760px]:basis-full">
              <Input
                id={apiKeyId}
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                disabled={managed && saving}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={managed && isEdit ? t('channelForm.fields.managedKeyPlaceholder') : isEdit ? t('channelForm.fields.apiKeyEditPlaceholder') : t('channelForm.fields.apiKeyCreatePlaceholder')}
                required={!isEdit}
                className="pr-10"
              />
              <Button
                type="button"
                variant="subtle"
                size="icon-sm"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 size-auto -translate-y-1/2 p-1"
                aria-label={t(showApiKey ? 'channelForm.fields.hideKey' : 'channelForm.fields.showKey')}
              >
                {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </Button>
            </div>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => { void handleTest() }}
              disabled={testing || !hasUsableKey || !baseUrl.trim()}
              className="h-9 border border-border/80 bg-background text-xs hover:bg-muted max-[760px]:w-full"
            >
              {testing ? (
                <Loader2 size={12} className="animate-spin !size-3" />
              ) : (
                <Zap size={12} className="!size-3" />
              )}
              <span>{t(provider === 'custom-image' ? 'channelForm.fields.testImage' : 'channelForm.fields.testConnection')}</span>
            </Button>
          </div>
          {managed && isEdit && <p className="text-sm text-muted-foreground">{t('channelForm.fields.managedKeyNotice')}</p>}
          {provider === 'custom-image' && <p className="text-sm text-muted-foreground">{t('channelForm.fields.imageTestNotice')}</p>}
          {/* Provider 与 Key 前缀不匹配 —— 仅对 Anthropic（sk-ant- 是唯一稳定特征） */}
          {provider === 'anthropic' && apiKey.trim().length >= 20 && !apiKey.startsWith('sk-ant-') && (
            <p className="flex items-start gap-1.5 text-xs text-warning">
              <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
              <span>{t('channelForm.fields.apiKeyMismatchAnthropic')}</span>
            </p>
          )}
          {testResult && (
            <div role="status" aria-live="polite" className={cn(
              'flex items-start gap-1.5 py-0.5 text-xs',
              testResult.success ? 'text-success' : 'text-destructive'
            )}>
              {testResult.success ? <CheckCircle2 size={12} className="mt-0.5 flex-shrink-0" /> : <XCircle size={12} className="mt-0.5 flex-shrink-0" />}
              <span>{testResult.message}</span>
            </div>
          )}
        </div>
      </section>
      <section aria-label={t('channelForm.section.models')} className="border-y border-border/70 py-4">
          <ChannelModels
            models={models}
            isCustom={isCustom}
            isEdit={isEdit}
            testResult={testResult}
            fetchResult={fetchResult}
            fetchingModels={fetchingModels}
            baseUrl={baseUrl}
            apiKey={apiKey}
            hasUsableKey={hasUsableKey}
            locked={managed && saving}
            enabledModelCount={enabledModelCount}
            handleFetchModels={handleFetchModels}
            handleToggleModel={handleToggleModel}
            showCustomInput={showCustomInput}
            setShowCustomInput={setShowCustomInput}
            addModelError={addModelError}
            setAddModelError={setAddModelError}
            newModelId={newModelId}
            setNewModelId={setNewModelId}
            newModelName={newModelName}
            setNewModelName={setNewModelName}
            handleAddModel={handleAddModel}
          />
      </section>
      <details className="group mt-3 rounded-lg border border-border/70">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2.5 text-xs font-medium hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <ChevronRight size={14} className="text-muted-foreground group-open:rotate-90" aria-hidden="true" />
          {t('channelForm.section.miscSettings')}
        </summary>
        <div className="border-t border-border/70">
          {provider === 'custom-image' ? <>
            <SettingsSelect label={t('channelForm.fields.imagePriority')} value={String(imageQualityPriority)} onValueChange={value=>setImageQualityPriority(Number(value))} options={[
              {value:'0',label:t('channelForm.fields.imageStandard')}, {value:'10',label:t('channelForm.fields.imagePreferred')},
            ]} />
            <SettingsSelect label={t('channelForm.fields.imageReferences')} value={String(imageMaxReferences)} onValueChange={value=>setImageMaxReferences(Number(value))} options={[0,1,2,3,4].map(value=>({value:String(value),label:String(value)}))} />
          </> : (
            <SettingsToggle
              label={t('channelForm.fields.supportsPdfDocumentBlockLabel')}
              description={t('channelForm.fields.supportsPdfDocumentBlockDescription')}
              checked={supportsPdfDocumentBlock}
              disabled={managed && saving}
              onCheckedChange={setSupportsPdfDocumentBlock}
            />
          )}
        </div>
      </details>
    </div>
  )
}

function safeGeminiPreview(url: string): string {
  try { return geminiImageBaseUrl(url) } catch { return url }
}
