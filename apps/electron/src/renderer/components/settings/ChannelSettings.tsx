/**
 * ChannelSettings - 渠道配置页
 *
 * 单 section 设计：每行一个渠道 + 两个 Switch（启用 / Agent 可用）。
 * "Agent 可见性" 是渠道的属性，不再单独开 section。
 */

import * as React from 'react'
import { useAtom, useSetAtom } from 'jotai'
import { Plus, Trash2, Zap, ChevronRight, AlertTriangle, ImageIcon, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { PROVIDER_LABELS } from '@asci/shared'
import type { Channel } from '@asci/shared'
import { getChannelLogo } from '@/lib/model-logo'
import { pickDefaultModelOnCreate } from '@/lib/channel-defaults'
import { agentChannelIdAtom, agentModelIdAtom, agentChannelIdsAtom } from '@/atoms/agent-atoms'
import { channelsAtom } from '@/atoms/channels-atoms'
import { SettingsSection, SettingsCard, SettingsEmpty } from './primitives'
import { ChannelForm } from './ChannelForm'
import { useT } from '@/hooks/useT'

/** 组件视图模式 */
type ViewMode = 'list' | 'create' | 'edit'

export function ChannelSettings(): React.ReactElement {
  const { t } = useT('settings')
  const [channels, setChannels] = React.useState<Channel[]>([])
  const [viewMode, setViewMode] = React.useState<ViewMode>('list')
  const [editingChannel, setEditingChannel] = React.useState<Channel | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [agentChannelId, setAgentChannelId] = useAtom(agentChannelIdAtom)
  const [agentModelId, setAgentModelId] = useAtom(agentModelIdAtom)
  const [agentChannelIds, setAgentChannelIds] = useAtom(agentChannelIdsAtom)
  const setGlobalChannels = useSetAtom(channelsAtom)

  /** 加载渠道列表 */
  const loadChannels = React.useCallback(async (): Promise<Channel[]> => {
    try {
      const list = await window.electronAPI.listChannels()
      setChannels(list)
      setGlobalChannels(list) // 同步到全局缓存
      return list
    } catch (error) {
      console.error('[渠道设置] 加载渠道列表失败:', error)
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    loadChannels()
  }, [loadChannels])

  /** 删除渠道 */
  const handleDelete = async (channel: Channel): Promise<void> => {
    if (!confirm(t('channels.deleteConfirm', { name: channel.name }))) return

    try {
      await window.electronAPI.deleteChannel(channel.id)

      // 从 Agent 渠道列表中移除
      const newIds = agentChannelIds.filter((id) => id !== channel.id)
      setAgentChannelIds(newIds)

      // 如果删除的是当前选中的 Agent 渠道，清空选择
      if (agentChannelId === channel.id) {
        setAgentChannelId(null)
        setAgentModelId(null)
      }

      await window.electronAPI.updateSettings({
        agentChannelIds: newIds,
        ...(agentChannelId === channel.id && { agentChannelId: undefined, agentModelId: undefined }),
      })

      await loadChannels()
    } catch (error) {
      console.error('[渠道设置] 删除渠道失败:', error)
    }
  }

  /**
   * 切换渠道启用状态（合并主开关 + Agent 可见性）
   *
   * 启用：标记 Channel.enabled=true、加入 agentChannelIds，无默认 Agent 渠道时自动选中
   * 禁用：标记 Channel.enabled=false、从 agentChannelIds 移除，若是当前默认渠道则清空选择
   */
  const handleToggle = async (channel: Channel): Promise<void> => {
    const nextEnabled = !channel.enabled
    try {
      await window.electronAPI.updateChannel(channel.id, { enabled: nextEnabled })

      if (!nextEnabled) {
        // 禁用：移出 Agent 白名单
        const newIds = agentChannelIds.filter((id) => id !== channel.id)
        setAgentChannelIds(newIds)
        const updates: Parameters<typeof window.electronAPI.updateSettings>[0] = { agentChannelIds: newIds }
        if (agentChannelId === channel.id) {
          setAgentChannelId(null)
          setAgentModelId(null)
          updates.agentChannelId = undefined
          updates.agentModelId = undefined
        }
        await window.electronAPI.updateSettings(updates)
      } else if (!agentChannelIds.includes(channel.id)) {
        // 启用：加入 Agent 白名单
        const newIds = [...agentChannelIds, channel.id]
        setAgentChannelIds(newIds)

        const updates: Parameters<typeof window.electronAPI.updateSettings>[0] = { agentChannelIds: newIds }

        // 首次开启且无默认渠道：顺势设为默认，自动挑一个模型
        if (!agentChannelId) {
          const pickedModel = channel.models.find((m) => m.enabled) ?? channel.models[0]
          setAgentChannelId(channel.id)
          if (pickedModel) setAgentModelId(pickedModel.id)
          updates.agentChannelId = channel.id
          updates.agentModelId = pickedModel?.id

          // 所选模型若未启用，同步标记为 enabled，避免 AgentView 判为"暂无可用模型"
          if (pickedModel && !pickedModel.enabled) {
            const nextModels = channel.models.map((m) =>
              m.id === pickedModel.id ? { ...m, enabled: true } : m,
            )
            await window.electronAPI.updateChannel(channel.id, { models: nextModels }).catch(console.error)
          }
        }

        await window.electronAPI.updateSettings(updates)
      }

      await loadChannels()
    } catch (error) {
      console.error('[渠道设置] 切换渠道状态失败:', error)
    }
  }

  /**
   * 表单保存回调 — 创建路径默认把新渠道加入 Agent 可见列表
   *
   * 托底逻辑：若全局默认渠道/模型均为空（首次配置场景），把新渠道的首个 enabled 模型
   * 写入 agentChannelId / agentModelId，避免用户配完渠道还得手动再选一次模型。
   * 边界：
   *   - 已有默认渠道时新增渠道：不改写当前已选
   *   - 新渠道下没有 enabled 模型：不强制写入，保持原行为（AgentView 仍提示"暂无可用模型"）
   */
  const handleFormSaved = async (): Promise<void> => {
    const wasCreating = viewMode === 'create'
    const previousIds = new Set(channels.map((c) => c.id))

    setViewMode('list')
    setEditingChannel(null)
    const list = await loadChannels()

    if (wasCreating) {
      const newChannel = list.find((c) => !previousIds.has(c.id))
      if (newChannel && !agentChannelIds.includes(newChannel.id)) {
        const newIds = [...agentChannelIds, newChannel.id]
        setAgentChannelIds(newIds)

        const updates: Parameters<typeof window.electronAPI.updateSettings>[0] = { agentChannelIds: newIds }

        const picked = pickDefaultModelOnCreate(newChannel, agentChannelId, agentModelId)
        if (picked) {
          setAgentChannelId(picked.agentChannelId)
          setAgentModelId(picked.agentModelId)
          updates.agentChannelId = picked.agentChannelId
          updates.agentModelId = picked.agentModelId
        }

        await window.electronAPI.updateSettings(updates).catch(console.error)
      }
    }
  }

  /** 取消表单 */
  const handleFormCancel = (): void => {
    setViewMode('list')
    setEditingChannel(null)
  }

  // 表单视图
  if (viewMode === 'create' || viewMode === 'edit') {
    return (
      <ChannelForm
        channel={editingChannel}
        onSaved={handleFormSaved}
        onCancel={handleFormCancel}
      />
    )
  }

  // 列表视图
  return (
    <div className="space-y-8">
      <SettingsSection
        title={t('channels.section.title')}
        description={t('channels.section.description')}
        action={
          <Button size="sm" onClick={() => setViewMode('create')} data-spotlight-target="add-channel">
            <Plus size={16} />
            <span>{t('channels.addButton')}</span>
          </Button>
        }
      >
        {loading ? (
          <SettingsCard>
            <SettingsEmpty>{t('channels.loading')}</SettingsEmpty>
          </SettingsCard>
        ) : channels.length === 0 ? (
          <SettingsCard>
            <SettingsEmpty icon={<Zap data-first-run-empty-icon size={20} strokeWidth={2} />}>
              {t('channels.empty')}
            </SettingsEmpty>
          </SettingsCard>
        ) : (
          <SettingsCard>
            {channels.map((channel) => (
              <ChannelRow
                key={channel.id}
                channel={channel}
                onEdit={() => {
                  setEditingChannel(channel)
                  setViewMode('edit')
                }}
                onDelete={() => handleDelete(channel)}
                onToggle={() => handleToggle(channel)}
              />
            ))}
          </SettingsCard>
        )}
      </SettingsSection>
    </div>
  )
}

// ===== 渠道行子组件 =====

interface ChannelRowProps {
  channel: Channel
  onEdit: () => void
  onDelete: () => void
  onToggle: () => void
}

function ChannelRow({
  channel,
  onEdit,
  onDelete,
  onToggle,
}: ChannelRowProps): React.ReactElement {
  const { t } = useT('settings')
  const enabledCount = channel.models.filter((m) => m.enabled).length
  const totalCount = channel.models.length
  /** 0 启用模型：toggle 不能开（开了对话框也看不见，保持 UI 与"对话框不可见"警告自洽） */
  const hasNoEnabledModels = enabledCount === 0
  const description = [
    channel.provider === 'custom-anthropic' ? t('channelForm.fields.customAnthropic')
      : channel.provider === 'custom-image' ? t('channelForm.fields.imageRelay') : channel.provider === 'custom-openai' ? t('channelForm.fields.customOpenai') : PROVIDER_LABELS[channel.provider],
    t('channels.row.modelsCount', { enabled: enabledCount, total: totalCount }),
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="group flex items-center gap-2 rounded-lg px-3 py-2 transition-colors hover:bg-muted/40 focus-within:bg-muted/40">
        <button
          type="button"
          onClick={onEdit}
          aria-label={t('channels.row.editAria', { name: channel.name })}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-md p-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <img src={getChannelLogo(channel.baseUrl)} alt="" className="h-8 w-8 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate text-sm font-medium text-foreground">{channel.name}</span>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-sm text-muted-foreground">
                {channel.provider === 'custom-image' ? <ImageIcon size={12} aria-hidden="true" /> : <MessageSquare size={12} aria-hidden="true" />}
                {t(channel.provider === 'custom-image' ? 'channels.row.imageCapability' : 'channels.row.chatCapability')}
              </span>
            </div>
            <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</div>
            {enabledCount === 0 && (
              <div className="mt-1 flex items-center gap-1 text-xs text-warning">
                <AlertTriangle size={12} className="shrink-0" aria-hidden="true" />
                <span>{t('channels.row.noModelsWarning')}</span>
              </div>
            )}
          </div>
          <ChevronRight size={16} className="shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
        <div
          className="flex items-center gap-3"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {/* 删除：红底警示按钮，仅在行 hover/focus 时显示 */}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onDelete}
            className="size-auto bg-destructive/10 p-1.5 text-destructive hover:bg-destructive/20 hover:text-destructive opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [&_svg]:size-3.5"
            title={t('channels.row.deleteTitle')}
            aria-label={t('channels.row.deleteAria', { name: channel.name })}
          >
            <Trash2 size={14} />
          </Button>

          {/* 启用开关：开 = 渠道在 Agent 模型选择器中可见；0 模型时禁止开启 */}
          <Switch
            checked={hasNoEnabledModels ? false : channel.enabled}
            disabled={hasNoEnabledModels}
            onCheckedChange={hasNoEnabledModels ? undefined : onToggle}
            title={hasNoEnabledModels ? t('channels.row.toggleDisabledNoModels') : undefined}
            aria-label={t('channels.row.toggleAria', {
              action: channel.enabled ? t('channels.row.toggleDisable') : t('channels.row.toggleEnable'),
              name: channel.name,
            })}
          />
        </div>
    </div>
  )
}
