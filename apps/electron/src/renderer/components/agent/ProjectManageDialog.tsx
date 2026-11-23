/**
 * ProjectManageDialog — 科研项目管理弹窗
 *
 * 列表展示所有项目，支持重命名、删除、拖拽排序。
 * 日常切换/新建走 ProjectSwitcher 的 Popover，管理走此弹窗。
 */

import * as React from 'react'
import { useAtom } from 'jotai'
import { FolderOpen, Pencil, Trash2, GripVertical } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
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
import {
  agentWorkspacesAtom,
  currentAgentWorkspaceIdAtom,
} from '@/atoms/agent-atoms'
import { useT } from '@/hooks/useT'
import type { AgentWorkspace } from '@asci/shared'

interface ProjectManageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ProjectManageDialog({ open, onOpenChange }: ProjectManageDialogProps): React.ReactElement {
  const nativeProjects = Boolean(window.__TAURI_FORMAL__?.bindProjectDirectory)
  const { t } = useT('nav')
  const { t: tConv } = useT('conversation')
  const [workspaces, setWorkspaces] = useAtom(agentWorkspacesAtom)
  const [currentWorkspaceId, setCurrentWorkspaceId] = useAtom(currentAgentWorkspaceIdAtom)

  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editName, setEditName] = React.useState('')
  const editInputRef = React.useRef<HTMLInputElement>(null)
  const [deleteTargetId, setDeleteTargetId] = React.useState<string | null>(null)

  const [dragId, setDragId] = React.useState<string | null>(null)
  const [dropIndicator, setDropIndicator] = React.useState<{ id: string; position: 'before' | 'after' } | null>(null)

  // ===== 重命名 =====

  const handleStartRename = (e: React.MouseEvent, ws: AgentWorkspace): void => {
    e.stopPropagation()
    setEditingId(ws.id)
    setEditName(ws.slug === 'default' ? tConv('projectSwitcher.defaultName') : ws.name)
    requestAnimationFrame(() => {
      editInputRef.current?.focus()
      editInputRef.current?.select()
    })
  }

  const handleRename = async (): Promise<void> => {
    if (!editingId) return
    const trimmed = editName.trim()

    if (!trimmed) {
      setEditingId(null)
      return
    }

    try {
      const updated = await window.electronAPI.updateAgentWorkspace(editingId, { name: trimmed })
      setWorkspaces((prev) => prev.map((w) => (w.id === updated.id ? updated : w)))
    } catch (error) {
      const msg = error instanceof Error ? error.message : t('projectManage.renameFailed')
      toast.error(msg)
    } finally {
      setEditingId(null)
    }
  }

  const handleRenameKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      if (e.nativeEvent.isComposing) return
      e.preventDefault()
      handleRename()
    } else if (e.key === 'Escape') {
      setEditingId(null)
    }
  }

  // ===== 删除 =====

  const handleStartDelete = (e: React.MouseEvent, wsId: string): void => {
    e.stopPropagation()
    setDeleteTargetId(wsId)
  }

  const handleConfirmDelete = async (): Promise<void> => {
    if (!deleteTargetId) return

    try {
      await window.electronAPI.deleteAgentWorkspace(deleteTargetId)
      const remaining = workspaces.filter((w) => w.id !== deleteTargetId)
      setWorkspaces(remaining)

      if (deleteTargetId === currentWorkspaceId && remaining.length > 0) {
        setCurrentWorkspaceId(remaining[0]!.id)
        window.electronAPI.updateSettings({
          agentWorkspaceId: remaining[0]!.id,
        }).catch(console.error)
      }
    } catch (error) {
      console.error('[ProjectManage] 删除科研项目失败:', error)
    } finally {
      setDeleteTargetId(null)
    }
  }

  const canDelete = (ws: AgentWorkspace): boolean => {
    return !nativeProjects && ws.slug !== 'default' && workspaces.length > 1
  }

  // ===== 拖拽排序 =====

  const handleDragStart = (e: React.DragEvent, wsId: string): void => {
    setDragId(wsId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', wsId)
  }

  const handleDragOver = (e: React.DragEvent, wsId: string): void => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (!dragId || wsId === dragId) {
      setDropIndicator(null)
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientY - rect.top) / rect.height
    let position: 'before' | 'after'
    if (ratio < 0.35) {
      position = 'before'
    } else if (ratio > 0.65) {
      position = 'after'
    } else {
      if (dropIndicator?.id === wsId) return
      position = ratio < 0.5 ? 'before' : 'after'
    }
    if (dropIndicator?.id === wsId && dropIndicator.position === position) return
    setDropIndicator({ id: wsId, position })
  }

  const handleDragLeave = (e: React.DragEvent): void => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDropIndicator(null)
    }
  }

  const handleDrop = (e: React.DragEvent, targetId: string): void => {
    e.preventDefault()
    if (!dragId || dragId === targetId || !dropIndicator || dropIndicator.id !== targetId) {
      setDragId(null)
      setDropIndicator(null)
      return
    }

    const fromIdx = workspaces.findIndex((w) => w.id === dragId)
    const toIdx = workspaces.findIndex((w) => w.id === targetId)
    if (fromIdx === -1 || toIdx === -1) return

    const reordered = [...workspaces]
    const [moved] = reordered.splice(fromIdx, 1)
    const adjustedToIdx = fromIdx < toIdx ? toIdx - 1 : toIdx
    const insertIdx = dropIndicator.position === 'after' ? adjustedToIdx + 1 : adjustedToIdx
    reordered.splice(insertIdx, 0, moved!)

    setWorkspaces(reordered)
    setDragId(null)
    setDropIndicator(null)

    window.electronAPI.reorderAgentWorkspaces(reordered.map((w) => w.id)).catch(console.error)
  }

  const handleDragEnd = (): void => {
    setDragId(null)
    setDropIndicator(null)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('projectManage.title')}</DialogTitle>
            <DialogDescription>
              {t(nativeProjects ? 'projectManage.nativeDescription' : 'projectManage.description')}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[420px] overflow-y-auto flex flex-col gap-0.5 mt-2 scrollbar-thin">
            {workspaces.map((ws) => (
              <div key={ws.id} className="relative">
                {dropIndicator?.id === ws.id && dropIndicator.position === 'before' && (
                  <div className="absolute top-0 left-1 right-1 h-0.5 bg-primary rounded-full z-10" />
                )}

                <div
                  draggable={!nativeProjects && editingId !== ws.id}
                  onDragStart={nativeProjects ? undefined : (e) => handleDragStart(e, ws.id)}
                  onDragOver={nativeProjects ? undefined : (e) => handleDragOver(e, ws.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={nativeProjects ? undefined : (e) => handleDrop(e, ws.id)}
                  onDragEnd={handleDragEnd}
                  className={cn(
                    'group w-full flex items-center gap-2 px-2 py-2 rounded-md text-sm transition-colors',
                    ws.id === currentWorkspaceId
                      ? 'bg-primary/5'
                      : 'hover:bg-foreground/[0.04]',
                    dragId === ws.id && 'opacity-40',
                  )}
                >
                  {!nativeProjects && <GripVertical size={12} className="flex-shrink-0 text-foreground/30 cursor-grab active:cursor-grabbing" />}
                  <FolderOpen size={13} className="flex-shrink-0 text-foreground/40" />

                  {editingId === ws.id ? (
                    <input
                      ref={editInputRef}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={handleRenameKeyDown}
                      onBlur={handleRename}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 min-w-0 bg-transparent text-sm text-foreground border-b border-primary/50 outline-none px-0.5"
                      maxLength={50}
                    />
                  ) : (
                    <>
                      <span className="flex-1 min-w-0 truncate">{ws.slug === 'default' ? tConv('projectSwitcher.defaultName') : ws.name}</span>

                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                        {(!nativeProjects || ws.projectOrigin) && <Button
                          variant="ghost"
                          onClick={(e) => handleStartRename(e, ws)}
                          className="h-auto p-1 rounded hover:bg-foreground/[0.08] text-foreground/40 hover:text-foreground/70 [&_svg]:size-3"
                          title={t('projectManage.renameTooltip')}
                        >
                          <Pencil size={12} />
                        </Button>}
                        {canDelete(ws) && (
                          <Button
                            variant="ghost"
                            onClick={(e) => handleStartDelete(e, ws.id)}
                            className="h-auto p-1 rounded hover:bg-destructive/10 text-foreground/40 hover:text-destructive [&_svg]:size-3"
                            title={t('projectManage.deleteTooltip')}
                          >
                            <Trash2 size={12} />
                          </Button>
                        )}
                      </div>
                    </>
                  )}
                </div>

                {dropIndicator?.id === ws.id && dropIndicator.position === 'after' && (
                  <div className="absolute bottom-0 left-1 right-1 h-0.5 bg-primary rounded-full z-10" />
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* 删除确认弹窗 */}
      <AlertDialog
        open={deleteTargetId !== null}
        onOpenChange={(v) => { if (!v) setDeleteTargetId(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('projectManage.deleteConfirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('projectManage.deleteConfirm.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('projectManage.deleteConfirm.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('projectManage.deleteConfirm.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
