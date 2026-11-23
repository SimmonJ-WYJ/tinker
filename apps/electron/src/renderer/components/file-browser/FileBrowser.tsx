/**
 * FileBrowser — 通用文件浏览器面板
 *
 * 显示指定根路径下的文件树，支持：
 * - 文件夹懒加载展开（Chevron 旋转动画）
 * - 单击选中、Cmd/Ctrl+Click 多选
 * - 选中后显示三点菜单（打开 / 在文件夹中显示 / 重命名 / 移动 / 删除）
 * - 文件/文件夹删除（带确认对话框）
 * - 原位重命名（含同名检查）
 * - 自动刷新
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  ChevronRight,
  RefreshCw,
  ExternalLink,
  MoreHorizontal,
  FolderOpen,
  Upload,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
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
import { cn } from '@/lib/utils'
import { addPendingMentionsAtom, workspaceFilesVersionAtom, type AgentPendingMention } from '@/atoms/agent-atoms'
import { useOpenInRightPanel } from '@/hooks/useOpenInRightPanel'
import { useT } from '@/hooks/useT'
import { useShortcut } from '@/hooks/useShortcut'
import { Trans } from '@/components/common/Trans'
import type { FileEntry } from '@asci/shared'
import { FileTypeIcon } from './FileTypeIcon'
import { WorkspaceFileMenuContent } from './WorkspaceFileMenuContent'
import {
  MENTION_DRAG_MIME,
  buildFileMentionPayload,
  computeRelPath,
  createMultiFileDragImage,
} from '../agent/mention-drag-payload'

interface FileBrowserProps {
  rootPath: string
  /** 隐藏内置顶部工具栏（面包屑 + 按钮），由外部自行渲染 */
  hideToolbar?: boolean
  /** 嵌入模式：不使用内部 ScrollArea 和 h-full，由外部容器控制布局和滚动 */
  embedded?: boolean
  /** 根层左缩进基准（px）。默认 8；侧边栏传 0 让深度0图标对齐左侧菜单图标列 */
  baseIndent?: number
  /** 文件行容器的外层 class；默认 mx-2，嵌入方可覆盖以对齐外部标题/Tab */
  rowClassName?: string
  /** 禁用文件行 hover 背景；选中背景仍保留 */
  disableRowHoverBackground?: boolean
  /** 隐藏文件/文件夹类型图标；保留目录展开箭头 */
  hideEntryIcons?: boolean
  /** 隐藏"目录为空"提示（当外部已有附加目录等内容时使用） */
  hideEmpty?: boolean
  /** 指定允许显示的隐藏条目（如会话文件区显示 .context） */
  visibleHiddenEntries?: string[]
  /**
   * 额外在根层隐藏的条目名（不进 isHiddenEntry 全局名单，避免误伤用户项目里的同名文件）。
   * 例：会话工作区根目录的 ASCI 身份 `CLAUDE.md` 是基础设施文件，仅在会话文件区隐藏。
   */
  hiddenRootEntries?: string[]
}

