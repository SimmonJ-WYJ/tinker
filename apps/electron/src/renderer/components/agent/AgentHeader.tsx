/**
 * AgentHeader — Agent 会话头部
 *
 * 显示会话标题（可点击编辑）。
 * 参照 ChatHeader 的编辑模式。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Pencil, Check, X, PanelRight, FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { agentSessionsAtom, agentSessionPathMapAtom, agentSidePanelOpenMapAtom, workspaceFilesVersionAtom } from '@/atoms/agent-atoms'
import { useT } from '@/hooks/useT'
import { useDisplaySessionTitle } from '@/hooks/useDisplaySessionTitle'

/** AgentHeader 属性接口 */
interface AgentHeaderProps {
  sessionId: string
}

export function AgentHeader({ sessionId }: AgentHeaderProps): React.ReactElement | null {
  const { t } = useT('nav')
  const displayTitle = useDisplaySessionTitle()
  const sessions = useAtomValue(agentSessionsAtom)
  const session = sessions.find((s) => s.id === sessionId) ?? null
  const setAgentSessions = useSetAtom(agentSessionsAtom)
  const [editing, setEditing] = React.useState(false)
  const [editTitle, setEditTitle] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)

  // 文件面板切换状态
  const sidePanelOpenMap = useAtomValue(agentSidePanelOpenMapAtom)
  const setSidePanelOpenMap = useSetAtom(agentSidePanelOpenMapAtom)
  const filesVersion = useAtomValue(workspaceFilesVersionAtom)
  const isPanelOpen = sidePanelOpenMap.get(sessionId) ?? false
  const hasFileChanges = filesVersion > 0

  // 会话 cwd，用于"打开会话目录"按钮
  const sessionPathMap = useAtomValue(agentSessionPathMapAtom)
  const sessionPath = sessionPathMap.get(sessionId) ?? null

  const togglePanel = React.useCallback(() => {
    setSidePanelOpenMap((prev) => {
      const map = new Map(prev)
      map.set(sessionId, !(map.get(sessionId) ?? true))
      return map
    })
  }, [sessionId, setSidePanelOpenMap])

  const handleOpenSessionFolder = React.useCallback(() => {
    if (!sessionPath) return
    window.electronAPI.showInFolder(sessionPath).catch((error: unknown) => {
      console.error('[AgentHeader] 打开会话文件夹失败:', error)
    })
  }, [sessionPath])

  if (!session) return null

  /** 进入编辑模式 */
  const startEdit = (): void => {
    setEditTitle(displayTitle(session.title))
    setEditing(true)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  /** 保存标题 */
  const saveTitle = async (): Promise<void> => {
    const trimmed = editTitle.trim()
    if (!trimmed || trimmed === session.title) {
      setEditing(false)
      return
    }

    try {
      await window.electronAPI.updateAgentSessionTitle(session.id, trimmed)
      // 刷新会话列表以同步侧边栏
      const sessions = await window.electronAPI.listAgentSessions()
      setAgentSessions(sessions)
    } catch (error) {
      console.error('[AgentHeader] 更新标题失败:', error)
    }
    setEditing(false)
  }

  /** 键盘事件 */
  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      saveTitle()
    } else if (e.key === 'Escape') {
      setEditing(false)
    }
  }

  return (
    <div className="relative z-[51] flex items-center gap-2 pl-4 pr-2 h-[48px] titlebar-drag-region">
      {editing ? (
        <div className="flex items-center gap-1.5 flex-1 min-w-0 titlebar-no-drag">
          <input
            ref={inputRef}
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={saveTitle}
            className="flex-1 bg-transparent text-sm font-medium border-b border-primary/50 outline-none px-0 py-0.5 min-w-0"
            maxLength={100}
          />
          <Button
            type="button"
            variant="subtle"
            size="icon-xs"
            onMouseDown={(e) => e.preventDefault()}
            onClick={saveTitle}
          >
            <Check className="!size-3.5" />
          </Button>
          <Button
            type="button"
            variant="subtle"
            size="icon-xs"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setEditing(false)}
          >
            <X className="!size-3.5" />
          </Button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <span className="truncate text-sm font-medium text-foreground">
              {displayTitle(session.title)}
            </span>
            <Button
              type="button"
              variant="subtle"
              size="icon-xs"
              onMouseDown={(e) => e.preventDefault()}
              onClick={startEdit}
              className="titlebar-no-drag"
              aria-label={t('agentHeader.editTitle')}
            >
              <Pencil className="!size-3.5" />
            </Button>
          </div>
          {/* 打开会话文件夹（系统文件管理器） */}
          {sessionPath && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="titlebar-no-drag h-7 w-7 flex-shrink-0 text-foreground/40 hover:bg-foreground/[0.04]"
                  onClick={handleOpenSessionFolder}
                >
                  <FolderOpen className="!size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>{t('agentHeader.openSessionFolder')}</p>
              </TooltipContent>
            </Tooltip>
          )}
          {/* 文件面板打开按钮（仅面板关闭时显示） */}
          {!isPanelOpen && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="relative titlebar-no-drag h-7 w-7 flex-shrink-0"
                  onClick={togglePanel}
                >
                  <PanelRight className="!size-3.5" />
                  {hasFileChanges && (
                    <span className="absolute -top-0.5 -right-0.5 !size-2 rounded-full bg-primary animate-pulse" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>{t('agentHeader.openFilePanel')}</p>
              </TooltipContent>
            </Tooltip>
          )}
        </>
      )}
    </div>
  )
}
