/**
 * GeneralSettings - 通用设置页
 *
 * 语言 / 桌面通知 / 通知声音 / 自动归档天数。
 * Profile（个人资料）已拆到独立的 ProfileSettings（账户组），不在此页。
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import { Check, ChevronDown } from 'lucide-react'
import {
  SettingsSection,
  SettingsCard,
  SettingsRow,
  SettingsToggle,
} from './primitives'
import { LABEL_CLASS, DESCRIPTION_CLASS } from './primitives/SettingsUIConstants'
import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover'
import { Separator } from '../ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import {
  notificationsEnabledAtom,
  notificationSoundEnabledAtom,
  notificationSoundsAtom,
  updateNotificationsEnabled,
  updateNotificationSoundEnabled,
  updateNotificationSound,
  playNotificationSound,
  NOTIFICATION_SOUNDS,
  DEFAULT_NOTIFICATION_SOUNDS,
} from '@/atoms/notifications'
import { cn } from '@/lib/utils'
import { Button } from '../ui/button'
import type { NotificationSoundId, NotificationSoundType, NotificationSoundSettings, AppLocale, AppTheme } from '@/types/settings'
import { languageAtom, updateLanguage } from '@/atoms/language-atoms'
import { themeAtom, updateTheme } from '@/atoms/theme-atoms'
import { SUPPORTED_LOCALES } from '@/locales'
import { SessionImport } from './SessionImport'
import { useT } from '@/hooks/useT'

export function GeneralSettings(): React.ReactElement {
  const [notificationsEnabled, setNotificationsEnabled] = useAtom(notificationsEnabledAtom)
  const [notificationSoundEnabled, setNotificationSoundEnabled] = useAtom(notificationSoundEnabledAtom)
  const [notificationSounds, setNotificationSounds] = useAtom(notificationSoundsAtom)
  const [language, setLanguage] = useAtom(languageAtom)
  const [theme] = useAtom(themeAtom)
  const { t: tCommon } = useT('common')
  const { t: tSettings } = useT('settings')
  const [archiveAfterDays, setArchiveAfterDays] = React.useState<number>(0)
  const soundControlsEnabled = notificationsEnabled && notificationSoundEnabled

  // 加载归档天数设置 —— 默认 0（Disabled），仅在用户主动选择天数时启用
  React.useEffect(() => {
    window.electronAPI.getSettings().then((settings) => {
      setArchiveAfterDays(settings.archiveAfterDays ?? 0)
    }).catch(console.error)
  }, [])

  /** 切换界面语言 */
  const handleLanguageChange = async (value: string): Promise<void> => {
    const lng = value as AppLocale
    setLanguage(lng)
    await updateLanguage(lng)
  }

  /** 切换外观主题：仅发起持久化，由主进程通过 theme:changed 回推权威 {mode, isDark} */
  const handleThemeChange = async (value: string): Promise<void> => {
    await updateTheme(value as AppTheme)
  }

  /** 更新归档天数 */
  const handleArchiveDaysChange = async (value: string): Promise<void> => {
    const days = parseInt(value, 10)
    setArchiveAfterDays(days)
    try {
      await window.electronAPI.updateSettings({ archiveAfterDays: days })
    } catch (error) {
      console.error('[通用设置] 更新归档天数失败:', error)
    }
  }

  return (
    <div className="space-y-6">
      <SettingsSection title={tCommon('general')}>
        <SettingsCard divided={false}>
          <ThemeCardPicker
            label={tSettings('general.theme.label')}
            description={tSettings('general.theme.description')}
            value={theme}
            onValueChange={handleThemeChange}
            options={[
              { value: 'system', label: tSettings('general.themeOptions.system') },
              { value: 'light', label: tSettings('general.themeOptions.light') },
              { value: 'dark', label: tSettings('general.themeOptions.dark') },
            ]}
          />
          <RowSeparator />
          <SettingsRow
            label={tSettings('general.language.label')}
            description={tSettings('general.language.description')}
          >
            <SettingsControlRail>
              <Select value={language} onValueChange={handleLanguageChange}>
                <SelectTrigger className="h-8 w-[128px] text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_LOCALES.map(({ code, label }) => (
                    <SelectItem key={code} value={code}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsControlRail>
          </SettingsRow>
          <RowSeparator />
          <SettingsToggle
            label={tSettings('general.notifications.desktopLabel')}
            description={tSettings('general.notifications.desktopDescription')}
            checked={notificationsEnabled}
            onCheckedChange={(checked) => {
              setNotificationsEnabled(checked)
              updateNotificationsEnabled(checked)
            }}
          />
          <RowSeparator />
          <SettingsToggle
            label={tSettings('general.notifications.soundLabel')}
            description={tSettings('general.notifications.soundDescription')}
            checked={notificationSoundEnabled}
            disabled={!notificationsEnabled}
            onCheckedChange={(checked) => {
              setNotificationSoundEnabled(checked)
              updateNotificationSoundEnabled(checked)
            }}
          />

          <RowSeparator />
          <SoundPicker
            label={tSettings('general.notifications.taskCompleteLabel')}
            description={tSettings('general.notifications.taskCompleteDescription')}
            type="taskComplete"
            sounds={notificationSounds}
            disabled={!soundControlsEnabled}
            onSoundChange={async (type, soundId) => {
              const newSounds = await updateNotificationSound(type, soundId, notificationSounds)
              setNotificationSounds(newSounds)
            }}
          />
          <RowSeparator />
          <SoundPicker
            label={tSettings('general.notifications.permissionLabel')}
            description={tSettings('general.notifications.permissionDescription')}
            type="permissionRequest"
            sounds={notificationSounds}
            disabled={!soundControlsEnabled}
            onSoundChange={async (type, soundId) => {
              const newSounds = await updateNotificationSound(type, soundId, notificationSounds)
              setNotificationSounds(newSounds)
            }}
          />
          <RowSeparator />
          <SoundPicker
            label={tSettings('general.notifications.exitPlanLabel')}
            description={tSettings('general.notifications.exitPlanDescription')}
            type="exitPlanMode"
            sounds={notificationSounds}
            disabled={!soundControlsEnabled}
            onSoundChange={async (type, soundId) => {
              const newSounds = await updateNotificationSound(type, soundId, notificationSounds)
              setNotificationSounds(newSounds)
            }}
          />

          <RowSeparator />
          <SettingsRow
            label={tSettings('general.archive.label')}
            description={tSettings('general.archive.description')}
          >
            <SettingsControlRail>
              <Select value={String(archiveAfterDays)} onValueChange={handleArchiveDaysChange}>
                <SelectTrigger className="h-8 w-[128px] text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">{tSettings('general.archive.disabled')}</SelectItem>
                  <SelectItem value="7">{tSettings('general.archive.days', { count: 7 })}</SelectItem>
                  <SelectItem value="14">{tSettings('general.archive.days', { count: 14 })}</SelectItem>
                  <SelectItem value="30">{tSettings('general.archive.days', { count: 30 })}</SelectItem>
                  <SelectItem value="60">{tSettings('general.archive.days', { count: 60 })}</SelectItem>
                </SelectContent>
              </Select>
            </SettingsControlRail>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
      {window.__TAURI_FORMAL__?.importSessions && <SessionImport />}
    </div>
  )
}

