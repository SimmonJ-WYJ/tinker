/**
 * 左侧 Sidebar 底部项目文件分区
 *
 * - 收起态：标题条 + 最近 3 个文件
 * - 展开态：头部（上传/Finder/折叠）+ 附加目录 + FileBrowser
 * - Sidebar 图标态（48px）：上层 LeftSidebar 已条件短路
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'
import {
  ChevronRight,
  ChevronDown,
  ExternalLink,
  Upload,
  Loader2,
  Info,
  MoreHorizontal,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
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
  DropdownMenu,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { FileBrowser, FileTypeIcon, WorkspaceFileMenuContent } from '@/components/file-browser'
import { useFormatRelativeTime } from '@/utils/format-relative-time'
import { fileToBase64 } from '@/lib/file-utils'
import { cn } from '@/lib/utils'
import {
  MENTION_DRAG_MIME,
  buildFileMentionPayload,
  createMultiFileDragImage,
} from '@/components/agent/mention-drag-payload'
import type { AgentPendingMention } from '@/atoms/agent-atoms'
import { useT } from '@/hooks/useT'
import { Trans } from '@/components/common/Trans'
import type { RecentFileEntry } from '@asci/shared'
import {
  currentAgentWorkspaceIdAtom,
  agentWorkspacesAtom,
  workspaceFilesVersionAtom,
  workspaceAttachedDirectoriesMapAtom,
  sidebarProjectFilesExpandedMapAtom,
  recentWorkspaceFilesAtom,
  addPendingMentionsAtom,
} from '@/atoms/agent-atoms'
import { useOpenInRightPanel } from '@/hooks/useOpenInRightPanel'
import {
  formatProjectFilesCount,
  createVersionGuard,
} from './project-files-helpers'
import { AttachedDirsSection } from './AttachedDirsSection'

const RECENT_LIMIT = 3

export function sidebarProjectFilesHeaderClassName(): string {
  return 'h-8 mx-2 my-0.5 p-2 rounded-[10px] flex items-center gap-2 text-sm font-medium text-foreground/30 hover:bg-primary/5 transition-colors cursor-pointer'
}

export function SidebarProjectFilesSection(): React.ReactElement | null {
  const { t } = useT('nav')
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const workspaces = useAtomValue(agentWorkspacesAtom)
  const workspaceSlug = workspaces.find((w) => w.id === currentWorkspaceId)?.slug ?? null

  const filesVersion = useAtomValue(workspaceFilesVersionAtom)
  const setFilesVersion = useSetAtom(workspaceFilesVersionAtom)

  const [expandedMap, setExpandedMap] = useAtom(sidebarProjectFilesExpandedMapAtom)
  const isExpanded = currentWorkspaceId ? (expandedMap.get(currentWorkspaceId) ?? false) : false

  const [recent, setRecent] = useAtom(recentWorkspaceFilesAtom)
  const guardRef = React.useRef(createVersionGuard())

  const wsAttachedDirsMap = useAtomValue(workspaceAttachedDirectoriesMapAtom)
  const setWsAttachedDirsMap = useSetAtom(workspaceAttachedDirectoriesMapAtom)
  const wsAttachedDirs = currentWorkspaceId ? (wsAttachedDirsMap.get(currentWorkspaceId) ?? []) : []

  // 加载工作区级附加目录（SidePanel 重构后不再加载，由本组件自行负责）
  React.useEffect(() => {
    if (!workspaceSlug || !currentWorkspaceId) return
    window.electronAPI.getWorkspaceDirectories(workspaceSlug)
      .then((dirs) => {
        setWsAttachedDirsMap((prev) => {
          const map = new Map(prev)
          map.set(currentWorkspaceId, dirs)
          return map
        })
      })
      .catch(console.error)
  }, [workspaceSlug, currentWorkspaceId, setWsAttachedDirsMap])

  const openInRightPanel = useOpenInRightPanel()

  const [workspaceFilesPath, setWorkspaceFilesPath] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!workspaceSlug) {
      setWorkspaceFilesPath(null)
      return
    }
    window.electronAPI
      .getWorkspaceFilesPath(workspaceSlug)
      .then(setWorkspaceFilesPath)
      .catch(() => setWorkspaceFilesPath(null))
  }, [workspaceSlug])

  React.useEffect(() => {
    if (!currentWorkspaceId || !workspaceSlug) {
      setRecent(null)
      return
    }
    const ticket = guardRef.current.issue(currentWorkspaceId)
    window.electronAPI
      .listRecentWorkspaceFiles({ workspaceSlug, limit: RECENT_LIMIT })
      .then((result) => {
        if (!guardRef.current.check(ticket, currentWorkspaceId)) return
        setRecent({
          workspaceId: currentWorkspaceId,
          files: result.files,
          totalCount: result.totalCount,
          capped: result.capped,
        })
      })
      .catch((err) => {
        if (!guardRef.current.check(ticket, currentWorkspaceId)) return
        console.error('[SidebarProjectFiles] 加载最近文件失败:', err)
        setRecent({ workspaceId: currentWorkspaceId, files: [], totalCount: 0, capped: false })
      })
  }, [currentWorkspaceId, workspaceSlug, filesVersion, setRecent])

  const handleDetachWorkspaceDirectory = React.useCallback(async (dirPath: string) => {
    if (!workspaceSlug || !currentWorkspaceId) return
    try {
      const updated = await window.electronAPI.detachWorkspaceDirectory({ workspaceSlug, directoryPath: dirPath })
      setWsAttachedDirsMap((prev) => {
        const map = new Map(prev)
        if (updated.length > 0) { map.set(currentWorkspaceId, updated) } else { map.delete(currentWorkspaceId) }
        return map
      })
    } catch (error) {
      console.error('[SidebarProjectFiles] 移除工作区附加目录失败:', error)
    }
  }, [workspaceSlug, currentWorkspaceId, setWsAttachedDirsMap])

  const attachWorkspaceDir = React.useCallback(async (dirPath: string) => {
    if (!workspaceSlug || !currentWorkspaceId) return
    const updated = await window.electronAPI.attachWorkspaceDirectory({ workspaceSlug, directoryPath: dirPath })
    setWsAttachedDirsMap((prev) => {
      const map = new Map(prev)
      map.set(currentWorkspaceId, updated)
      return map
    })
  }, [workspaceSlug, currentWorkspaceId, setWsAttachedDirsMap])

  const handleWorkspaceFoldersDropped = React.useCallback(async (folderPaths: string[]) => {
    for (const dirPath of folderPaths) {
      try { await attachWorkspaceDir(dirPath) } catch (error) {
        console.error('[SidebarProjectFiles] 拖拽附加工作区文件夹失败:', error)
      }
    }
  }, [attachWorkspaceDir])

  const [isUploading, setIsUploading] = React.useState(false)
  const [isDragOver, setIsDragOver] = React.useState(false)

  /**
   * 收起态 RecentFileItem 多选 state（Codex / VSCode 风格）。
   * - key 为 relPath；anchor 用于 Shift+click range 起点；容器 ref 限定 querySelectorAll 范围。
   * - 仅作用于"最近 3 个文件"那 3 行；展开态由 FileBrowser 自管。
   */
  const [selectedRecentPaths, setSelectedRecentPaths] = React.useState<Set<string>>(new Set())
  const anchorRelPathRef = React.useRef<string | null>(null)
  const recentContainerRef = React.useRef<HTMLDivElement>(null)
  // 跨组件互斥 owner 标识
  const selectionOwnerId = React.useRef<string>(`recent-files-${Math.random().toString(36).slice(2, 8)}`).current

  // 跨组件互斥：自己 selection 变非空时广播 claim；监听到 owner 非自己时清空
  React.useEffect(() => {
    if (selectedRecentPaths.size === 0) return
    window.dispatchEvent(new CustomEvent('asci-file-selection-claim', { detail: { owner: selectionOwnerId } }))
  }, [selectedRecentPaths, selectionOwnerId])
  React.useEffect(() => {
    const handler = (e: Event): void => {
      const owner = (e as CustomEvent<{ owner: string }>).detail?.owner
      if (owner !== selectionOwnerId) setSelectedRecentPaths(new Set())
    }
    window.addEventListener('asci-file-selection-claim', handler)
    return () => window.removeEventListener('asci-file-selection-claim', handler)
  }, [selectionOwnerId])

  const handleRecentSelect = React.useCallback((file: RecentFileEntry, opts: { multi: boolean; range: boolean }) => {
    if (opts.range && anchorRelPathRef.current && anchorRelPathRef.current !== file.relPath) {
      const rows = recentContainerRef.current?.querySelectorAll<HTMLElement>('[data-recent-relpath]')
      if (rows && rows.length > 0) {
        const ordered: string[] = []
        rows.forEach((el) => {
          const p = el.getAttribute('data-recent-relpath')
          if (p) ordered.push(p)
        })
        const startIdx = ordered.indexOf(anchorRelPathRef.current)
        const endIdx = ordered.indexOf(file.relPath)
        if (startIdx !== -1 && endIdx !== -1) {
          const [lo, hi] = startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx]
          const next = new Set<string>()
          for (let i = lo; i <= hi; i++) {
            const p = ordered[i]
            if (p) next.add(p)
          }
          if (next.size > 0) {
            setSelectedRecentPaths(next)
            return
          }
        }
      }
    }
    if (opts.multi) {
      setSelectedRecentPaths((prev) => {
        const next = new Set(prev)
        if (next.has(file.relPath)) next.delete(file.relPath)
        else next.add(file.relPath)
        return next
      })
      anchorRelPathRef.current = file.relPath
      return
    }
    setSelectedRecentPaths(new Set([file.relPath]))
    anchorRelPathRef.current = file.relPath
  }, [])

  // Esc 清空多选：焦点不在输入控件 + 有选中时才响应
  React.useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (selectedRecentPaths.size === 0) return
      const target = e.target as HTMLElement | null
      if (target?.matches('input, textarea, [contenteditable="true"]')) return
      setSelectedRecentPaths(new Set())
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [selectedRecentPaths.size])

  // 切换 workspace 时清空 selection 和 anchor（避免跨 workspace 残留）
  React.useEffect(() => {
    setSelectedRecentPaths(new Set())
    anchorRelPathRef.current = null
  }, [currentWorkspaceId])

  /** RecentFileItem 拖拽时拼 payload：单选 / 未被选中 → 单 mention；多选当前项 → 数组 */
  const buildRecentDragPayload = React.useCallback(
    (file: RecentFileEntry): AgentPendingMention | AgentPendingMention[] => {
      const single = buildFileMentionPayload({ relPath: file.relPath, name: file.name })
      if (!selectedRecentPaths.has(file.relPath) || selectedRecentPaths.size <= 1) return single
      if (!recent) return single
      const items: AgentPendingMention[] = []
      for (const f of recent.files) {
        if (selectedRecentPaths.has(f.relPath)) {
          items.push(buildFileMentionPayload({ relPath: f.relPath, name: f.name }))
        }
      }
      return items.length > 1 ? items : single
    },
    [selectedRecentPaths, recent],
  )

  const handleFilesUploaded = React.useCallback(() => {
    setFilesVersion((prev) => prev + 1)
  }, [setFilesVersion])

  const handleSelectFiles = React.useCallback(async () => {
    if (!workspaceSlug) return
    try {
      const result = await window.electronAPI.openFileDialog()
      if (result.files.length === 0) return
      setIsUploading(true)
      await window.electronAPI.saveFilesToWorkspaceFiles({
        workspaceSlug,
        files: result.files.map((f) => ({ filename: f.filename, data: f.data })),
      })
      handleFilesUploaded()
      toast.success(t('projectFiles.toast.added', { count: result.files.length }))
    } catch (error) {
      console.error('[SidebarProjectFiles] 选择文件失败:', error)
      toast.error(t('projectFiles.toast.uploadFailed'))
    } finally {
      setIsUploading(false)
    }
  }, [workspaceSlug, handleFilesUploaded, t])

  const uploadFiles = React.useCallback(async (files: globalThis.File[]): Promise<void> => {
    if (files.length === 0 || !workspaceSlug) return
    setIsUploading(true)
    try {
      const fileEntries: Array<{ filename: string; data: string }> = []
      for (const file of files) {
        const base64 = await fileToBase64(file)
        fileEntries.push({ filename: file.name, data: base64 })
      }
      await window.electronAPI.saveFilesToWorkspaceFiles({
        workspaceSlug,
        files: fileEntries,
      })
      handleFilesUploaded()
      toast.success(t('projectFiles.toast.added', { count: files.length }))
    } catch (error) {
      console.error('[SidebarProjectFiles] 文件上传失败:', error)
      toast.error(t('projectFiles.toast.uploadFailed'))
    } finally {
      setIsUploading(false)
    }
  }, [workspaceSlug, handleFilesUploaded, t])

  const handleDrop = React.useCallback(async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    if (!workspaceSlug || !currentWorkspaceId) return
    const droppedFiles = Array.from(e.dataTransfer.files)
    if (droppedFiles.length === 0) return

    // 收起态下 drop → 先展开，让用户看到文件加进来
    if (!isExpanded) {
      const next = new Map(expandedMap)
      next.set(currentWorkspaceId, true)
      setExpandedMap(next)
    }

    const pathMap = new Map<string, globalThis.File>()
    const paths: string[] = []
    for (const f of droppedFiles) {
      try {
        const p = window.electronAPI.getPathForFile(f)
        if (p) {
          paths.push(p)
          pathMap.set(p, f)
        }
      } catch { /* 无路径时忽略 */ }
    }

    if (paths.length === 0) {
      await uploadFiles(droppedFiles)
      return
    }

    try {
      const { directories, files: filePaths } = await window.electronAPI.checkPathsType(paths)
      if (directories.length > 0) {
        await handleWorkspaceFoldersDropped(directories)
      }
      const regularFiles = filePaths.map((p) => pathMap.get(p)!).filter(Boolean)
      if (regularFiles.length > 0) {
        await uploadFiles(regularFiles)
      }
    } catch (error) {
      console.error('[SidebarProjectFiles] 路径检测失败，回退:', error)
      await uploadFiles(droppedFiles)
    }
  }, [workspaceSlug, currentWorkspaceId, isExpanded, expandedMap, setExpandedMap, handleWorkspaceFoldersDropped, uploadFiles])

  const [deleteTarget, setDeleteTarget] = React.useState<RecentFileEntry | null>(null)

  const confirmDelete = React.useCallback(async (): Promise<void> => {
    if (!deleteTarget || !workspaceFilesPath) {
      setDeleteTarget(null)
      return
    }
    try {
      await window.electronAPI.deleteFile(`${workspaceFilesPath}/${deleteTarget.relPath}`)
      setFilesVersion((v) => v + 1)
      toast.success(t('projectFiles.toast.deleted', { name: deleteTarget.name }))
    } catch (error) {
      console.error('[SidebarProjectFiles] 删除文件失败:', error)
      toast.error(t('projectFiles.toast.deleteFailed'))
    } finally {
      setDeleteTarget(null)
    }
  }, [deleteTarget, workspaceFilesPath, setFilesVersion, t])

  if (!currentWorkspaceId) return null

  const showRecent = recent && recent.workspaceId === currentWorkspaceId
  const totalCount = showRecent ? recent.totalCount : null
  const capped = showRecent ? recent.capped : false
  const countLabel = formatProjectFilesCount(totalCount, capped)

  const toggleExpanded = (): void => {
    const next = new Map(expandedMap)
    next.set(currentWorkspaceId, !isExpanded)
    setExpandedMap(next)
  }

  return (
    <div
      className="relative flex-shrink-0"
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setIsDragOver(true)
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setIsDragOver(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        setIsDragOver(false)
      }}
      onDrop={handleDrop}
    >
      {/* 顶部渐变遮罩：替代分割线，让上方滚动列表在贴近本区时柔和淡出到背景 */}
      <div className="pointer-events-none absolute -top-6 left-0 right-0 h-6 z-10 bg-gradient-to-b from-transparent to-background" />
      <div
        className={sidebarProjectFilesHeaderClassName()}
        onClick={toggleExpanded}
      >
        <span>{t('projectFiles.title')} {countLabel}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="size-3 text-foreground/40 cursor-help" />
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-[260px]">
            <p>{t('projectFiles.tooltip')}</p>
          </TooltipContent>
        </Tooltip>
        <div className="flex-1" />
        {isExpanded ? (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 flex-shrink-0 text-foreground/40 hover:bg-foreground/[0.04]"
                  disabled={isUploading || !workspaceSlug}
                  onClick={(e) => { e.stopPropagation(); void handleSelectFiles() }}
                >
                  {isUploading ? <Loader2 className="!size-3 animate-spin" /> : <Upload className="!size-3" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{t('projectFiles.uploadTooltip')}</TooltipContent>
            </Tooltip>

            {workspaceFilesPath && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 flex-shrink-0 text-foreground/40 hover:bg-foreground/[0.04]"
                    onClick={(e) => { e.stopPropagation(); window.electronAPI.openFile(workspaceFilesPath).catch(console.error) }}
                  >
                    <ExternalLink className="!size-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">{t('projectFiles.openInFinderTooltip')}</TooltipContent>
              </Tooltip>
            )}

            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={(e) => { e.stopPropagation(); toggleExpanded() }}
              className="rounded text-foreground/40 hover:bg-foreground/[0.04]"
              aria-label={t('projectFiles.collapseLabel')}
            >
              <ChevronDown className="!size-3" />
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={(e) => { e.stopPropagation(); toggleExpanded() }}
            className="rounded text-foreground/40 hover:bg-transparent"
            aria-label={t('projectFiles.expandLabel')}
          >
            <ChevronRight className="!size-3" />
          </Button>
        )}
      </div>

      {/* 折叠态默认只显示标题，不再列出最近文件预览（点展开看完整文件树）。
          RecentFileItem 及其多选/拖拽逻辑保留备用，当前不渲染。 */}

      {isExpanded && (
        <div
          className="flex flex-col overflow-y-auto scrollbar-thin"
          style={{ maxHeight: 'min(40vh, 480px)' }}
        >
          {wsAttachedDirs.length > 0 && (
            <AttachedDirsSection
              attachedDirs={wsAttachedDirs}
              onDetach={handleDetachWorkspaceDirectory}
              refreshVersion={filesVersion}
            />
          )}
          {workspaceFilesPath && (
            <FileBrowser
              rootPath={workspaceFilesPath}
              hideToolbar
              embedded
              baseIndent={0}
              hideEmpty={wsAttachedDirs.length > 0}
            />
          )}
        </div>
      )}

      {/* Drag overlay 覆盖层 */}
      {isDragOver && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-primary/8 backdrop-blur-[1px] border-2 border-dashed border-primary/60 rounded pointer-events-none">
          <span className="text-sm font-medium text-primary">{t('projectFiles.dragOverlay')}</span>
        </div>
      )}

      {/* 删除确认对话框 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('projectFiles.deleteDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              <Trans
                ns="nav"
                i18nKey="projectFiles.deleteDialog.description"
                values={{ name: deleteTarget?.name ?? '' }}
                components={{ strong: <strong /> }}
              />
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ===== RecentFileItem — 收起态最近文件项 =====

interface RecentFileItemProps {
  file: RecentFileEntry
  workspaceFilesPath: string | null
  /** 是否被多选 state 选中（视觉 + 拖拽分支） */
  isSelected: boolean
  /** 选中行为：multi=Cmd/Ctrl，range=Shift */
  onSelect: (file: RecentFileEntry, opts: { multi: boolean; range: boolean }) => void
  /** 拖拽时拼 payload：单选 → 单 mention；多选当前项 → 数组 */
  getDragPayload: (file: RecentFileEntry) => AgentPendingMention | AgentPendingMention[]
  onPreview: () => void
  onRequestDelete: () => void
  /** 重命名 / 移动成功后回调，用于刷新最近文件列表 */
  onAfterMutation: () => void
}

