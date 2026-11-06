/**
 * PermissionModeSelector — Agent 权限模式切换器
 *
 * 集成在对话输入框工具栏。下拉形式：trigger 显示当前模式（图标 + 名称 + ⌄），
 * 点开列出三模式（智能审批 / 完全自动 / 计划模式）各带描述，点选直达。
 * 每个会话独立维护自己的模式，切换持久化到工作区配置（下次 sendMessage 透传到 SDK 生效）。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { ChevronDown, Check, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { agentPermissionModeMapAtom, agentDefaultPermissionModeAtom, currentAgentWorkspaceIdAtom, agentWorkspacesAtom } from '@/atoms/agent-atoms'
import type { ASCIPermissionMode } from '@asci/shared'
import { ASCI_PERMISSION_MODE_ORDER } from '@asci/shared'
import { useT } from '@/hooks/useT'
import { cn } from '@/lib/utils'
import { choiceTokens } from './choice/choice-tokens.ts'
import { TapIcon, ClipboardCheckIcon, TaskListIcon } from './composer-icons'

/** 模式图标：智能审批=点按 / 完全自动=剪贴板打勾 / 计划模式=任务清单（设计稿图标） */
const MODE_ICON: Record<ASCIPermissionMode, React.ComponentType<{ className?: string }>> = {
  acceptEdits: TapIcon,
  bypassPermissions: ClipboardCheckIcon,
  plan: TaskListIcon,
}

interface PermissionModeSelectorProps {
  sessionId: string
}

export function PermissionModeSelector({ sessionId }: PermissionModeSelectorProps): React.ReactElement | null {
  const { t } = useT('conversation')
  const [modeMap, setModeMap] = useAtom(agentPermissionModeMapAtom)
  const modeLabel = (m: ASCIPermissionMode): string => {
    switch (m) {
      case 'acceptEdits': return t('permissionMode.acceptEditsLabel')
      case 'bypassPermissions': return t('permissionMode.bypassLabel')
      case 'plan': return t('permissionMode.planLabel')
    }
  }
  const modeDescription = (m: ASCIPermissionMode): string => {
    switch (m) {
      case 'acceptEdits': return t('permissionMode.acceptEditsDescription')
      case 'bypassPermissions': return t('permissionMode.bypassDescription')
      case 'plan': return t('permissionMode.planDescription')
    }
  }
  const defaultMode = useAtomValue(agentDefaultPermissionModeAtom)
  const setDefaultMode = useSetAtom(agentDefaultPermissionModeAtom)
  const mode = modeMap.get(sessionId) ?? defaultMode
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)

  // 获取当前工作区的 slug
  const workspaceSlug = React.useMemo(() => {
    if (!currentWorkspaceId) return null
    const ws = workspaces.find((w) => w.id === currentWorkspaceId)
    return ws?.slug ?? null
  }, [currentWorkspaceId, workspaces])

  // 初始化：如果当前 session 不在 Map 中，从默认值写入，确保隔离
  React.useEffect(() => {
    if (!modeMap.has(sessionId)) {
      setModeMap((prev: Map<string, ASCIPermissionMode>) => {
        if (prev.has(sessionId)) return prev
        const next = new Map(prev)
        next.set(sessionId, defaultMode)
        return next
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅 sessionId 变化时初始化
  }, [sessionId])

  // 加载工作区权限模式（仅值变化时更新，避免切换会话时抖动）
  React.useEffect(() => {
    if (!workspaceSlug) return

    window.electronAPI.getPermissionMode(workspaceSlug)
      .then((savedMode) => {
        if (savedMode !== defaultMode) setDefaultMode(savedMode)
        setModeMap((prev: Map<string, ASCIPermissionMode>) => {
          const current = prev.get(sessionId)
          if (current && current !== defaultMode) return prev
          if (current === savedMode) return prev
          const next = new Map(prev)
          next.set(sessionId, savedMode)
          return next
        })
      })
      .catch((error) => {
        console.error('[PermissionModeSelector] 加载权限模式失败:', error)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在 workspaceSlug/sessionId 变化时重新加载
  }, [workspaceSlug, sessionId])

  /** 选中某一模式 */
  const handleSelect = React.useCallback(async (next: ASCIPermissionMode) => {
    setModeMap((prev: Map<string, ASCIPermissionMode>) => {
      const updated = new Map(prev)
      updated.set(sessionId, next)
      return updated
    })

    if (workspaceSlug) {
      try {
        await window.electronAPI.setPermissionMode(workspaceSlug, next)
      } catch (error) {
        console.error('[PermissionModeSelector] 保存权限模式失败:', error)
      }
    }

    requestAnimationFrame(() => document.querySelector<HTMLElement>('.ProseMirror')?.focus())
  }, [sessionId, workspaceSlug, setModeMap])

  const TriggerIcon = MODE_ICON[mode]

  // 控制下拉菜单打开状态
  const [open, setOpen] = React.useState(false)

  // 键盘快捷键：1/2/3 切换模式
  const handleKeyDown = React.useCallback((e: KeyboardEvent) => {
    const key = e.key
    const index = parseInt(key, 10) - 1
    if (index >= 0 && index < ASCI_PERMISSION_MODE_ORDER.length) {
      const targetMode = ASCI_PERMISSION_MODE_ORDER[index]
      if (targetMode) {
        handleSelect(targetMode)
        setOpen(false) // 关闭下拉菜单
      }
    }
  }, [handleSelect])

  return (
    <DropdownMenu open={open} onOpenChange={(isOpen) => {
      setOpen(isOpen)
      if (isOpen) {
        document.addEventListener('keydown', handleKeyDown)
      } else {
        document.removeEventListener('keydown', handleKeyDown)
      }
    }}>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          {/* onFocus preventDefault：Radix 抑制 focus 触发的 tooltip，仅保留 hover；
              避免选完关闭下拉后焦点回到 trigger 时 tooltip 闪现 */}
          <TooltipTrigger asChild onFocus={(e) => e.preventDefault()}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className={cn(
                  'h-auto gap-1.5 rounded-md px-1.5 py-1 text-sm font-normal text-foreground hover:text-foreground',
                  choiceTokens.triggerHover,
                )}
              >
                <span>{modeLabel(mode)}</span>
                <ChevronDown aria-hidden="true" className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>{t('permissionMode.changePermissions')}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent align="start" sideOffset={8} className="w-80 space-y-0 p-1.5">
        {/* 标题 */}
        <div className="px-2 pb-1 pt-1.5">
          {/* eslint-disable-next-line asci/min-font-size -- 标题文字例外 */}
          <p className="text-xs text-muted-foreground">{t('permissionMode.menuLabel')}</p>
        </div>
        {ASCI_PERMISSION_MODE_ORDER.map((m, index) => {
          const selected = m === mode
          return (
            <DropdownMenuItem
              key={m}
              onSelect={() => handleSelect(m)}
              className={cn(
                'gap-0 rounded-md px-2 py-1.5 cursor-pointer flex-col items-start',
                selected && 'bg-accent/40',
              )}
            >
              <div className="flex items-center w-full gap-2">
                <div className="flex-1">
                  <p className="text-sm text-foreground">{modeLabel(m)}</p>
                  {/* eslint-disable-next-line asci/min-font-size -- 说明文字例外 */}
                  <p className="text-[11px] text-muted-foreground mt-[-2px]">{modeDescription(m)}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {selected && <Check className="size-4 text-foreground" />}
                  <span className="text-sm text-muted-foreground">{index + 1}</span>
                </div>
              </div>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