// ===== 设置卡片内部轻分组 =====

/** 卡片内行间分隔线，与 SettingsCard 自动分隔线保持一致 */
function RowSeparator(): React.ReactElement {
  return <Separator className="border-border/50" />
}

interface SettingsControlRailProps {
  children: React.ReactNode
}

/** 设置行右侧控件轨道，保证下拉框左边缘对齐 */
function SettingsControlRail({ children }: SettingsControlRailProps): React.ReactElement {
  return (
    <div className="flex min-w-[128px] items-center justify-start">
      {children}
    </div>
  )
}

// ===== ThemeCardPicker：主题卡片选择器 =====
//
// 三张缩略图卡片（System / Light / Dark），每张展示该主题的静态预览（聊天消息 mock），
// 底部 strip 含 radio 圆点 + 标签。选中卡片用 --info（蓝色）描边 + tinted strip 高亮。
// 缩略图必须呈现固定主题色（不随当前生效主题切换），因此 mock 部分内联颜色绕开 Tailwind 调色板规则。

interface ThemeCardPickerOption {
  value: AppTheme
  label: string
}

interface ThemeCardPickerProps {
  label: string
  description?: string
  value: AppTheme
  onValueChange: (value: AppTheme) => Promise<void> | void
  options: ThemeCardPickerOption[]
}

