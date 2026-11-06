/**
 * WorkspaceFileMenuContent — 项目文件菜单内容（共享）
 *
 * FileBrowser（展开态文件项）与 SidebarProjectFiles（收起态最近文件）
 * 共用。菜单项：在文件夹中显示 / 移动到... / 重命名 / 删除。
 *
 * 可选项 onShowInFolder / onRename 传 undefined 时对应条目不渲染
 * （用于多选场景隐藏 entry 相关项）。
 */

import * as React from 'react'
import { AtSign, FolderSearch, FolderInput, Pencil, Trash2 } from 'lucide-react'
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { useT } from '@/hooks/useT'

export interface WorkspaceFileMenuContentProps {
  /** 引用菜单项点击回调；undefined 时不渲染该项（如文件夹菜单 / 没有可引用文件） */
  onReference?: () => void
  /** 引用菜单项文案；不传时回退到默认单选文案（fileBrowser.reference），多选时调用方传 referenceSelected 文案 */
  referenceLabel?: string
  onShowInFolder?: () => void
  onRename?: () => void
  onMove: () => void
  onDelete: () => void
  /** 覆盖"移动"项文案（多选场景用） */
  moveLabel?: string
  /** 覆盖"删除"项文案（多选场景用） */
  deleteLabel?: string
  moveDisabled?: boolean
  align?: 'start' | 'end' | 'center'
}

export function WorkspaceFileMenuContent({
  onReference,
  referenceLabel,
  onShowInFolder,
  onRename,
  onMove,
  onDelete,
  moveLabel,
  deleteLabel,
  moveDisabled,
  align = 'start',
}: WorkspaceFileMenuContentProps): React.ReactElement {
  const { t } = useT('nav')
  const resolvedReferenceLabel = referenceLabel ?? t('fileBrowser.reference')
  const resolvedMoveLabel = moveLabel ?? t('attachedDirs.menu.moveTo')
  const resolvedDeleteLabel = deleteLabel ?? t('attachedDirs.menu.delete')
  return (
    <DropdownMenuContent align={align} className="w-40 z-[9999] min-w-0 p-0.5">
      {onReference && (
        <DropdownMenuItem
          className="text-xs py-1 [&>svg]:size-3.5"
          onSelect={onReference}
        >
          <AtSign />
          {resolvedReferenceLabel}
        </DropdownMenuItem>
      )}
      {onShowInFolder && (
        <DropdownMenuItem
          className="text-xs py-1 [&>svg]:size-3.5"
          onSelect={onShowInFolder}
        >
          <FolderSearch />
          {t('attachedDirs.menu.showInFolder')}
        </DropdownMenuItem>
      )}
      <DropdownMenuItem
        className="text-xs py-1 [&>svg]:size-3.5"
        disabled={moveDisabled}
        onSelect={onMove}
      >
        <FolderInput />
        {resolvedMoveLabel}
      </DropdownMenuItem>
      {onRename && (
        <DropdownMenuItem
          className="text-xs py-1 [&>svg]:size-3.5"
          onSelect={onRename}
        >
          <Pencil />
          {t('attachedDirs.menu.rename')}
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator className="my-0.5" />
      <DropdownMenuItem
        className="text-xs py-1 [&>svg]:size-3.5 text-destructive"
        onSelect={onDelete}
      >
        <Trash2 />
        {resolvedDeleteLabel}
      </DropdownMenuItem>
    </DropdownMenuContent>
  )
}