function RecentFileItem({
  file,
  workspaceFilesPath,
  isSelected,
  onSelect,
  getDragPayload,
  onPreview,
  onRequestDelete,
  onAfterMutation,
}: RecentFileItemProps): React.ReactElement {
  const { t } = useT('nav')
  const formatRelativeTime = useFormatRelativeTime()
  const [hovered, setHovered] = React.useState(false)
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  const [editName, setEditName] = React.useState('')
  const [moving, setMoving] = React.useState(false)
  const [isDragging, setIsDragging] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const justStartedEditing = React.useRef(false)

  // F43: 作为拖拽源 — 把最近文件方块拖到对话框生成 @mention chip（支持多选多 chip）
  const dragImageRef = React.useRef<HTMLElement | null>(null)

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>): void => {
    if (!file.relPath) return
    const payload = getDragPayload(file)
    e.dataTransfer.setData(MENTION_DRAG_MIME, JSON.stringify(payload))
    e.dataTransfer.effectAllowed = 'copy'
    // 多文件场景：macOS Finder 风格叠加 + 数字徽标
    if (Array.isArray(payload) && payload.length > 1) {
      const img = createMultiFileDragImage(payload.length, file.name)
      dragImageRef.current = img
      e.dataTransfer.setDragImage(img, 20, 20)
    }
    setIsDragging(true)
  }

  const handleDragEnd = (): void => {
    setIsDragging(false)
    if (dragImageRef.current) {
      dragImageRef.current.remove()
      dragImageRef.current = null
    }
  }

  const noPath = !workspaceFilesPath
  const absolutePath = workspaceFilesPath ? `${workspaceFilesPath}/${file.relPath}` : null
  const showActions = (hovered || menuOpen) && !editing

  const handleShowInFolder = (): void => {
    if (absolutePath) window.electronAPI.showInFolder(absolutePath).catch(console.error)
  }

  const startRename = (): void => {
    setEditName(file.name)
    setEditing(true)
    justStartedEditing.current = true
    setTimeout(() => {
      justStartedEditing.current = false
      const input = inputRef.current
      if (!input) return
      input.focus()
      const lastDot = file.name.lastIndexOf('.')
      if (lastDot > 0) input.setSelectionRange(0, lastDot)
      else input.select()
    }, 100)
  }

  const saveRename = async (): Promise<void> => {
    if (justStartedEditing.current) return
    const trimmed = editName.trim()
    if (!trimmed || trimmed === file.name || !absolutePath) {
      setEditing(false)
      return
    }
    // 同名检查（父目录）
    const parentDir = absolutePath.substring(0, absolutePath.lastIndexOf('/'))
    try {
      const { entries } = await window.electronAPI.listDirectory(parentDir)
      if (entries.some((s) => s.name === trimmed && s.path !== absolutePath)) {
        toast.error(t('projectFiles.toast.duplicateName'))
        return
      }
    } catch { /* 列表失败跳过检查，交给 rename 本身报错 */ }
    try {
      await window.electronAPI.renameFile(absolutePath, trimmed)
      setEditing(false)
      onAfterMutation()
    } catch (err) {
      console.error('[RecentFileItem] 重命名失败:', err)
      toast.error(err instanceof Error ? err.message : t('projectFiles.toast.renameFailed'))
    }
  }

  const handleMove = async (): Promise<void> => {
    if (!absolutePath) return
    setMoving(true)
    try {
      const result = await window.electronAPI.openFolderDialog()
      if (!result) return
      await window.electronAPI.moveFile(absolutePath, result.path)
      onAfterMutation()
      toast.success(t('projectFiles.toast.moved', { name: file.name }))
    } catch (err) {
      console.error('[RecentFileItem] 移动失败:', err)
      toast.error(t('projectFiles.toast.moveFailed'))
    } finally {
      setMoving(false)
    }
  }

  const addPendingMentions = useSetAtom(addPendingMentionsAtom)

  const handleReference = React.useCallback(() => {
    if (noPath || editing) return
    addPendingMentions([buildFileMentionPayload({ relPath: file.relPath, name: file.name })])
  }, [addPendingMentions, file.relPath, file.name, noPath, editing])

  return (
    <div
      role="button"
      tabIndex={noPath || editing ? -1 : 0}
      aria-disabled={noPath || undefined}
      title={editing ? undefined : file.relPath}
      draggable={!noPath && !editing}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      data-recent-relpath={file.relPath}
      onClick={(e) => {
        if (noPath || editing) return
        e.stopPropagation()
        const multi = e.metaKey || e.ctrlKey
        const range = e.shiftKey
        onSelect(file, { multi, range })
        // 普通 click（无 multi / range）才触发预览，与 FileBrowser 行为对齐
        if (!multi && !range) onPreview()
      }}
      onKeyDown={(e) => {
        if (noPath || editing) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onPreview()
        }
      }}
      onContextMenu={(e) => {
        if (noPath || editing) return
        e.preventDefault()
        e.stopPropagation()
        // 右键未选中项时单选该项，与 FileBrowser 右键语义一致
        if (!isSelected) onSelect(file, { multi: false, range: false })
        setMenuOpen(true)
      }}
      className={cn(
        'w-full h-[24px] pl-6 pr-3 flex items-center gap-2.5 text-sm text-left',
        noPath && 'opacity-50 cursor-not-allowed',
        isSelected ? 'bg-foreground/[0.08] text-foreground/85' : 'text-foreground/70',
        !noPath && !editing && !isSelected && 'hover:bg-foreground/[0.04]',
        !noPath && !editing && 'cursor-pointer',
        isDragging && 'opacity-50',
      )}
    >
      <span className="flex-shrink-0 w-[18px] h-[18px] flex items-center justify-center">
        <FileTypeIcon name={file.name} isDirectory={false} size={12} />
      </span>
      {editing ? (
        <input
          ref={inputRef}
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') {
              e.preventDefault()
              void saveRename()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setEditing(false)
            }
          }}
          onBlur={() => void saveRename()}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 min-w-0 bg-transparent text-sm border-b border-primary/50 outline-none py-0"
          maxLength={255}
        />
      ) : (
        <span className="truncate flex-1">{file.name}</span>
      )}

      {/* 右侧：时间 ↔ 三点菜单；编辑态隐藏 */}
      {!editing && (
        <div className="relative flex-shrink-0 flex items-center justify-end min-w-[48px] h-5">
          <span className={cn(
            'text-foreground/35 text-sm tabular-nums transition-opacity duration-100 select-none',
            showActions ? 'opacity-0 pointer-events-none' : 'opacity-100',
          )}>
            {formatRelativeTime(file.mtimeMs)}
          </span>
          <div
            className={cn(
              'absolute right-0 top-0 transition-opacity duration-100',
              showActions ? 'opacity-100' : 'opacity-0 pointer-events-none',
            )}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="rounded text-foreground/50 hover:bg-foreground/[0.08] hover:text-foreground/80"
                >
                  <MoreHorizontal className="!size-3" />
                </Button>
              </DropdownMenuTrigger>
              <WorkspaceFileMenuContent
                align="end"
                onReference={handleReference}
                onShowInFolder={handleShowInFolder}
                onRename={startRename}
                onMove={() => { void handleMove() }}
                onDelete={onRequestDelete}
                moveDisabled={moving}
              />
            </DropdownMenu>
          </div>
        </div>
      )}
    </div>
  )
}
