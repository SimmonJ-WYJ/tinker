/**
 * ShortcutSettings — 快捷键设置面板
 *
 * 分组展示所有快捷键，支持：
 * - 查看当前快捷键绑定
 * - 点击录制自定义快捷键
 * - 冲突检测和提示
 * - 恢复默认值
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge.tsx'
import { cn } from '@/lib/utils'
import { SettingsSection, SettingsCard, SettingsRow } from './primitives'
import { shortcutOverridesAtom, sendWithCmdEnterAtom } from '@/atoms/shortcut-atoms'
import { DEFAULT_SHORTCUTS } from '@/lib/shortcut-defaults'
import type { ShortcutCategory, ShortcutOverrides } from '@/lib/shortcut-defaults'
import {
  getActiveAccelerator,
  getAcceleratorDisplay,
  checkConflict,
  updateShortcutOverrides,
  isMac,
} from '@/lib/shortcut-registry'
import { useT } from '@/hooks/useT'

// ===== 快捷键录制组件 =====

interface ShortcutRecorderProps {
  /** 快捷键 ID */
  shortcutId: string
  /** 当前显示的 accelerator */
  currentAccelerator: string
  /** 录制完成回调 */
  onRecord: (shortcutId: string, accelerator: string) => void
}

function ShortcutRecorder({
  shortcutId,
  currentAccelerator,
  onRecord,
}: ShortcutRecorderProps): React.ReactElement {
  const { t } = useT('settings')
  const [recording, setRecording] = React.useState(false)
  const [pendingKeys, setPendingKeys] = React.useState('')
  const [conflict, setConflict] = React.useState<string | null>(null)

  const handleStartRecording = React.useCallback(() => {
    setRecording(true)
    setPendingKeys('')
    setConflict(null)
  }, [])

  const handleCancel = React.useCallback(() => {
    setRecording(false)
    setPendingKeys('')
    setConflict(null)
  }, [])

  // 录制模式下的按键捕获
  React.useEffect(() => {
    if (!recording) return

    const handleKeyDown = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()

      // 忽略单独的修饰键
      if (['Meta', 'Control', 'Shift', 'Alt'].includes(e.key)) return

      // 构建 accelerator 字符串
      const parts: string[] = []
      if (e.metaKey && isMac) parts.push('Cmd')
      if (e.ctrlKey && !isMac) parts.push('Ctrl')
      if (e.shiftKey) parts.push('Shift')
      if (e.altKey) parts.push('Alt')

      // 至少需要一个修饰键
      if (parts.length === 0) return

      // 标准化按键名称
      let key = e.key
      if (key === ' ') key = 'Space'
      if (key.length === 1) key = key.toUpperCase()
      // 特殊键映射
      const keyMap: Record<string, string> = {
        ArrowUp: 'Up', ArrowDown: 'Down',
        ArrowLeft: 'Left', ArrowRight: 'Right',
        Escape: 'Esc', Backspace: 'Backspace',
        Delete: 'Delete', Enter: 'Enter', Tab: 'Tab',
      }
      const mapped = keyMap[key]
      if (mapped) key = mapped

      parts.push(key)
      const accelerator = parts.join('+')

      // 冲突检测
      const conflictId = checkConflict(accelerator, shortcutId)
      if (conflictId) {
        const conflictDef = DEFAULT_SHORTCUTS.find((s) => s.id === conflictId)
        setConflict(conflictDef ? t(`shortcuts.items.${conflictDef.id}.name`) : conflictId)
        setPendingKeys(accelerator)
        return
      }

      // 无冲突，直接应用
      setPendingKeys('')
      setConflict(null)
      setRecording(false)
      onRecord(shortcutId, accelerator)
    }

    // Escape 取消录制
    const handleEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        handleCancel()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keydown', handleEsc, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keydown', handleEsc, true)
    }
  }, [recording, shortcutId, onRecord, handleCancel, t])

  if (recording) {
    return (
      <div className="flex items-center gap-2">
        {conflict ? (
          <>
            <Badge tone="destructive" variant="soft">
              {t('shortcuts.recorder.conflict', { key: getAcceleratorDisplay(pendingKeys), name: conflict })}
            </Badge>
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={handleCancel}>
              {t('shortcuts.recorder.cancel')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-destructive"
              onClick={() => {
                setRecording(false)
                setConflict(null)
                onRecord(shortcutId, pendingKeys)
              }}
            >
              {t('shortcuts.recorder.override')}
            </Button>
          </>
        ) : (
          <>
            <Badge tone="primary" variant="soft" className="animate-pulse">
              {t('shortcuts.recorder.press')}
            </Badge>
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={handleCancel}>
              {t('shortcuts.recorder.cancel')}
            </Button>
          </>
        )}
      </div>
    )
  }

  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        'h-auto min-w-[2rem]',
        'px-2 py-0.5 rounded-md text-sm leading-5 tracking-tight',
        'bg-card text-foreground/85',
        'border border-border/70',
        'shadow-[0_1px_0_0_hsl(var(--border))]',
        'hover:bg-accent hover:border-border hover:text-foreground',
      )}
      onClick={handleStartRecording}
      title={t('shortcuts.recorder.tooltip')}
    >
      {getAcceleratorDisplay(currentAccelerator)}
    </Button>
  )
}

