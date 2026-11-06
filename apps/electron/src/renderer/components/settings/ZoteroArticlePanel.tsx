/**
 * 设置 → Zotero → 段落总结增强（article.md 生成器）
 *
 * 实验功能：开关默认关闭。开启后由 main 端 worker 在 PDF 解析完成后自动生成
 * `~/.asci/zotero/wiki/{key}.article.md`，含 frontmatter + 段落级 LLM 总结。
 *
 * 仅展示状态摘要 + 失败 5 条 + 重试入口；不暴露按 record 单点重试。
 */

import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { Loader2, RefreshCw, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { channelsAtom } from '@/atoms/channels-atoms'
import {
  zoteroArticleConfigAtom,
  zoteroArticleStatusAtom,
} from '@/atoms/zotero-article-atoms'
import { useT } from '@/hooks/useT'
import { SettingsCard, SettingsRow, SettingsSection, SettingsModuleRow } from './primitives'

const NULL_CHANNEL_VALUE = '__default__'

export function ZoteroArticlePanel(): React.ReactElement {
  const { t } = useT('settings')
  const [config, setConfig] = useAtom(zoteroArticleConfigAtom)
  const [status, setStatus] = useAtom(zoteroArticleStatusAtom)
  const channels = useAtomValue(channelsAtom)
  const [busy, setBusy] = React.useState(false)
  const [retrying, setRetrying] = React.useState(false)
  const [regenerating, setRegenerating] = React.useState(false)

  // 初始化 + 订阅状态推送
  React.useEffect(() => {
    void (async () => {
      try {
        const [c, s] = await Promise.all([
          window.electronAPI.zotero.article.getConfig(),
          window.electronAPI.zotero.article.getStatus(),
        ])
        setConfig(c)
        setStatus(s)
      } catch (err) {
        console.warn('[Zotero Article] 初始化失败:', err)
      }
    })()
    const unsub = window.electronAPI.zotero.article.onStatusChanged(setStatus)
    return unsub
  }, [setConfig, setStatus])

  const enabledChannels = React.useMemo(() => channels.filter(c => c.enabled), [channels])
  const selectedChannel = React.useMemo(
    () => enabledChannels.find(c => c.id === config.channelId) ?? null,
    [enabledChannels, config.channelId],
  )
  const enabledModels = selectedChannel
    ? selectedChannel.models.filter(m => m.enabled)
    : []

  const handleToggle = async (next: boolean): Promise<void> => {
    setBusy(true)
    try {
      const updated = await window.electronAPI.zotero.article.setConfig({ enabled: next })
      setConfig(updated)
      const summary = await window.electronAPI.zotero.article.getStatus()
      setStatus(summary)
      if (next) {
        toast.success(t('zotero.article.toast.enabled'))
      } else {
        toast.info(t('zotero.article.toast.disabled'))
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(t('zotero.article.toast.updateFailed'), { description: msg })
    } finally {
      setBusy(false)
    }
  }

  const handleChannelChange = async (value: string): Promise<void> => {
    setBusy(true)
    try {
      const next = value === NULL_CHANNEL_VALUE ? null : value
      // 切换渠道时清空已选 model（新渠道未必有同 ID 的模型）
      const updated = await window.electronAPI.zotero.article.setConfig({
        channelId: next,
        model: null,
      })
      setConfig(updated)
    } finally {
      setBusy(false)
    }
  }

  const handleModelChange = async (value: string): Promise<void> => {
    setBusy(true)
    try {
      const next = value === NULL_CHANNEL_VALUE ? null : value
      const updated = await window.electronAPI.zotero.article.setConfig({ model: next })
      setConfig(updated)
    } finally {
      setBusy(false)
    }
  }

  const handleRetryAll = async (): Promise<void> => {
    if (retrying) return
    setRetrying(true)
    try {
      const enqueued = await window.electronAPI.zotero.article.retryAll()
      const summary = await window.electronAPI.zotero.article.getStatus()
      setStatus(summary)
      if (enqueued > 0) {
        toast.success(t('zotero.article.toast.retryEnqueued', { count: enqueued }))
      } else {
        toast.info(t('zotero.article.toast.retryNone'))
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(t('zotero.article.toast.retryFailed'), { description: msg })
    } finally {
      setRetrying(false)
    }
  }

  const handleRegenerateAll = async (): Promise<void> => {
    if (regenerating) return
    if (status.total === 0) {
      toast.info(t('zotero.article.toast.regenerateEmpty'))
      return
    }
    const ok = window.confirm(
      t('zotero.article.toast.regenerateConfirm', { count: status.total }),
    )
    if (!ok) return
    setRegenerating(true)
    try {
      const enqueued = await window.electronAPI.zotero.article.regenerateAll()
      const summary = await window.electronAPI.zotero.article.getStatus()
      setStatus(summary)
      toast.success(t('zotero.article.toast.regenerateEnqueued', { count: enqueued }))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(t('zotero.article.toast.regenerateFailed'), { description: msg })
    } finally {
      setRegenerating(false)
    }
  }

  const channelValue = config.channelId ?? NULL_CHANNEL_VALUE
  const modelValue = config.model ?? NULL_CHANNEL_VALUE
  const failedCount = status.byStatus.failed
  const completedCount = status.byStatus.completed
  const inflightCount = status.byStatus.pending + status.byStatus.generating

  return (
    <SettingsSection
      title={t('zotero.article.section.title')}
      description={t('zotero.article.section.description')}
    >
      <SettingsCard>
        <SettingsRow
          label={t('zotero.article.enable.label')}
          description={t('zotero.article.enable.description')}
        >
          <Switch checked={config.enabled} onCheckedChange={handleToggle} disabled={busy} />
        </SettingsRow>
      </SettingsCard>

      {/* 开关关闭时不展示其余卡片；状态卡前置，LLM 配置压成一行 */}
      {config.enabled && (
        <>
          <SettingsCard divided={false}>
            <SettingsModuleRow
              title={t('zotero.article.status.title')}
              description={t('zotero.article.status.summary', {
                total: status.total,
                completed: completedCount,
                inflight: inflightCount,
                failed: failedCount,
              })}
              action={
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={retrying || failedCount === 0}
                    onClick={handleRetryAll}
                  >
                    {retrying ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                    <span>{t('zotero.article.actions.retryFailed')}</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={regenerating || status.total === 0}
                    onClick={handleRegenerateAll}
                    title={t('zotero.article.actions.regenerateTooltip')}
                  >
                    {regenerating ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
                    <span>{t('zotero.article.actions.regenerateAll')}</span>
                  </Button>
                </div>
              }
              className={status.recentFailed.length > 0 ? 'pb-3' : undefined}
            />
            {status.recentFailed.length > 0 && (
              <div className="px-5 pb-5 space-y-1.5">
                <div className="text-xs font-medium text-muted-foreground">{t('zotero.article.status.recentFailed')}</div>
                <ul className="space-y-1">
                  {status.recentFailed.map(item => (
                    <li
                      key={item.attachmentKey}
                      className="text-xs text-muted-foreground rounded-md bg-muted/40 px-2 py-1.5"
                    >
                      <div className="font-medium text-foreground truncate">
                        {item.title || item.filename || item.attachmentKey.slice(0, 8)}
                      </div>
                      <div className="truncate">
                        {item.error}{t('zotero.article.status.retryCount', { count: item.attempts })}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </SettingsCard>

          <SettingsCard>
            <div className="px-5 py-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground shrink-0">
                  {t('zotero.article.channel.label')}
                </span>
                <Select value={channelValue} onValueChange={handleChannelChange} disabled={busy}>
                  <SelectTrigger className="text-sm flex-1 min-w-0">
                    <SelectValue placeholder={t('zotero.article.channel.placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NULL_CHANNEL_VALUE}>{t('zotero.article.channel.defaultOption')}</SelectItem>
                    {enabledChannels.map(c => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <span className="text-xs text-muted-foreground shrink-0 ml-2">
                  {t('zotero.article.model.label')}
                </span>
                <Select
                  value={modelValue}
                  onValueChange={handleModelChange}
                  disabled={busy || !selectedChannel}
                >
                  <SelectTrigger className="text-sm flex-1 min-w-0">
                    <SelectValue placeholder={t('zotero.article.model.placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NULL_CHANNEL_VALUE}>{t('zotero.article.model.defaultOption')}</SelectItem>
                    {enabledModels.map(m => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="text-xs text-muted-foreground leading-relaxed">
                {t('zotero.article.model.hint')}
              </div>
            </div>
          </SettingsCard>
        </>
      )}
    </SettingsSection>
  )
}