function ThemeCardPicker({
  label,
  description,
  value,
  onValueChange,
  options,
}: ThemeCardPickerProps): React.ReactElement {
  return (
    <div className="px-4 py-3 space-y-3">
      <div>
        <div className={LABEL_CLASS}>{label}</div>
        {description && (
          <div className={cn(DESCRIPTION_CLASS, 'mt-0.5')}>{description}</div>
        )}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {options.map((option) => {
          const selected = option.value === value
          return (
            <Button
              key={option.value}
              type="button"
              variant="outline"
              onClick={() => { void onValueChange(option.value) }}
              className={cn(
                'group h-auto flex flex-col items-stretch gap-0 overflow-hidden rounded-lg border border-border bg-transparent p-0 text-left shadow-none hover:bg-transparent',
                !selected && 'hover:border-muted-foreground/50',
              )}
            >
              <ThemeThumbnail variant={option.value} />
              <div
                className={cn(
                  'flex items-center gap-2 border-t px-3 py-2 transition-colors',
                  selected
                    ? 'bg-foreground/5 border-foreground/20'
                    : 'bg-card border-border',
                )}
              >
                <ThemeRadioDot selected={selected} />
                <span className="text-sm font-medium text-foreground">{option.label}</span>
              </div>
            </Button>
          )
        })}
      </div>
    </div>
  )
}

/** 卡片底部 radio 圆点（选中时填充中性 foreground） */
function ThemeRadioDot({ selected }: { selected: boolean }): React.ReactElement {
  return (
    <div
      className={cn(
        'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
        selected ? 'border-foreground' : 'border-muted-foreground/40 group-hover:border-muted-foreground/70',
      )}
    >
      {selected && <div className="h-2 w-2 rounded-full bg-foreground" />}
    </div>
  )
}

/**
 * 主题缩略图：固定渲染该主题的静态预览（不随当前 .dark class 变化），
 * 因此面板/消息条用 inline style 绑死颜色，避开 ESLint no-tailwind-palette。
 *
 * - light: 浅灰面板 + 深色气泡（黑色低不透明度）
 * - dark: 深色面板 + 浅色气泡（白色低不透明度）
 * - system: 左右对半拼接 light/dark
 */
function ThemeThumbnail({ variant }: { variant: AppTheme }): React.ReactElement {
  if (variant === 'system') {
    return (
      <div className="relative flex h-20 w-full overflow-hidden">
        <div className="flex-1 overflow-hidden">
          <ThumbnailPanel scheme="light" />
        </div>
        <div className="flex-1 overflow-hidden border-l border-border/40">
          <ThumbnailPanel scheme="dark" />
        </div>
      </div>
    )
  }
  return (
    <div className="h-20 w-full">
      <ThumbnailPanel scheme={variant === 'dark' ? 'dark' : 'light'} />
    </div>
  )
}

type ThumbnailScheme = 'light' | 'dark'

/**
 * 单侧主题缩略图：纯色背景 + 2 行 mock（头像圆点 + 消息条）。
 *
 * 全黑白配色：accent 用同色加大不透明度强化第二行（"高亮气泡"）：
 * - light scheme: 浅灰底（#e9eaec），bar/accent 用黑色不同透明度
 * - dark scheme: 纯黑底，bar/accent 用白色不同透明度
 * 缩略图不随 .dark class 变化，所以用 inline rgba 而非 token 类。
 */
function ThumbnailPanel({ scheme }: { scheme: ThumbnailScheme }): React.ReactElement {
  const palette = scheme === 'light'
    ? {
        bg: '#e9eaec',
        avatar: 'rgba(0, 0, 0, 0.25)',
        bar: 'rgba(0, 0, 0, 0.15)',
        accent: 'rgba(0, 0, 0, 0.45)',
      }
    : {
        bg: '#000000',
        avatar: 'rgba(255, 255, 255, 0.25)',
        bar: 'rgba(255, 255, 255, 0.15)',
        accent: 'rgba(255, 255, 255, 0.55)',
      }
  return (
    <div className="flex h-full w-full flex-col justify-center gap-2 px-3" style={{ backgroundColor: palette.bg }}>
      <div className="flex items-center gap-2">
        <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: palette.avatar }} />
        <div className="h-1.5 flex-1 rounded-full" style={{ backgroundColor: palette.bar }} />
      </div>
      <div className="flex items-center gap-2">
        <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: palette.avatar }} />
        <div className="h-1.5 w-3/5 rounded-full" style={{ backgroundColor: palette.accent }} />
      </div>
    </div>
  )
}