// ===== 主组件 =====

export function ShortcutSettings(): React.ReactElement {
  const { t } = useT('settings')
  const [overrides, setOverrides] = useAtom(shortcutOverridesAtom)
  const [sendWithCmdEnter, setSendWithCmdEnter] = useAtom(sendWithCmdEnterAtom)

  // 按分类分组
  const grouped = React.useMemo(() => {
    const groups = new Map<ShortcutCategory, typeof DEFAULT_SHORTCUTS>()
    for (const def of DEFAULT_SHORTCUTS) {
      const list = groups.get(def.category) ?? []
      list.push(def)
      groups.set(def.category, list)
    }
    return groups
  }, [])

  // 录制回调：更新 overrides 并持久化
  const handleRecord = React.useCallback(
    (shortcutId: string, accelerator: string) => {
      const key = isMac ? 'mac' : 'win'
      const newOverrides: ShortcutOverrides = {
        ...overrides,
        [shortcutId]: {
          ...overrides[shortcutId],
          [key]: accelerator,
        },
      }
      setOverrides(newOverrides)
      updateShortcutOverrides(newOverrides)

      // 持久化到 settings.json
      window.electronAPI
        .updateSettings({ shortcutOverrides: newOverrides })
        .then(() => {
          // 如果修改的是全局快捷键，通知主进程重新注册
          const def = DEFAULT_SHORTCUTS.find((s) => s.id === shortcutId)
          if (def?.global) {
            window.electronAPI.reregisterGlobalShortcuts().catch(console.error)
          }
        })
        .catch(console.error)
    },
    [overrides, setOverrides],
  )

  // 恢复单个快捷键默认值
  const handleReset = React.useCallback(
    (shortcutId: string) => {
      const newOverrides = { ...overrides }
      delete newOverrides[shortcutId]
      setOverrides(newOverrides)
      updateShortcutOverrides(newOverrides)

      window.electronAPI
        .updateSettings({ shortcutOverrides: newOverrides })
        .then(() => {
          // 如果重置的是全局快捷键，通知主进程重新注册
          const def = DEFAULT_SHORTCUTS.find((s) => s.id === shortcutId)
          if (def?.global) {
            window.electronAPI.reregisterGlobalShortcuts().catch(console.error)
          }
        })
        .catch(console.error)
    },
    [overrides, setOverrides],
  )

  // 恢复所有默认值（破坏性操作，加二次确认）
  const handleResetAll = React.useCallback(() => {
    if (!confirm(t('shortcuts.resetAllConfirm'))) return
    setOverrides({})
    updateShortcutOverrides({})

    window.electronAPI
      .updateSettings({ shortcutOverrides: {} })
      .then(() => {
        // 重新注册全局快捷键（恢复默认绑定）
        window.electronAPI.reregisterGlobalShortcuts().catch(console.error)
      })
      .catch(console.error)
  }, [setOverrides, t])

  const hasOverrides = Object.keys(overrides).length > 0

  // 切换发送快捷键
  const handleToggleSendKey = React.useCallback(() => {
    const newValue = !sendWithCmdEnter
    setSendWithCmdEnter(newValue)
    window.electronAPI
      .updateSettings({ sendWithCmdEnter: newValue })
      .catch(console.error)
  }, [sendWithCmdEnter, setSendWithCmdEnter])

  // 分类顺序
  const categoryOrder: ShortcutCategory[] = ['app', 'navigation', 'edit', 'global']

  return (
    <div className="space-y-6">
      {/* 描述 + 恢复全部按钮 */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {t('shortcuts.hint')}
        </p>
        {hasOverrides && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground"
            onClick={handleResetAll}
          >
            <RotateCcw size={12} className="mr-1 !size-3" />
            {t('shortcuts.resetAll')}
          </Button>
        )}
      </div>

      {/* 发送消息快捷键切换 */}
      <SettingsSection title={t('shortcuts.send.section')}>
        <SettingsCard>
          <SettingsRow
            label={t('shortcuts.send.label')}
            description={t('shortcuts.send.description')}
          >
            <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-0.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  'h-auto px-2.5 py-1 rounded-md transition-all',
                  !sendWithCmdEnter
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => sendWithCmdEnter && handleToggleSendKey()}
              >
                {t('shortcuts.send.enterToSend')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  'h-auto px-2.5 py-1 rounded-md transition-all',
                  sendWithCmdEnter
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
                onClick={() => !sendWithCmdEnter && handleToggleSendKey()}
              >
                {t('shortcuts.send.modifierEnterToSend', { modifier: isMac ? '⌘' : 'Ctrl' })}
              </Button>
            </div>
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>

      {/* 按分类分组展示 */}
      {categoryOrder.map((category) => {
        const shortcuts = grouped.get(category)
        if (!shortcuts) return null

        const visible = shortcuts.filter(
          (def) => !def.readonly || (isMac ? def.defaultMac : def.defaultWin),
        )
        if (visible.length === 0) return null

        return (
          <SettingsSection
            key={category}
            title={t(`shortcuts.category.${category}`)}
            description={
              category === 'global'
                ? t('shortcuts.globalNote')
                : undefined
            }
          >
            <SettingsCard>
              {visible.map((def) => {
                const currentAccel = getActiveAccelerator(def.id)
                const isCustomized = !!overrides[def.id]

                return (
                  <SettingsRow
                    key={def.id}
                    label={t(`shortcuts.items.${def.id}.name`)}
                    description={t(`shortcuts.items.${def.id}.description`)}
                    className="group"
                  >
                    <div className="flex items-center gap-2">
                      {def.readonly ? (
                        <span className={cn(
                          'inline-flex items-center justify-center min-w-[2rem]',
                          'px-2 py-0.5 rounded-md text-sm leading-5 tracking-tight',
                          'bg-muted text-foreground/60',
                          'border border-border/50',
                        )}>
                          {getAcceleratorDisplay(isMac ? def.defaultMac : def.defaultWin)}
                        </span>
                      ) : (
                        <>
                          <ShortcutRecorder
                            shortcutId={def.id}
                            currentAccelerator={currentAccel}
                            onRecord={handleRecord}
                          />
                          {isCustomized && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-6 text-muted-foreground hover:text-foreground"
                              onClick={() => handleReset(def.id)}
                              title={t('shortcuts.resetTitle')}
                            >
                              <RotateCcw size={12} className="!size-3" />
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </SettingsRow>
                )
              })}
            </SettingsCard>
          </SettingsSection>
        )
      })}
    </div>
  )
}
