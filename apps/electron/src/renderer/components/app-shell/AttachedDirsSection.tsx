import * as React from 'react'
import { useSetAtom } from 'jotai'
import {
  AtSign,
  ChevronRight,
  X,
  MoreHorizontal,
  ExternalLink,
  FolderSearch,
  Pencil,
  FolderInput,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { addPendingMentionsAtom, type AgentPendingMention } from '@/atoms/agent-atoms'
import { FileTypeIcon } from '@/components/file-browser'
import { MENTION_DRAG_MIME } from '@/components/agent/mention-drag-payload'
import { useT } from '@/hooks/useT'
import { useOpenInRightPanel } from '@/hooks/useOpenInRightPanel'
import type { FileEntry } from '@asci/shared'

// ===== 附加目录容器（管理选中状态） =====

/** 选中项元数据：多文件拖拽需要 name 做 chip label、isDirectory 做过滤 */
interface AttachedDirSelectionMeta {
  name: string
  isDirectory: boolean
}

type AttachedDirSelectionMap = Map<string, AttachedDirSelectionMeta>

interface AttachedDirsSectionProps {
  attachedDirs: string[]
  onDetach: (dirPath: string) => void
  /** 文件版本号，用于自动刷新已展开的目录 */
  refreshVersion: number
}

/** 附加目录区域：统一管理所有子项的选中状态（与 FileBrowser 交互对齐：multi/range/Esc/空白清空） */
export function AttachedDirsSection({ attachedDirs, onDetach, refreshVersion }: AttachedDirsSectionProps): React.ReactElement {
  const { t } = useT('nav')
  const [selectedEntries, setSelectedEntries] = React.useState<AttachedDirSelectionMap>(new Map())
  const anchorPathRef = React.useRef<string | null>(null)
  const treeContainerRef = React.useRef<HTMLDivElement>(null)
  // 跨组件互斥 owner 标识
  const selectionOwnerId = React.useRef<string>(`attached-dirs-${Math.random().toString(36).slice(2, 8)}`).current

  // 跨组件互斥：自己 selection 变非空时广播 claim；监听到 owner 非自己时清空
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

  /**
   * 从行 DOM 节点读元数据（range 选择补 name/isDirectory）。
   * data-is-directory='1' 表示文件夹；缺失或空串视为文件。
   */
  const readRowMeta = (el: HTMLElement): AttachedDirSelectionMeta => ({
    name: el.getAttribute('data-file-name') ?? '',
    isDirectory: el.getAttribute('data-is-directory') === '1',
  })

  /**
   * 选中（macOS Finder 风格，与 FileBrowser 对齐）：
   * - range（Shift+click）→ anchor 到当前的可见行 range 替换 selection
   * - multi（Cmd/Ctrl+click）→ toggle 当前 path 进/出 selection，更新 anchor
   * - 默认 → 单选替换，更新 anchor
   */
  const handleSelect = React.useCallback((path: string, meta: AttachedDirSelectionMeta, opts: { multi: boolean; range: boolean }) => {
    if (opts.range && anchorPathRef.current && anchorPathRef.current !== path) {
      const rows = treeContainerRef.current?.querySelectorAll<HTMLElement>('[data-file-path]')
      if (rows && rows.length > 0) {
        const ordered: Array<{ path: string; meta: AttachedDirSelectionMeta }> = []
        rows.forEach((el) => {
          const p = el.getAttribute('data-file-path')
          if (p) ordered.push({ path: p, meta: readRowMeta(el) })
        })
        const startIdx = ordered.findIndex((o) => o.path === anchorPathRef.current)
        const endIdx = ordered.findIndex((o) => o.path === path)
        if (startIdx !== -1 && endIdx !== -1) {
          const [lo, hi] = startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx]
          const next: AttachedDirSelectionMap = new Map()
          for (let i = lo; i <= hi; i++) {
            const item = ordered[i]
            if (item) next.set(item.path, item.meta)
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
        if (next.has(path)) next.delete(path)
        else next.set(path, meta)
        return next
      })
      anchorPathRef.current = path
      return
    }
    setSelectedEntries(new Map([[path, meta]]))
    anchorPathRef.current = path
  }, [])

  // Esc 清空多选
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

  // 点击行间空白 / 容器空白清空
  const handleBackgroundClick = React.useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement | null
    if (target?.closest('[data-file-row]')) return
    setSelectedEntries(new Map())
  }, [])

  return (
    <div ref={treeContainerRef} className="pt-2.5 pb-1 flex-shrink-0" onClick={handleBackgroundClick}>
      <div className="text-sm font-medium text-muted-foreground mb-1 pl-6 pr-3">{t('attachedDirs.header')}</div>
      {attachedDirs.map((dir) => (
        <AttachedDirTree
          key={dir}
          dirPath={dir}
          onDetach={() => onDetach(dir)}
          selectedEntries={selectedEntries}
          onSelect={handleSelect}
          refreshVersion={refreshVersion}
        />
      ))}
    </div>
  )
}

