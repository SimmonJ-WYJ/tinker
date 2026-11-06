/**
 * ZoteroCollectionTree — 加入 Zotero 弹窗里的 Destination 块（F39 改进版）
 *
 * 布局（不再走 Popover）：
 *   - 搜索框（只过滤 tree，不影响顶部 pinned 选项）
 *   - pinned 行：Use Zotero current selection
 *   - ScrollArea(max-h-60) 包裹的 target 列表：library 根（My Library）+ 嵌套 collection，
 *     均来自 connector targets（#463：写入走 connector，节点用 treeViewID 标识）
 *   - 空态 / 无匹配 / 加载失败走 EmptyState 居中占位，不撑固定高度
 *
 * 纯展示组件：fetch 由父弹窗负责，便于"每次打开都重新拉"语义；
 * loading / error / onReload 由父传入。
 */

import * as React from 'react'
import { Check, Loader2, Folder, FolderTree, Inbox, Search, AlertCircle } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useT } from '@/hooks/useT'
import type { DestSelection, FlatNode } from '@/lib/zotero-destination'

interface Props {
  /** null = 用户尚未选择任何 destination（Confirm 应禁用） */
  value: DestSelection | null
  onChange: (next: DestSelection) => void
  nodes: FlatNode[]
  loading: boolean
  error: string | null
  onReload: () => void
  disabled?: boolean
}

export function ZoteroCollectionTree({
  value,
  onChange,
  nodes,
  loading,
  error,
  onReload,
  disabled,
}: Props): React.ReactElement {
  const { t } = useT('library')
  const [query, setQuery] = React.useState('')

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return nodes
    // 只按节点自身名匹配：祖先名（fullPath）含 q 不应连带把无关子节点也列出来
    return nodes.filter((n) => n.name.toLowerCase().includes(q))
  }, [nodes, query])

  const isCurrent = value?.kind === 'zoteroCurrent'
  const selectedTreeViewID = value?.kind === 'target' ? value.treeViewID : null

  return (
    <div className={cn('rounded-md border bg-background', disabled && 'opacity-60 pointer-events-none')}>
      {/* 搜索框 */}
      <div className="p-2 border-b">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('collectionPicker.searchPlaceholder')}
          className="h-8 text-sm"
          disabled={loading}
        />
      </div>

      {/* pinned 选项：保持可见，不受搜索过滤。My Library 不再单列 —— 它作为 library 根
          （isLibraryRoot）出现在下方 target 列表里 */}
      <ul className="border-b">
        <li>
          <PickerRow
            icon={<FolderTree className="h-3.5 w-3.5 shrink-0" />}
            selected={isCurrent}
            onClick={() => onChange({ kind: 'zoteroCurrent' })}
            label={t('collectionPicker.useZoteroCurrent')}
            sublabel={t('collectionPicker.useZoteroCurrentHint')}
          />
        </li>
      </ul>

      {/* 主树（固定高度 + 可滚动） */}
      {loading ? (
        <div className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t('collectionPicker.loading')}
        </div>
      ) : error ? (
        <EmptyState icon={<AlertCircle className="h-5 w-5 opacity-60" />} title={t('collectionPicker.loadFailed')}>
          <Button
            type="button"
            variant="subtle"
            size="inline"
            onClick={onReload}
            className="text-xs underline"
          >
            {t('collectionPicker.retry')}
          </Button>
        </EmptyState>
      ) : filtered.length === 0 && query.trim() ? (
        <EmptyState icon={<Search className="h-5 w-5 opacity-60" />} title={t('collectionPicker.noMatch')} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Inbox className="h-5 w-5 opacity-60" />}
          title={t('collectionPicker.emptyTitle')}
          hint={t('collectionPicker.emptyHint')}
        />
      ) : (
        <ScrollArea className="max-h-60">
          <ul className="py-1">
            {filtered.map((n) => (
              <li key={n.treeViewID}>
                <PickerRow
                  icon={n.isLibraryRoot
                    ? <Inbox className="h-3.5 w-3.5 shrink-0" />
                    : <Folder className="h-3.5 w-3.5 shrink-0 opacity-70" />}
                  selected={selectedTreeViewID === n.treeViewID}
                  onClick={() => onChange({ kind: 'target', treeViewID: n.treeViewID })}
                  label={n.isLibraryRoot ? t('collectionPicker.myLibrary') : n.name}
                  indent={n.depth}
                  title={n.fullPath}
                />
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}
    </div>
  )
}

/** 列表区的居中占位（空态 / 无匹配 / 错误共用），紧贴 pinned 选项，不再吊在固定高度空白上 */
function EmptyState({
  icon,
  title,
  hint,
  children,
}: {
  icon: React.ReactNode
  title: string
  hint?: string
  children?: React.ReactNode
}): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 px-3 py-6 text-center text-muted-foreground">
      {icon}
      <span className="text-xs">{title}</span>
      {hint && <span className="text-sm text-muted-foreground/70">{hint}</span>}
      {children}
    </div>
  )
}

interface PickerRowProps {
  icon: React.ReactNode
  selected: boolean
  onClick: () => void
  label: string
  sublabel?: string
  indent?: number
  title?: string
}

function PickerRow({
  icon,
  selected,
  onClick,
  label,
  sublabel,
  indent = 0,
  title,
}: PickerRowProps): React.ReactElement {
  return (
    <Button
      type="button"
      variant="list"
      size="row"
      onClick={onClick}
      className={cn(
        'w-full min-w-0 items-start rounded-none px-2 py-1.5 text-sm hover:bg-muted/50 hover:text-foreground [&_svg]:size-3.5',
        selected && 'bg-muted/40',
      )}
      title={title}
    >
      {/* Check 固定在最左，indent 只缩进图标 + label（缩进 spacer），保证勾选列对齐不呈阶梯状 */}
      <Check className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', selected ? 'opacity-100' : 'opacity-0')} />
      {indent > 0 && <span className="shrink-0" style={{ width: `${indent * 0.875}rem` }} aria-hidden />}
      <span className="mt-0.5 flex shrink-0">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="truncate block">{label}</span>
        {sublabel && (
          <span className="block text-sm text-muted-foreground/70 truncate">{sublabel}</span>
        )}
      </span>
    </Button>
  )
}
