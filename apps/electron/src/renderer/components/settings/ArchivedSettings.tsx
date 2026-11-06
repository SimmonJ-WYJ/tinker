/**
 * ArchivedSettings - 设置面板「已归档」Tab
 *
 * 展示当前工作区下所有已归档的 Agent 会话。
 * 复用 AgentSessionItem 渲染，保留取消归档 / 重命名 / 删除操作。
 * 点击会话项：打开会话并关闭设置面板。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import { Archive } from 'lucide-react'
import {
  agentSessionsAtom,
  agentSessionIndicatorMapAtom,
  currentAgentWorkspaceIdAtom,
  workingDoneSessionIdsAtom,
} from '@/atoms/agent-atoms'
import { tabsAtom, activeTabIdAtom, closeTab, updateTabTitle } from '@/atoms/tab-atoms'
import { settingsOpenAtom } from '@/atoms/settings-tab'
import { AgentSessionItem } from '@/components/agent/AgentSessionItem'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useOpenSession } from '@/hooks/useOpenSession'
import { useCleanupSessionState } from '@/hooks/useCleanupSessionState'
import { useSyncActiveTabSideEffects } from '@/hooks/useSyncActiveTabSideEffects'
import { useT } from '@/hooks/useT'

export function ArchivedSettings(): React.ReactElement {
  const { t } = useT('settings')
  const [agentSessions, setAgentSessions] = useAtom(agentSessionsAtom)
  const agentIndicatorMap = useAtomValue(agentSessionIndicatorMapAtom)
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const [tabs, setTabs] = useAtom(tabsAtom)
  const [activeTabId, setActiveTabId] = useAtom(activeTabIdAtom)
  const setSettingsOpen = useSetAtom(settingsOpenAtom)
  const setWorkingDone = useSetAtom(workingDoneSessionIdsAtom)
  const openSession = useOpenSession()
  const cleanupSessionState = useCleanupSessionState()
  const syncActiveTabSideEffects = useSyncActiveTabSideEffects()

  const [hoveredId, setHoveredId] = React.useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(null)

  const archivedSessions = React.useMemo(
    () => agentSessions
      .filter((s) => s.archived && (!currentWorkspaceId || s.workspaceId === currentWorkspaceId))
      .sort((a, b) => b.updatedAt - a.updatedAt),
    [agentSessions, currentWorkspaceId],
  )

  /** 删除一个 Set 条目（相等则返回原值以避免无意义 re-render） */
  const removeFromSet = React.useCallback((id: string) => {
    setWorkingDone((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }, [setWorkingDone])

  const handleSelect = (id: string, title: string): void => {
    openSession('agent', id, title)
    setSettingsOpen(false)
  }

  const handleRename = async (id: string, newTitle: string): Promise<void> => {
    try {
      const updated = await window.electronAPI.updateAgentSessionTitle(id, newTitle)
      setAgentSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
      setTabs((prev) => updateTabTitle(prev, id, newTitle))
    } catch (error) {
      console.error('[归档设置] 重命名失败:', error)
    }
  }

  const handleToggleArchive = async (id: string): Promise<void> => {
    try {
      const updated = await window.electronAPI.toggleArchiveAgentSession(id)
      setAgentSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
      // 取消归档让会话回到活跃列表，从 Working Done 集合移除残留
      if (!updated.archived) removeFromSet(id)
      toast.success(updated.archived ? t('archived.toast.archived') : t('archived.toast.unarchived'))
    } catch (error) {
      console.error('[归档设置] 切换归档状态失败:', error)
    }
  }

  const handleConfirmDelete = async (): Promise<void> => {
    if (!pendingDeleteId) return
    const wasActive = activeTabId === pendingDeleteId
    const tabResult = closeTab(tabs, activeTabId, pendingDeleteId, currentWorkspaceId)
    setTabs(tabResult.tabs)
    setActiveTabId(tabResult.activeTabId)
    if (wasActive) {
      const newActiveTab = tabResult.activeTabId
        ? tabResult.tabs.find((t) => t.id === tabResult.activeTabId) ?? null
        : null
      syncActiveTabSideEffects(newActiveTab)
    }
    cleanupSessionState(pendingDeleteId)
    try {
      await window.electronAPI.deleteAgentSession(pendingDeleteId)
      const sessions = await window.electronAPI.listAgentSessions()
      setAgentSessions(sessions)
    } catch (error) {
      console.error('[归档设置] 删除失败:', error)
      setAgentSessions((prev) => prev.filter((s) => s.id !== pendingDeleteId))
    } finally {
      setPendingDeleteId(null)
    }
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      {archivedSessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
          <div className="size-12 rounded-2xl bg-muted/50 flex items-center justify-center text-muted-foreground/60">
            <Archive size={22} />
          </div>
          <p className="text-sm text-muted-foreground">{t('archived.empty')}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {archivedSessions.map((session) => (
            <AgentSessionItem
              key={session.id}
              session={session}
              active={false}
              hovered={session.id === hoveredId}
              indicatorStatus={agentIndicatorMap.get(session.id) ?? 'idle'}
              actionSpacing="comfortable"
              onSelect={() => handleSelect(session.id, session.title)}
              onRequestDelete={() => setPendingDeleteId(session.id)}
              onRename={handleRename}
              onToggleArchive={handleToggleArchive}
              onMouseEnter={() => setHoveredId(session.id)}
              onMouseLeave={() => setHoveredId(null)}
            />
          ))}
        </div>
      )}

      <AlertDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => { if (!open) setPendingDeleteId(null) }}
      >
        <AlertDialogContent
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleConfirmDelete() } }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{t('archived.deleteDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('archived.deleteDialog.description')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('archived.common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('archived.common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  )
}
