/**
 * ModelSelector - 模型选择器（DropdownMenu）
 *
 * 工具栏下拉：trigger = 模型 logo + 名称 + Chevron。
 * 下拉内容（按设计稿）：按渠道分组的扁平模型列表（灰色组标签 + 行=名称 + 选中勾），
 * 可选的「推理深度」区（并入底部，介绍走 hover），底部「管理渠道与模型」入口。
 * 支持渠道、模型名称和模型 ID 搜索；生图渠道单独说明。
 *
 * 受控组件：externalSelectedModel + onModelSelect 由调用方提供。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { ChevronDown, ChevronRight, Cpu, Check } from 'lucide-react'
import { DatabaseSettingIcon } from '@/components/agent/composer-icons'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { channelsAtom, channelsLoadedAtom } from '@/atoms/channels-atoms'
import { settingsOpenAtom, settingsTabAtom } from '@/atoms/settings-tab'
import { cn } from '@/lib/utils'
import { useT } from '@/hooks/useT'
import type { Channel, ModelOption } from '@asci/shared'

/** 从渠道列表构建扁平化的模型选项 */
function buildModelOptions(channels: Channel[], filterChannelId?: string, filterChannelIds?: string[]): ModelOption[] {
  const options: ModelOption[] = []

  for (const channel of channels) {
    if (!channel.enabled || channel.provider === 'custom-image') continue
    if (filterChannelId && channel.id !== filterChannelId) continue
    if (filterChannelIds && filterChannelIds.length > 0 && !filterChannelIds.includes(channel.id)) continue

    for (const model of channel.models) {
      if (!model.enabled) continue

      options.push({
        channelId: channel.id,
        channelName: channel.name,
        modelId: model.id,
        modelName: model.name,
        provider: channel.provider,
      })
    }
  }

  return options
}

/** 按渠道分组模型选项 */
function groupByChannel(options: ModelOption[]): Map<string, ModelOption[]> {
  const groups = new Map<string, ModelOption[]>()

  for (const option of options) {
    const key = option.channelId
    const group = groups.get(key) ?? []
    group.push(option)
    groups.set(key, group)
  }

  return groups
}

/** 推理深度单项（由调用方按 i18n 拼好，描述仅在 hover 出现） */
export interface ReasoningOption {
  value: string
  label: string
  /** hover 才显示的描述；省略则无 tooltip */
  desc?: string
}

/**
 * 推理深度并入模型下拉（放在模型列表下方）：省略此 prop → 不显示，退化为纯模型选择器。
 */
export interface ModelSelectorReasoning {
  /** 区标题，如「推理深度」 */
  title: string
  /** 当前选中值 */
  current: string
  options: ReasoningOption[]
  onSelect: (value: string) => void
}

interface ModelSelectorProps {
  /** 仅显示此渠道的模型 */
  filterChannelId?: string
  /** 仅显示这些渠道的模型（多渠道过滤） */
  filterChannelIds?: string[]
  /** 外部选中模型 */
  externalSelectedModel: { channelId: string; modelId: string } | null
  /** 选择回调 */
  onModelSelect: (option: ModelOption) => void
  /** 可选：把推理深度并入本下拉底部；省略则不显示、外部也不应再单独放推理入口 */
  reasoning?: ModelSelectorReasoning
}

