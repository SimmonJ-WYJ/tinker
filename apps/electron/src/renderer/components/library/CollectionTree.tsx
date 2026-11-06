/**
 * CollectionTree - 文献库左栏
 *
 * 递归渲染 collections 树。顶项 "所有条目" 为内置特殊节点（selectedKey=null）。
 */

import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { ChevronRight, ChevronDown, Folder, FolderOpen, Inbox, Library } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { libraryCollectionsAtom, librarySelectedCollectionKeyAtom } from '@/atoms/library-atoms'
import { useT } from '@/hooks/useT'
import type { CollectionSummary } from '@asci/core/zotero'

interface TreeNode {
  key: string
  name: string
  children: TreeNode[]
}

/** 把扁平 CollectionSummary[] 转成树 */
function buildTree(list: CollectionSummary[]): TreeNode[] {
  const byKey = new Map<string, TreeNode>()
  for (const c of list) {
    byKey.set(c.key, { key: c.key, name: c.name, children: [] })
  }
  const roots: TreeNode[] = []
  for (const c of list) {
    const node = byKey.get(c.key)!
    if (c.parentKey === null) {
      roots.push(node)
    } else {
      byKey.get(c.parentKey)?.children.push(node)
    }
  }
  const sortByName = (a: TreeNode, b: TreeNode): number => a.name.localeCompare(b.name)
  const sortRecursive = (nodes: TreeNode[]): void => {
    nodes.sort(sortByName)
    nodes.forEach((n) => sortRecursive(n.children))
  }
  sortRecursive(roots)
  return roots
}

export function CollectionTree(): React.ReactElement {
  const { t } = useT('library')
  const collections = useAtomValue(libraryCollectionsAtom)
  const [selectedKey, setSelectedKey] = useAtom(librarySelectedCollectionKeyAtom)

  const tree = React.useMemo(() => buildTree(collections ?? []), [collections])

  return (
    <div className="flex flex-col">
      {/* sticky 标题 */}
      <div className="sticky top-0 z-10 px-3 pt-4 pb-2 bg-background/95 backdrop-blur-sm titlebar-drag-region">
        <div className="flex items-center gap-1.5 text-sm font-medium uppercase tracking-wider text-muted-foreground/70">
          <Library size={11} />
          <span>{t('title')}</span>
        </div>
      </div>

      <div className="px-2 pb-3 space-y-px">
        {/* 所有条目（顶项） */}
        <NodeRow
          icon={<Inbox size={14} />}
          label={t('tree.allItems')}
          selected={selectedKey === null}
          onClick={() => setSelectedKey(null)}
          depth={0}
        />
        {/* 真实 collections */}
        {tree.map((node) => (
          <TreeNodeRow
            key={node.key}
            node={node}
            depth={0}
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
          />
        ))}
      </div>
    </div>
  )
}

interface TreeNodeRowProps {
  node: TreeNode
  depth: number
  selectedKey: string | null
  onSelect: (key: string) => void
}

function TreeNodeRow({ node, depth, selectedKey, onSelect }: TreeNodeRowProps): React.ReactElement {
  const [expanded, setExpanded] = React.useState(true)
  const hasChildren = node.children.length > 0

  return (
    <>
      <NodeRow
        icon={expanded && hasChildren ? <FolderOpen size={14} /> : <Folder size={14} />}
        prefix={hasChildren ? (
          <Button
            type="button"
            variant="ghost"
            className="h-auto w-auto p-0.5 rounded hover:bg-muted [&_svg]:size-3"
            onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </Button>
        ) : (
          <span className="w-[18px]" />
        )}
        label={node.name}
        selected={selectedKey === node.key}
        onClick={() => onSelect(node.key)}
        depth={depth}
      />
      {expanded && node.children.map((child) => (
        <TreeNodeRow
          key={child.key}
          node={child}
          depth={depth + 1}
          selectedKey={selectedKey}
          onSelect={onSelect}
        />
      ))}
    </>
  )
}

interface NodeRowProps {
  icon: React.ReactNode
  label: string
  selected: boolean
  onClick: () => void
  depth: number
  prefix?: React.ReactNode
}

function NodeRow({ icon, label, selected, onClick, depth, prefix }: NodeRowProps): React.ReactElement {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 pr-2 py-1.5 rounded-md cursor-pointer text-sm transition-colors',
        selected
          ? 'bg-primary/10 text-primary font-medium'
          : 'hover:bg-muted/50 text-foreground/90',
      )}
      style={{ paddingLeft: `${depth * 14 + 6}px` }}
      onClick={onClick}
    >
      {prefix ?? <span className="w-[18px]" />}
      <span className={cn('flex-shrink-0', selected ? 'text-primary' : 'text-muted-foreground')}>
        {icon}
      </span>
      <span className="truncate flex-1">{label}</span>
    </div>
  )
}