// ===== 附加目录树组件 =====

interface AttachedDirTreeProps {
  dirPath: string
  onDetach: () => void
  selectedEntries: AttachedDirSelectionMap
  onSelect: (path: string, meta: AttachedDirSelectionMeta, opts: { multi: boolean; range: boolean }) => void
  /** 文件版本号，变化时已展开的目录自动重新加载 */
  refreshVersion: number
}

/** 附加目录根节点：可展开/收起，带移除按钮（行为对齐 FileBrowser：单击=选中+展开 / Cmd=toggle / Shift=range） */
function AttachedDirTree({ dirPath, onDetach, selectedEntries, onSelect, refreshVersion }: AttachedDirTreeProps): React.ReactElement {
  const { t } = useT('nav')
  const [expanded, setExpanded] = React.useState(false)
  const [children, setChildren] = React.useState<FileEntry[]>([])
  const [loaded, setLoaded] = React.useState(false)

  const dirName = dirPath.split('/').filter(Boolean).pop() || dirPath
  const isSelected = selectedEntries.has(dirPath)

  // 当 refreshVersion 变化时，已展开的目录自动重新加载
  React.useEffect(() => {
    if (expanded && loaded) {
      window.electronAPI.listAttachedDirectory(dirPath)
        .then((result) => setChildren(result.entries))
        .catch((err) => console.error('[AttachedDirTree] 刷新失败:', err))
    }
  }, [refreshVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleExpand = async (): Promise<void> => {
    if (!expanded && !loaded) {
      try {
        const result = await window.electronAPI.listAttachedDirectory(dirPath)
        setChildren(result.entries)
        setLoaded(true)
      } catch (err) {
        console.error('[AttachedDirTree] 加载失败:', err)
      }
    }
    setExpanded(!expanded)
  }

  const handleClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
    onSelect(dirPath, { name: dirName, isDirectory: true }, { multi: e.ctrlKey || e.metaKey, range: e.shiftKey })
    if (!e.metaKey && !e.ctrlKey && !e.shiftKey) {
      void toggleExpand()
    }
  }

  return (
    <div>
      <div
        data-file-row
        data-file-path={dirPath}
        data-file-name={dirName}
        data-is-directory="1"
        className={cn(
          'flex items-center gap-1 py-1 pr-2 my-px text-sm cursor-pointer group mx-2 rounded-lg',
          isSelected ? 'bg-accent' : 'hover:bg-accent/50',
        )}
        onClick={handleClick}
      >
        <ChevronRight
          className={cn(
            'size-3.5 text-muted-foreground flex-shrink-0 transition-transform duration-150',
            expanded && 'rotate-90',
          )}
        />
        <FileTypeIcon name={dirName} isDirectory isOpen={expanded} className="mr-1.5" />
        <span className="text-xs truncate flex-1" title={dirPath}>
          {dirName}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
          onClick={(e) => { e.stopPropagation(); onDetach() }}
        >
          <X className="!size-3" />
        </Button>
      </div>
      {expanded && children.length === 0 && loaded && (
        <div className="text-sm text-muted-foreground/50 py-1" style={{ paddingLeft: 48 }}>
          {t('attachedDirs.empty')}
        </div>
      )}
      {expanded && children.map((child) => (
        <AttachedDirItem key={child.path} entry={child} depth={1} selectedEntries={selectedEntries} onSelect={onSelect} refreshVersion={refreshVersion} />
      ))}
    </div>
  )
}

interface AttachedDirItemProps {
  entry: FileEntry
  depth: number
  selectedEntries: AttachedDirSelectionMap
  onSelect: (path: string, meta: AttachedDirSelectionMeta, opts: { multi: boolean; range: boolean }) => void
  /** 文件版本号，变化时已展开的目录自动重新加载 */
  refreshVersion: number
}

/** 附加目录子项：递归可展开，支持选中 + 三点菜单（含重命名、移动） + 文件 drag-source */
function AttachedDirItem({ entry, depth, selectedEntries, onSelect, refreshVersion }: AttachedDirItemProps): React.ReactElement {
  const { t } = useT('nav')
  const { t: tConv } = useT('conversation')
  const [expanded, setExpanded] = React.useState(false)
  const [children, setChildren] = React.useState<FileEntry[]>([])
  const [loaded, setLoaded] = React.useState(false)
  // 重命名状态
  const [isRenaming, setIsRenaming] = React.useState(false)
  const [renameValue, setRenameValue] = React.useState(entry.name)
  const renameInputRef = React.useRef<HTMLInputElement>(null)
  // 当前显示的名称和路径（重命名后更新）
  const [currentName, setCurrentName] = React.useState(entry.name)
  const [currentPath, setCurrentPath] = React.useState(entry.path)
  const [menuOpen, setMenuOpen] = React.useState(false)
  // 拖拽视觉态：仅文件可拖，与 FileBrowser FileTreeItem 对齐
  const [isDragging, setIsDragging] = React.useState(false)
  const addPendingMentions = useSetAtom(addPendingMentionsAtom)

  const handleReference = (): void => {
    if (entry.isDirectory) return
    addPendingMentions([{ kind: 'file', id: currentPath, label: currentName }])
  }

  const isSelected = selectedEntries.has(currentPath)

  /**
   * 拖拽开始：写入 at-mention payload 到 dataTransfer。
   * 与 FileBrowser FileTreeItem 行为一致：被拖文件在多选中且选中含 2+ 文件时
   * 整批文件作为数组一起拖；否则按单文件拖。dir 一律跳过。
   * 落地端 parseFileMentionPayloads 兼容两种格式。
   */
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>): void => {
    if (entry.isDirectory || isRenaming) return
    const single: AgentPendingMention = { kind: 'file', id: currentPath, label: currentName }

    let payload: AgentPendingMention | AgentPendingMention[] = single
    if (selectedEntries.has(currentPath) && selectedEntries.size > 1) {
      const all: AgentPendingMention[] = []
      for (const [path, meta] of selectedEntries.entries()) {
        if (meta.isDirectory) continue
        all.push({ kind: 'file', id: path, label: meta.name })
      }
      if (all.length > 1) payload = all
    }

    e.dataTransfer.setData(MENTION_DRAG_MIME, JSON.stringify(payload))
    e.dataTransfer.effectAllowed = 'copy'
    setIsDragging(true)
  }

  const handleDragEnd = (): void => {
    setIsDragging(false)
  }

  // 当 refreshVersion 变化时，已展开的文件夹自动重新加载子项
  React.useEffect(() => {
    if (expanded && loaded && entry.isDirectory) {
      window.electronAPI.listAttachedDirectory(currentPath)
        .then((result) => setChildren(result.entries))
        .catch((err) => console.error('[AttachedDirItem] 刷新子目录失败:', err))
    }
  }, [refreshVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleDir = async (): Promise<void> => {
    if (!entry.isDirectory) return
    if (!expanded && !loaded) {
      try {
        const result = await window.electronAPI.listAttachedDirectory(currentPath)
        setChildren(result.entries)
        setLoaded(true)
      } catch (err) {
        console.error('[AttachedDirItem] 加载子目录失败:', err)
      }
    }
    setExpanded(!expanded)
  }

  const openInRightPanel = useOpenInRightPanel()

  const handleClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
    onSelect(currentPath, { name: currentName, isDirectory: entry.isDirectory }, { multi: e.ctrlKey || e.metaKey, range: e.shiftKey })
    // 带修饰键时仅选中，不展开 / 不预览
    if (e.metaKey || e.ctrlKey || e.shiftKey) return
    if (entry.isDirectory) {
      void toggleDir()
      return
    }
    // 文件单击：右侧侧栏内嵌预览（与 FileBrowser 一致）
    const ext = currentName.includes('.')
      ? currentName.split('.').pop()?.toLowerCase() ?? ''
      : ''
    window.electronAPI.statFile(currentPath)
      .then((info) => openInRightPanel({ kind: 'file', path: currentPath, ext, size: info.size }))
      .catch(() => openInRightPanel({ kind: 'file', path: currentPath, ext, size: 0 }))
  }

  const handleDoubleClick = (): void => {
    if (!entry.isDirectory) {
      window.electronAPI.openAttachedFile(currentPath).catch(console.error)
    }
  }

  // 开始重命名
  const startRename = (): void => {
    setRenameValue(currentName)
    setIsRenaming(true)
    // 延迟聚焦，等待 DOM 渲染
    setTimeout(() => renameInputRef.current?.select(), 50)
  }

  // 确认重命名
  const confirmRename = async (): Promise<void> => {
    const newName = renameValue.trim()
    if (!newName || newName === currentName) {
      setIsRenaming(false)
      return
    }
    try {
      await window.electronAPI.renameAttachedFile(currentPath, newName)
      // 更新本地显示
      const parentDir = currentPath.substring(0, currentPath.lastIndexOf('/'))
      const newPath = `${parentDir}/${newName}`
      // 更新选中状态中的路径
      onSelect(newPath, { name: newName, isDirectory: entry.isDirectory }, { multi: false, range: false })
      setCurrentName(newName)
      setCurrentPath(newPath)
    } catch (err) {
      console.error('[AttachedDirItem] 重命名失败:', err)
    }
    setIsRenaming(false)
  }

  // 取消重命名
  const cancelRename = (): void => {
    setIsRenaming(false)
    setRenameValue(currentName)
  }

  // 移动到文件夹
  const handleMove = async (): Promise<void> => {
    try {
      const result = await window.electronAPI.openFolderDialog()
      if (!result) return
      await window.electronAPI.moveAttachedFile(currentPath, result.path)
      // 移动后更新路径
      const newPath = `${result.path}/${currentName}`
      setCurrentPath(newPath)
    } catch (err) {
      console.error('[AttachedDirItem] 移动失败:', err)
    }
  }

  const paddingLeft = depth * 16

  return (
    <>
      <div
        data-file-row
        data-file-path={currentPath}
        data-file-name={currentName}
        data-is-directory={entry.isDirectory ? '1' : ''}
        draggable={!entry.isDirectory && !isRenaming}
        onDragStart={!entry.isDirectory && !isRenaming ? handleDragStart : undefined}
        onDragEnd={handleDragEnd}
        className={cn(
          'flex items-center gap-1 py-1 pr-2 my-px text-sm cursor-pointer group mx-2 rounded-lg',
          isSelected ? 'bg-accent' : 'hover:bg-accent/50',
          isDragging && 'opacity-50',
        )}
        style={{ paddingLeft }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={(e) => {
          if (isRenaming) return
          e.preventDefault()
          e.stopPropagation()
          setMenuOpen(true)
        }}
      >
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
        <FileTypeIcon name={currentName} isDirectory={entry.isDirectory} isOpen={expanded} className="mr-1.5" />

        {/* 名称：正常显示 / 重命名输入框 */}
        {isRenaming ? (
          <input
            ref={renameInputRef}
            className="text-xs flex-1 min-w-0 bg-background border border-primary rounded px-1 py-0.5 outline-none"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmRename()
              if (e.key === 'Escape') cancelRename()
              e.stopPropagation()
            }}
            onBlur={confirmRename}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="truncate text-xs flex-1">{currentName}</span>
        )}

        {/* 三点菜单按钮（始终占位，避免选中时行高跳动） */}
        <div
          className={cn(
            'flex-shrink-0 transition-opacity',
            isRenaming
              ? 'invisible'
              : isSelected || menuOpen
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100',
          )}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
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
              <DropdownMenuContent align="start" className="w-40 z-[9999] min-w-0 p-0.5">
                {!entry.isDirectory && (
                  <DropdownMenuItem
                    className="text-xs py-1 [&>svg]:size-3.5"
                    onSelect={handleReference}
                  >
                    <AtSign />
                    {tConv('agent.attachedDirs.reference')}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  className="text-xs py-1 [&>svg]:size-3.5"
                  onSelect={() => window.electronAPI.showAttachedInFolder(currentPath).catch(console.error)}
                >
                  <FolderSearch />
                  {t('attachedDirs.menu.showInFolder')}
                </DropdownMenuItem>
                {!entry.isDirectory && (
                  <DropdownMenuItem
                    className="text-xs py-1 [&>svg]:size-3.5"
                    onSelect={() => window.electronAPI.openAttachedFile(currentPath).catch(console.error)}
                  >
                    <ExternalLink />
                    {t('attachedDirs.menu.openFile')}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  className="text-xs py-1 [&>svg]:size-3.5"
                  onSelect={startRename}
                >
                  <Pencil />
                  {t('attachedDirs.menu.rename')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-xs py-1 [&>svg]:size-3.5"
                  onSelect={handleMove}
                >
                  <FolderInput />
                  {t('attachedDirs.menu.moveTo')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            )}
          </DropdownMenu>
        </div>
      </div>
      {expanded && children.length === 0 && loaded && (
        <div
          className="text-sm text-muted-foreground/50 py-1"
          style={{ paddingLeft: paddingLeft + 24 }}
        >
          {t('attachedDirs.empty')}
        </div>
      )}
      {expanded && children.map((child) => (
        <AttachedDirItem key={child.path} entry={child} depth={depth + 1} selectedEntries={selectedEntries} onSelect={onSelect} refreshVersion={refreshVersion} />
      ))}
    </>
  )
}