export function ModelSelector({
  filterChannelId,
  filterChannelIds,
  externalSelectedModel,
  onModelSelect,
  reasoning,
}: ModelSelectorProps): React.ReactElement {
  const { t } = useT('common')
  const channels = useAtomValue(channelsAtom)
  const channelsLoaded = useAtomValue(channelsLoadedAtom)
  const setChannels = useSetAtom(channelsAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setSettingsTab = useSetAtom(settingsTabAtom)
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const searchRef = React.useRef<HTMLInputElement>(null)
  const imageChannels = channels.filter(channel => channel.enabled && channel.provider === 'custom-image' && channel.models.some(model => model.enabled))

  const selectedModel = externalSelectedModel

  // 每次打开下拉时刷新渠道列表
  React.useEffect(() => {
    if (open) {
      window.electronAPI.listChannels().then(setChannels).catch(console.error)
    }
  }, [open, setChannels])

  const modelOptions = React.useMemo(() => buildModelOptions(channels, filterChannelId, filterChannelIds), [channels, filterChannelId, filterChannelIds])
  const grouped = React.useMemo(() => groupByChannel(modelOptions.filter(option => [option.modelName, option.modelId, option.channelName].some(value => value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())))), [modelOptions, query])

  const currentModelInfo = React.useMemo(() => {
    if (!selectedModel) return null
    return modelOptions.find(
      (o) => o.channelId === selectedModel.channelId && o.modelId === selectedModel.modelId
    ) ?? null
  }, [selectedModel, modelOptions])

  // 仅在渠道列表尚未加载完成时保留上次有效的模型信息，避免初次渲染闪烁"选择模型"。
  // 渠道列表已加载且当前 modelId 不在启用模型里（被用户禁用或渠道切换 provider）时，
  // 必须立即放弃缓存，否则会一直显示旧模型名（issue #62）。
  const stableModelInfoRef = React.useRef(currentModelInfo)
  if (currentModelInfo) {
    stableModelInfoRef.current = currentModelInfo
  } else if (channelsLoaded) {
    stableModelInfoRef.current = null
  }
  const displayModelInfo = currentModelInfo ?? stableModelInfoRef.current

  const openChannelSettings = React.useCallback((): void => {
    setSettingsTab('channels')
    setSettingsOpen(true)
    setOpen(false)
  }, [setSettingsOpen, setSettingsTab])

  const handleSelect = (option: ModelOption): void => {
    onModelSelect(option)
    setOpen(false)
  }

  if (channelsLoaded && modelOptions.length === 0) {
    return (
      <Button
        type="button"
        variant="outline"
        onClick={openChannelSettings}
        className="edge-breath group h-auto gap-1.5 rounded-md border-0 bg-info px-3 py-1.5 text-sm font-medium text-info-foreground shadow-sm hover:bg-info/90 [&_svg]:!size-4"
      >
        <Cpu className="size-3.5" />
        <span>{t('modelSelector.noModelsCta')}</span>
        <ChevronRight className="!size-3 transition-transform group-hover:translate-x-0.5" />
      </Button>
    )
  }

  return (
    <DropdownMenu open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery('') }}>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          {/* onFocus preventDefault：Radix 抑制 focus 触发的 tooltip，仅保留 hover */}
          <TooltipTrigger asChild onFocus={(e) => e.preventDefault()}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="h-auto gap-1 px-1.5 py-1 rounded text-sm font-normal hover:text-foreground [&_svg]:size-3.5"
              >
                <span className="flex min-w-0 max-w-[260px] items-center">
                  {displayModelInfo ? (
                    <>
                      <span className="min-w-0 truncate text-foreground">{displayModelInfo.modelName}</span>
                      <span className="ml-1 max-w-[100px] shrink-0 truncate text-muted-foreground">· {displayModelInfo.channelName}</span>
                      {reasoning && (
                        <span className="text-muted-foreground ml-1">
                          {reasoning.options.find(opt => opt.value === reasoning.current)?.label || reasoning.current}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-muted-foreground">{t('modelSelector.selectModel')}</span>
                  )}
                </span>
                <ChevronDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-[220px]">
            <p className="font-medium">{displayModelInfo ? `${displayModelInfo.modelName} · ${displayModelInfo.channelName}` : t('modelSelector.menuLabel')}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{t('modelSelector.tooltipDescription')}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <DropdownMenuContent
        align="start"
        sideOffset={8}
        className="w-80 max-w-[calc(100vw-24px)] p-1.5 overflow-hidden"
        onFocusCapture={(event) => {
          if (event.target === event.currentTarget) { event.preventDefault(); searchRef.current?.focus() }
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault()
          requestAnimationFrame(() => document.querySelector<HTMLElement>('.ProseMirror')?.focus())
        }}
      >
        <div className="px-2 py-2">
          <input
            ref={searchRef}
            aria-label={t('modelSelector.searchLabel')}
            placeholder={t('modelSelector.searchPlaceholder')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                event.stopPropagation()
                const items = event.currentTarget.closest('[role="menu"]')?.querySelectorAll<HTMLElement>('[role="menuitem"]')
                const target = event.key === 'ArrowDown' ? items?.[0] : items?.[items.length - 1]
                target?.focus()
              } else if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation()
            }}
            className="w-full rounded-md border border-input bg-background px-2 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="mt-2 text-sm text-muted-foreground">{t('modelSelector.unverified')}</p>
        </div>
        <div className="max-h-[360px] overflow-y-auto scrollbar-thin">
          {grouped.size === 0 && <p role="status" className="px-2 py-3 text-sm text-muted-foreground">{t('modelSelector.noResults')}</p>}
          {Array.from(grouped.entries()).map(([channelId, options]) => {
            const first = options[0]
            if (!first) return null
            return (
              <div key={channelId}>
                <p className="px-2 pb-1 pt-2 text-sm text-muted-foreground">{first.channelName} · {t('modelSelector.chatChannel')}</p>
                {options.map((option) => {
                  const isSelected =
                    selectedModel?.channelId === option.channelId &&
                    selectedModel?.modelId === option.modelId
                  return (
                    <DropdownMenuItem
                      key={`${option.channelId}:${option.modelId}`}
                      onSelect={() => handleSelect(option)}
                      className="justify-between rounded-md px-2 py-2 cursor-pointer"
                    >
                      <span className={cn('text-sm truncate', isSelected ? 'text-foreground' : 'text-foreground/85')}>
                        {option.modelName}
                      </span>
                      {isSelected && <Check className="size-4 flex-shrink-0 text-foreground" />}
                    </DropdownMenuItem>
                  )
                })}
              </div>
            )
          })}

          {/* 推理深度：分割线 + 灰标签 + 行（名称 + 勾），介绍 hover 出现 */}
          {reasoning && (
            <>
              <div className="my-1.5 border-t border-border/60" />
              <p className="px-2 pb-1 pt-1 text-sm text-muted-foreground">{reasoning.title}</p>
              {reasoning.options.map((opt) => {
                const selected = opt.value === reasoning.current
                const row = (
                  <DropdownMenuItem
                    key={opt.value}
                    onSelect={() => { reasoning.onSelect(opt.value); setOpen(false) }}
                    className={cn(
                      'rounded-md px-2 py-2 cursor-pointer',
                      selected && 'bg-accent/40',
                    )}
                  >
                    <span className={cn('text-sm flex-1', selected ? 'text-foreground' : 'text-foreground/85')}>
                      {opt.label}
                    </span>
                    {selected && <Check className="size-4 flex-shrink-0 text-foreground" />}
                  </DropdownMenuItem>
                )
                return opt.desc ? (
                  <Tooltip key={opt.value}>
                    <TooltipTrigger asChild>{row}</TooltipTrigger>
                    <TooltipContent side="right" className="max-w-[200px]">{opt.desc}</TooltipContent>
                  </Tooltip>
                ) : (
                  row
                )
              })}
            </>
          )}
        </div>

        {imageChannels.length > 0 && (
          <p className="px-2 pt-2 text-sm text-muted-foreground">
            {t('modelSelector.imageChannels', { channels: imageChannels.map(channel => channel.name).join(' · ') })}
          </p>
        )}
        <div className="my-1.5 border-t border-border/60" />
        <DropdownMenuItem
          onSelect={openChannelSettings}
          className="group justify-between rounded-md px-2 py-2 text-muted-foreground hover:text-foreground"
        >
          <span className="flex items-center gap-2 text-[15px]">
            <DatabaseSettingIcon className="size-4" />
            {t('modelSelector.manageChannels')}
          </span>
          <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