// ===== SoundPicker 内部组件 =====

interface SoundPickerProps {
  label: string
  description: string
  type: NotificationSoundType
  sounds: NotificationSoundSettings
  disabled: boolean
  onSoundChange: (type: NotificationSoundType, soundId: NotificationSoundId) => void
}

/** 单个场景的通知音选择器（点击列表项试听，确认后保存） */
function SoundPicker({ label, description, type, sounds, disabled, onSoundChange }: SoundPickerProps): React.ReactElement {
  const { t } = useT('settings')
  const currentId = sounds[type] ?? DEFAULT_NOTIFICATION_SOUNDS[type]
  const currentSound = NOTIFICATION_SOUNDS.find((sound) => sound.id === currentId)
  const currentLabel = currentId === 'none' ? t('general.notifications.mute') : currentSound?.label ?? currentId
  const [open, setOpen] = React.useState(false)
  const [draftId, setDraftId] = React.useState<NotificationSoundId>(currentId)

  /** 打开时从已保存设置重新开始试听，不把上次未确认选择带进来 */
  const handleOpenChange = (nextOpen: boolean): void => {
    if (nextOpen) {
      setDraftId(currentId)
    }
    setOpen(nextOpen)
  }

  /** 点击列表项只试听并更新临时选择，不关闭弹层 */
  const handlePreviewSound = (soundId: NotificationSoundId): void => {
    setDraftId(soundId)
    if (soundId !== 'none') {
      playNotificationSound(soundId)
    }
  }

  /** 确认后才保存设置并关闭弹层 */
  const handleConfirmSound = (): void => {
    onSoundChange(type, draftId)
    setOpen(false)
  }

  return (
    <SettingsRow
      label={label}
      description={description}
      className={cn(disabled && 'opacity-55')}
    >
      <SettingsControlRail>
        <Popover open={open} onOpenChange={handleOpenChange}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              className={cn(
                'h-8 w-[128px] justify-between px-3 text-sm font-normal shadow-sm',
                'hover:bg-background'
              )}
            >
              <span className="truncate">{currentLabel}</span>
              <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            side="bottom"
            align="start"
            sideOffset={6}
            className="w-[220px] p-1"
          >
            <div className="space-y-0.5">
              <SoundOption
                label={t('general.notifications.mute')}
                selected={draftId === 'none'}
                onSelect={() => handlePreviewSound('none')}
              />
              {NOTIFICATION_SOUNDS.map((sound) => (
                <SoundOption
                  key={sound.id}
                  label={sound.label}
                  selected={draftId === sound.id}
                  onSelect={() => handlePreviewSound(sound.id)}
                />
              ))}
            </div>
            <div className="mt-1 flex items-center justify-end gap-2 border-t border-border/60 px-2 py-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-sm"
                onClick={() => {
                  setDraftId(currentId)
                  setOpen(false)
                }}
              >
                {t('general.notifications.popoverCancel')}
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-7 px-3 text-sm"
                onClick={handleConfirmSound}
              >
                {t('general.notifications.popoverConfirm')}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </SettingsControlRail>
    </SettingsRow>
  )
}

interface SoundOptionProps {
  label: string
  selected: boolean
  onSelect: () => void
}

/** 音效下拉项：点击整行试听并暂选 */
function SoundOption({ label, selected, onSelect }: SoundOptionProps): React.ReactElement {
  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        'flex h-9 w-full items-center justify-start gap-0 rounded-md p-0 text-sm font-normal hover:bg-muted',
        selected && 'bg-primary/12 text-primary hover:bg-primary/16'
      )}
      onClick={onSelect}
    >
      <span className="flex h-full min-w-0 flex-1 items-center px-3 text-left">
        <span className="truncate">{label}</span>
      </span>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center">
        {selected && <Check size={16} />}
      </span>
    </Button>
  )
}