export function FileBrowser({
  rootPath,
  hideToolbar,
  embedded,
  hideEmpty,
  visibleHiddenEntries,
  hiddenRootEntries,
  baseIndent = 8,
  rowClassName = 'mx-2',
  disableRowHoverBackground = false,
  hideEntryIcons = false,
}: FileBrowserProps): React.ReactElement {
  const { t } = useT('nav')
  const [entries, setEntries] = React.useState<FileEntry[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const filesVersion = useAtomValue(workspaceFilesVersionAtom)

  // 选中状态
  const [selectedEntries, setSelectedEntries] = React.useState<Map<string, FileEntry>>(new Map())
  // 跨组件互斥 owner 标识；任一文件视图 select 时广播 claim，其它视图清空自己
  const selectionOwnerId = React.useRef<string>(`file-browser-${Math.random().toString(36).slice(2, 8)}`).current
  // Shift+click 区间选中的 anchor（上次单选 / toggle 的 path）
  const anchorPathRef = React.useRef<string | null>(null)
  // path → FileEntry 注册表，供 Shift+click 从 DOM 顺序反查 entry 元数据
  const entriesByPathRef = React.useRef<Map<string, FileEntry>>(new Map())
  // 文件树容器 ref，用于限定 querySelectorAll 范围
  const treeContainerRef = React.useRef<HTMLDivElement>(null)
  const registerEntries = React.useCallback((items: FileEntry[]) => {
    for (const it of items) entriesByPathRef.current.set(it.path, it)
  }, [])
  // 删除确认状态
  const [deleteTarget, setDeleteTarget] = React.useState<FileEntry | null>(null)
  const [deleteCount, setDeleteCount] = React.useState(1)
  // 重命名状态
  const [renamingPath, setRenamingPath] = React.useState<string | null>(null)
  // 移动中状态
  const [moving, setMoving] = React.useState(false)

  const selectedCount = selectedEntries.size

  /** 加载根目录 */
  const loadRoot = React.useCallback(async () => {
    if (!rootPath) return
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.listDirectory(rootPath, { visibleHiddenEntries })
      // 根层隐藏特定基础设施文件（如会话工作区的 ASCI 身份 CLAUDE.md）——仅 UI 不展示，
      // 文件仍在、Agent 工具仍可访问；不进 isHiddenEntry 全局名单以免误伤用户项目同名文件。
      const visible = hiddenRootEntries?.length
        ? result.entries.filter((e) => !hiddenRootEntries.includes(e.name))
        : result.entries
      setEntries(visible)
      // 重置注册表，并写入顶层 entries（子目录的 entries 由 FileTreeItem 展开时再注册）
      entriesByPathRef.current = new Map()
      for (const it of visible) entriesByPathRef.current.set(it.path, it)
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('fileBrowser.loadFailed')
      setError(msg)
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [rootPath, visibleHiddenEntries, hiddenRootEntries])

  React.useEffect(() => {
    loadRoot()
  }, [loadRoot, filesVersion])

  /**
   * 选中项（macOS Finder 风格）：
   * - range（Shift+click）→ anchor 到当前的可见行 range 替换 selection
   * - multi（Cmd/Ctrl+click）→ toggle 当前 entry 进/出 selection，更新 anchor
   * - 默认（普通 click / 右键 / 菜单 trigger）→ 替换为单选，更新 anchor
   * 跨组件互斥由 useFileSelectionClaim 通过 window CustomEvent 协调。
   */
  const handleSelect = React.useCallback((entry: FileEntry, opts: { multi: boolean; range: boolean }) => {
    if (opts.range && anchorPathRef.current && anchorPathRef.current !== entry.path) {
      const container = treeContainerRef.current
      const rows = container?.querySelectorAll<HTMLElement>('[data-file-path]')
      if (rows && rows.length > 0) {
        const orderedPaths: string[] = []
        rows.forEach((el) => {
          const p = el.getAttribute('data-file-path')
          if (p) orderedPaths.push(p)
        })
        const startIdx = orderedPaths.indexOf(anchorPathRef.current)
        const endIdx = orderedPaths.indexOf(entry.path)
        if (startIdx !== -1 && endIdx !== -1) {
          const [lo, hi] = startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx]
          const next = new Map<string, FileEntry>()
          for (let i = lo; i <= hi; i++) {
            const p = orderedPaths[i]
            if (!p) continue
            const ent = entriesByPathRef.current.get(p)
            if (ent) next.set(ent.path, ent)
          }
          if (next.size > 0) {
            setSelectedEntries(next)
            return
          }
        }
      }
    }
    if (opts.multi) {
      setSelectedEntries((prev) => {
        const next = new Map(prev)
        if (next.has(entry.path)) next.delete(entry.path)
        else next.set(entry.path, entry)
        return next
      })
      anchorPathRef.current = entry.path
      return
    }
    setSelectedEntries(new Map([[entry.path, entry]]))
    anchorPathRef.current = entry.path
  }, [])

  /** 点击空白区域清空选中（包括行间间距 / 容器底部空白） */
  const handleBackgroundClick = React.useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement | null
    if (target?.closest('[data-file-row]')) return
    setSelectedEntries(new Map())
  }, [])

  // Esc 清空多选：焦点不在输入控件 + 有选中时才响应
  React.useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (selectedEntries.size === 0) return
      const target = e.target as HTMLElement | null
      if (target?.matches('input, textarea, [contenteditable="true"]')) return
      setSelectedEntries(new Map())
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [selectedEntries.size])

  // 跨组件互斥：当自己 selection 变非空时广播 claim；监听到 owner 非自己时清空
  React.useEffect(() => {
    if (selectedEntries.size === 0) return
    window.dispatchEvent(new CustomEvent('asci-file-selection-claim', { detail: { owner: selectionOwnerId } }))
  }, [selectedEntries, selectionOwnerId])
  React.useEffect(() => {
    const handler = (e: Event): void => {
      const owner = (e as CustomEvent<{ owner: string }>).detail?.owner
      if (owner !== selectionOwnerId) setSelectedEntries(new Map())
    }
    window.addEventListener('asci-file-selection-claim', handler)
    return () => window.removeEventListener('asci-file-selection-claim', handler)
  }, [selectionOwnerId])

  /** 在文件夹中显示 */
  const handleShowInFolder = React.useCallback((entry: FileEntry) => {
    window.electronAPI.showInFolder(entry.path).catch(console.error)
  }, [])

  /** 开始重命名 */
  const handleStartRename = React.useCallback((entry: FileEntry) => {
    setRenamingPath(entry.path)
  }, [])

  /** 取消重命名 */
  const handleCancelRename = React.useCallback(() => {
    setRenamingPath(null)
  }, [])

  /** 执行重命名 */
  const handleRename = React.useCallback(async (filePath: string, newName: string): Promise<string | null> => {
    // 同名检查
    const parentDir = filePath.substring(0, filePath.lastIndexOf('/'))
    try {
      const { entries: siblings } = await window.electronAPI.listDirectory(parentDir, { visibleHiddenEntries })
      const conflict = siblings.some((s) => s.name === newName && s.path !== filePath)
      if (conflict) {
        return t('fileBrowser.duplicateName')
      }
    } catch {
      // 无法列出目录，跳过检查
    }

    try {
      await window.electronAPI.renameFile(filePath, newName)
      await loadRoot()
      setRenamingPath(null)
      setSelectedEntries(new Map())
      return null
    } catch (err) {
      return err instanceof Error ? err.message : t('fileBrowser.renameFailed')
    }
  }, [loadRoot, t])

  /** 触发删除（支持多选） */
  const handleRequestDelete = React.useCallback((entry: FileEntry) => {
    setDeleteTarget(entry)
    setDeleteCount(selectedCount > 1 ? selectedCount : 1)
  }, [selectedCount])

  /** 执行删除 */
  const handleDelete = React.useCallback(async () => {
    if (!deleteTarget) return
    try {
      if (selectedEntries.size > 1) {
        // 批量删除
        for (const path of selectedEntries.keys()) {
          await window.electronAPI.deleteFile(path)
        }
      } else {
        await window.electronAPI.deleteFile(deleteTarget.path)
      }
      setSelectedEntries(new Map())
      await loadRoot()
    } catch (err) {
      console.error('[FileBrowser] 删除失败:', err)
    }
    setDeleteTarget(null)
  }, [deleteTarget, selectedEntries, loadRoot])

  /** 移动文件 */
  const handleMove = React.useCallback(async (entry: FileEntry) => {
    setMoving(true)
    try {
      const result = await window.electronAPI.openFolderDialog()
      if (!result) return

      if (selectedEntries.size > 1) {
        for (const path of selectedEntries.keys()) {
          await window.electronAPI.moveFile(path, result.path)
        }
      } else {
        await window.electronAPI.moveFile(entry.path, result.path)
      }
      setSelectedEntries(new Map())
      await loadRoot()
    } catch (err) {
      console.error('[FileBrowser] 移动失败:', err)
    } finally {
      setMoving(false)
    }
  }, [selectedEntries, loadRoot])

  const addPendingMentions = useSetAtom(addPendingMentionsAtom)

  /** 引用菜单项回调 — 单文件或批量。文件夹由调用方在 FileTreeItem 内过滤掉。 */
  const handleReference = React.useCallback((entries: FileEntry[]) => {
    const items = entries
      .filter((e) => !e.isDirectory)
      .map((e) => {
        const relPath = computeRelPath(e.path, rootPath)
        return relPath ? buildFileMentionPayload({ relPath, name: e.name }) : null
      })
      .filter((m): m is AgentPendingMention => m !== null)
    if (items.length === 0) return
    addPendingMentions(items)
  }, [addPendingMentions, rootPath])

  const handleReferenceShortcut = React.useCallback(() => {
    if (selectedEntries.size === 0) return
    handleReference(Array.from(selectedEntries.values()))
  }, [selectedEntries, handleReference])
  useShortcut('reference-selected-files', handleReferenceShortcut)

  // 显示根路径最后两段作为面包屑
  const breadcrumb = React.useMemo(() => {
    const parts = rootPath.split('/').filter(Boolean)
    return parts.length > 2 ? `.../${parts.slice(-2).join('/')}` : rootPath
  }, [rootPath])

  const isEmptyState = !error && entries.length === 0 && !loading && !hideEmpty

  const fileTree = (
    <div ref={treeContainerRef} className="py-1 min-h-full" onClick={handleBackgroundClick}>
      {error && (
        <div className="px-3 py-2 text-xs text-destructive">{error}</div>
      )}
      {isEmptyState && (
        <div className="flex flex-col items-center justify-center gap-2 min-h-[180px] py-10 px-6 text-center">
          <FolderOpen className="size-8 text-muted-foreground/40" strokeWidth={1.5} />
          <p className="text-xs text-muted-foreground/70">{t('fileBrowser.emptyTitle')}</p>
          <p className="text-sm text-muted-foreground/50 leading-relaxed inline-flex items-center gap-0.5 justify-center flex-wrap">
            <Upload className="inline size-2.5 mx-0.5" aria-hidden />
            {t('fileBrowser.emptyHint')}
          </p>
        </div>
      )}
      {entries.map((entry) => (
        <FileTreeItem
          key={entry.path}
          entry={entry}
          rootPath={rootPath}
          depth={0}
          baseIndent={baseIndent}
          rowClassName={rowClassName}
          disableRowHoverBackground={disableRowHoverBackground}
          hideEntryIcons={hideEntryIcons}
          selectedEntries={selectedEntries}
          selectedCount={selectedCount}
          renamingPath={renamingPath}
          moving={moving}
          refreshVersion={filesVersion}
          onSelect={handleSelect}
          registerEntries={registerEntries}
          onShowInFolder={handleShowInFolder}
          onStartRename={handleStartRename}
          onCancelRename={handleCancelRename}
          onRename={handleRename}
          onDelete={handleRequestDelete}
          onMove={handleMove}
          onReference={handleReference}
          onRefresh={loadRoot}
          visibleHiddenEntries={visibleHiddenEntries}
        />
      ))}
    </div>
  )

  return (
    <div className={cn(
      'flex flex-col',
      !embedded && 'h-full',
      embedded && isEmptyState && 'flex-1 justify-center',
    )}>
      {/* 顶部工具栏（可由外部接管） */}
      {!hideToolbar && (
        <div className="flex items-center gap-1 px-3 pr-10 h-[48px] border-b flex-shrink-0">
          <span className="text-xs text-muted-foreground truncate flex-1" title={rootPath}>
            {breadcrumb}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={() => window.electronAPI.openFile(rootPath).catch(console.error)}
            title={t('fileBrowser.openInFinderTooltip')}
          >
            <ExternalLink className="!size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={loadRoot}
            disabled={loading}
          >
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          </Button>
        </div>
      )}

      {/* 文件树 */}
      {embedded ? fileTree : (
        <ScrollArea className="flex-1">
          {fileTree}
        </ScrollArea>
      )}

      {/* 删除确认对话框 */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('fileBrowser.deleteDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                {deleteCount > 1 ? (
                  <Trans
                    ns="nav"
                    i18nKey="fileBrowser.deleteDialog.descriptionMulti"
                    values={{ count: deleteCount }}
                    components={{ strong: <strong /> }}
                  />
                ) : (
                  <>
                    <Trans
                      ns="nav"
                      i18nKey="fileBrowser.deleteDialog.descriptionSingle"
                      values={{ name: deleteTarget?.name ?? '' }}
                      components={{ strong: <strong /> }}
                    />
                    {deleteTarget?.isDirectory && t('fileBrowser.deleteDialog.directorySuffix')}
                  </>
                )}
                {' '}
                {t('fileBrowser.deleteDialog.warning')}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('fileBrowser.deleteDialog.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t('fileBrowser.deleteDialog.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ===== FileTreeItem 子组件 =====

interface FileTreeItemProps {
  entry: FileEntry
  /** 项目根路径（绝对路径），用于拖拽时计算 at-mention 的相对路径 */
  rootPath: string
  depth: number
  /** 根层左缩进基准（px），由 FileBrowser 透传 */
  baseIndent: number
  rowClassName: string
  disableRowHoverBackground: boolean
  hideEntryIcons: boolean
  selectedEntries: Map<string, FileEntry>
  selectedCount: number
  renamingPath: string | null
  moving: boolean
  /** 文件版本号，变化时已展开的文件夹自动重新加载子项 */
  refreshVersion: number
  onSelect: (entry: FileEntry, opts: { multi: boolean; range: boolean }) => void
  /** 加载子目录后把 children 注册到父组件的 path→entry 表，供 Shift+click range 反查 */
  registerEntries: (items: FileEntry[]) => void
  onShowInFolder: (entry: FileEntry) => void
  onStartRename: (entry: FileEntry) => void
  onCancelRename: () => void
  onRename: (filePath: string, newName: string) => Promise<string | null>
  onDelete: (entry: FileEntry) => void
  onMove: (entry: FileEntry) => void
  onReference: (entries: FileEntry[]) => void
  onRefresh: () => Promise<void>
  visibleHiddenEntries?: string[]
}

function FileTreeItem({
  entry,
  rootPath,
  depth,
  baseIndent,
  rowClassName,
  disableRowHoverBackground,
  hideEntryIcons,
  selectedEntries,
  selectedCount,
  renamingPath,
  moving,
  refreshVersion,
  onSelect,
  registerEntries,
  onShowInFolder,
  onStartRename,
  onCancelRename,
  onRename,
  onDelete,
  onMove,
  onReference,
  onRefresh,
  visibleHiddenEntries,
}: FileTreeItemProps): React.ReactElement {
  const { t } = useT('nav')
  const [expanded, setExpanded] = React.useState(false)
  const [children, setChildren] = React.useState<FileEntry[]>([])
  const [childrenLoaded, setChildrenLoaded] = React.useState(false)

  // 当 refreshVersion 变化时，已展开的文件夹自动重新加载子项
  React.useEffect(() => {
    if (expanded && childrenLoaded && entry.isDirectory) {
      window.electronAPI.listDirectory(entry.path, { visibleHiddenEntries })
        .then((result) => {
          setChildren(result.entries)
          registerEntries(result.entries)
        })
        .catch((err) => console.error('[FileTreeItem] 刷新子目录失败:', err))
    }
  }, [refreshVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  // 重命名编辑状态
  const [editName, setEditName] = React.useState('')
  const [renameError, setRenameError] = React.useState<string | null>(null)
  const renameInputRef = React.useRef<HTMLInputElement>(null)
  const justStartedEditing = React.useRef(false)

  const [menuOpen, setMenuOpen] = React.useState(false)

  const referenceMenu = React.useMemo(() => {
    if (entry.isDirectory) return null
    if (selectedCount > 1 && selectedEntries.has(entry.path)) {
      const fileEntries = Array.from(selectedEntries.values()).filter((e) => !e.isDirectory)
      if (fileEntries.length === 0) return null
      return {
        onReference: () => onReference(fileEntries),
        referenceLabel: t('fileBrowser.referenceSelected', { count: fileEntries.length }),
      }
    }
    // 单选场景
    return {
      onReference: () => onReference([entry]),
      referenceLabel: t('fileBrowser.reference'),
    }
  }, [entry, selectedCount, selectedEntries, onReference, t])

  // 拖拽状态：仅文件可拖；拖动时给行容器加 opacity-50 视觉反馈
  const [isDragging, setIsDragging] = React.useState(false)

  /**
   * 拖拽开始：写入 at-mention payload 到 dataTransfer。
   * - 当 entry 属于多选集合时：把所有选中的可计算 relPath 的文件序列化为数组，并用叠加图标 + 数字徽标做 macOS 风格预览
   * - 否则：单文件 payload + 默认 drag image
   */
  const dragImageRef = React.useRef<HTMLElement | null>(null)

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>): void => {
    if (entry.isDirectory) return
    const relPath = computeRelPath(entry.path, rootPath)
    if (!relPath) return
    const single = buildFileMentionPayload({ relPath, name: entry.name })

    let payload: AgentPendingMention | AgentPendingMention[] = single
    if (selectedCount > 1 && selectedEntries.has(entry.path)) {
      const all: AgentPendingMention[] = []
      for (const sel of selectedEntries.values()) {
        if (sel.isDirectory) continue
        const rp = computeRelPath(sel.path, rootPath)
        if (rp) all.push(buildFileMentionPayload({ relPath: rp, name: sel.name }))
      }
      if (all.length > 1) {
        payload = all
        // macOS Finder 风格多文件拖拽预览
        const img = createMultiFileDragImage(all.length, entry.name)
        dragImageRef.current = img
        e.dataTransfer.setDragImage(img, 20, 20)
      }
    }

    e.dataTransfer.setData(MENTION_DRAG_MIME, JSON.stringify(payload))
    e.dataTransfer.effectAllowed = 'copy'
    setIsDragging(true)
  }

  /** 拖拽结束：清理视觉状态 + 移除临时 drag image */
  const handleDragEnd = (): void => {
    setIsDragging(false)
    if (dragImageRef.current) {
      dragImageRef.current.remove()
      dragImageRef.current = null
    }
  }

  const isSelected = selectedEntries.has(entry.path)
  const isRenaming = renamingPath === entry.path

  /** 展开/收起文件夹 */
  const toggleDir = async (): Promise<void> => {
    if (!entry.isDirectory) return

    if (!expanded && !childrenLoaded) {
      try {
        const result = await window.electronAPI.listDirectory(entry.path, { visibleHiddenEntries })
        setChildren(result.entries)
        setChildrenLoaded(true)
        registerEntries(result.entries)

        // 首次展开空目录时，延迟重试一次（应对 Agent 正在写入文件的时序问题）
        if (result.entries.length === 0) {
          setTimeout(async () => {
            try {
              const retryResult = await window.electronAPI.listDirectory(entry.path, { visibleHiddenEntries })
              if (retryResult.entries.length > 0) {
                setChildren(retryResult.entries)
                registerEntries(retryResult.entries)
              }
            } catch { /* 静默忽略 */ }
          }, 800)
        }
      } catch (err) {
        console.error('[FileTreeItem] 加载子目录失败:', err)
      }
    }

    setExpanded(!expanded)
  }

  const openInRightPanel = useOpenInRightPanel()

  /** 点击行为：选中 + 文件夹展开/收起；单击文件触发内嵌预览 */
  const handleClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
    onSelect(entry, { multi: e.metaKey || e.ctrlKey, range: e.shiftKey })
    if (entry.isDirectory && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
      toggleDir()
      return
    }
    if (!entry.isDirectory) {
      const ext = entry.name.includes('.')
        ? entry.name.split('.').pop()?.toLowerCase() ?? ''
        : ''
      const target = {
        kind: 'file' as const, path: entry.path, ext,
        ...(window.__TAURI_FORMAL__?.imageFiles && entry.displayName && { displayName: entry.displayName }),
      }
      window.electronAPI.statFile(entry.path)
        .then(info => openInRightPanel({ ...target, size: info.size }))
        .catch(() => openInRightPanel({ ...target, size: 0 }))
    }
  }

  /** 双击：保留现有"另开窗口"能力（高级入口） */
  const handleDoubleClick = (): void => {
    if (!entry.isDirectory) {
      window.electronAPI.previewFile(entry.path).catch(console.error)
    }
  }

  /** 删除后刷新子目录 */
  const handleRefreshAfterDelete = async (): Promise<void> => {
    if (childrenLoaded) {
      try {
        const result = await window.electronAPI.listDirectory(entry.path, { visibleHiddenEntries })
        setChildren(result.entries)
      } catch {
        await onRefresh()
      }
    }
  }

  // 进入重命名编辑模式
  React.useEffect(() => {
    if (isRenaming) {
      setEditName(entry.name)
      setRenameError(null)
      justStartedEditing.current = true
      const timer = setTimeout(() => {
        justStartedEditing.current = false
        const input = renameInputRef.current
        if (input) {
          input.focus()
          // 只选中文件名部分，不包括后缀
          const lastDotIndex = entry.name.lastIndexOf('.')
          if (lastDotIndex > 0 && !entry.isDirectory) {
            input.setSelectionRange(0, lastDotIndex)
          } else {
            input.select()
          }
        }
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [isRenaming, entry.name, entry.isDirectory])

  /** 保存重命名 */
  const saveRename = async (): Promise<void> => {
    if (justStartedEditing.current) return

    const trimmed = editName.trim()
    if (!trimmed || trimmed === entry.name) {
      onCancelRename()
      return
    }
    const error = await onRename(entry.path, trimmed)
    if (error) {
      setRenameError(error)
    }
  }

  /** 重命名键盘事件 */
  const handleRenameKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void saveRename()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancelRename()
    }
  }

  /** 重命名失焦 */
  const handleBlur = (): void => {
    if (renameError) {
      onCancelRename()
      setRenameError(null)
    } else {
      void saveRename()
    }
  }

  const paddingLeft = baseIndent + depth * 16
  const showMenu = isSelected && selectedCount > 0 && !isRenaming

  return (
    <>
      <div
        data-file-row
        data-file-path={entry.path}
        className={cn(
          'flex items-center gap-1 py-1 pr-2 my-px text-sm cursor-pointer group rounded-lg',
          rowClassName,
          isSelected ? 'bg-accent' : !disableRowHoverBackground && 'hover:bg-accent/50',
          isDragging && 'opacity-50',
        )}
        style={{ paddingLeft }}
        draggable={!entry.isDirectory}
        onDragStart={!entry.isDirectory ? handleDragStart : undefined}
        onDragEnd={handleDragEnd}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(e) => {
          if (isRenaming) return
          e.preventDefault()
          e.stopPropagation()
          if (!isSelected) onSelect(entry, { multi: false, range: false })
          setMenuOpen(true)
        }}
      >
        {/* 展开/收起图标 */}
        {entry.isDirectory ? (
          <ChevronRight
            className={cn(
              'size-3.5 text-muted-foreground flex-shrink-0 transition-transform duration-150',
              expanded && 'rotate-90',
            )}
          />
        ) : (
          <span className="w-3.5 flex-shrink-0" />
        )}

        {/* 文件/文件夹图标 */}
        {!hideEntryIcons && (
          <FileTypeIcon name={entry.name} isDirectory={entry.isDirectory} isOpen={expanded} className="mr-1.5" />
        )}

        {/* 文件名 / 重命名输入框 */}
        {isRenaming ? (
          <div className="flex-1 min-w-0">
            <input
              ref={renameInputRef}
              value={editName}
              onChange={(e) => { setEditName(e.target.value); setRenameError(null) }}
              onKeyDown={handleRenameKeyDown}
              onBlur={handleBlur}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                'w-full bg-transparent text-xs border-b outline-none py-0.5',
                renameError ? 'border-destructive' : 'border-primary/50',
              )}
              maxLength={255}
            />
            {renameError && (
              <div className="text-sm text-destructive mt-0.5">{renameError}</div>
            )}
          </div>
        ) : (
          <span className="truncate text-xs flex-1">{(window.__TAURI_FORMAL__?.imageFiles && entry.displayName) || entry.name}</span>
        )}

        {/* 三点菜单按钮（始终占位避免行高跳动；hover/选中/菜单打开时可见） */}
        <div
          className={cn(
            'flex-shrink-0 transition-opacity',
            isRenaming
              ? 'invisible'
              : showMenu || menuOpen
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100',
          )}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <DropdownMenu
            open={menuOpen}
            onOpenChange={(open) => {
              setMenuOpen(open)
              if (open && !isSelected) {
                onSelect(entry, { multi: false, range: false })
              }
            }}
          >
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="h-6 w-6 rounded hover:bg-accent/70"
              >
                <MoreHorizontal className="!size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            {!isRenaming && (
              <WorkspaceFileMenuContent
                align="start"
                onReference={referenceMenu?.onReference}
                referenceLabel={referenceMenu?.referenceLabel}
                onShowInFolder={selectedCount === 1 ? () => onShowInFolder(entry) : undefined}
                onRename={selectedCount === 1 ? () => onStartRename(entry) : undefined}
                onMove={() => { void onMove(entry) }}
                onDelete={() => onDelete(entry)}
                moveLabel={selectedCount > 1 ? t('fileBrowser.moveSelected', { count: selectedCount }) : undefined}
                deleteLabel={selectedCount > 1 ? t('fileBrowser.deleteSelected', { count: selectedCount }) : undefined}
                moveDisabled={moving}
              />
            )}
          </DropdownMenu>
        </div>
      </div>

      {/* 子项 */}
      {expanded && children.length === 0 && childrenLoaded && (
        <div
          className="text-sm text-muted-foreground/50 py-1"
          style={{ paddingLeft: paddingLeft + 24 }}
        >
          {t('fileBrowser.emptyChildren')}
        </div>
      )}
      {expanded && children.map((child) => (
        <FileTreeItem
          key={child.path}
          entry={child}
          rootPath={rootPath}
          depth={depth + 1}
          baseIndent={baseIndent}
          rowClassName={rowClassName}
          disableRowHoverBackground={disableRowHoverBackground}
          hideEntryIcons={hideEntryIcons}
          selectedEntries={selectedEntries}
          selectedCount={selectedCount}
          renamingPath={renamingPath}
          moving={moving}
          refreshVersion={refreshVersion}
          onSelect={onSelect}
          registerEntries={registerEntries}
          onShowInFolder={onShowInFolder}
          onStartRename={onStartRename}
          onCancelRename={onCancelRename}
          onRename={onRename}
          onDelete={onDelete}
          onMove={onMove}
          onReference={onReference}
          onRefresh={handleRefreshAfterDelete}
        />
      ))}
    </>
  )
}
