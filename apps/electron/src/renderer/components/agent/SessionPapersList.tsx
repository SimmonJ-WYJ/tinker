/**
 * SessionPapersList — 卡片列表（Phase 2 重构）
 *
 * 内部读取 multiSelect / selectedKeys / density atom，自行决定 checkbox 渲染与卡片尺寸。
 * 调用方只需传入 sessionId、items 与事件回调。
 *
 * 注意：滚动容器（overflow-y-auto）和空态（EmptyState）均保留在 SessionPapersPanel，
 * 本组件只负责 <ul> 及其内部卡片映射。
 */

import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { cn } from '@/lib/utils'
import { SimplePaperCard, RecordOnlyCard, type SimplePaperCardProps } from './SessionPaperCard'
import {
  sessionPapersMultiSelectActiveFamilyAtom,
  sessionPapersSelectedKeysFamilyAtom,
  sessionPapersDensityAtom,
} from '@/atoms/session-papers-ui-atoms'
import type { PaperRecord, WorkspacePaperEntry } from '@asci/shared'

export interface SessionPapersListItem {
  key: string
  record?: PaperRecord
  entry?: WorkspacePaperEntry
  /** 是否可被多选（已入 Zotero 的卡片不可选）；默认 true */
  selectable?: boolean
}

export interface SessionPapersListProps {
  sessionId: string
  items: SessionPapersListItem[]
  onOpenPreview: (item: SessionPapersListItem) => void
  onLinkZotero?: (item: SessionPapersListItem) => void
}

export function SessionPapersList({
  sessionId,
  items,
  onOpenPreview,
  onLinkZotero,
}: SessionPapersListProps): React.ReactElement {
  const multiSelectActive = useAtomValue(sessionPapersMultiSelectActiveFamilyAtom(sessionId))
  const [selectedKeys, setSelectedKeys] = useAtom(sessionPapersSelectedKeysFamilyAtom(sessionId))
  const density = useAtomValue(sessionPapersDensityAtom)
  const size: NonNullable<SimplePaperCardProps['size']> = density === 'compact' ? 'compact' : 'expanded'

  const toggleSelect = React.useCallback((key: string): void => {
    setSelectedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [setSelectedKeys])

  // 选择态下顶栏已带 mb-2，列表去掉 pt 避免双重顶部留白
  return (
    <ul
      className={cn(
        'px-2.5',
        size === 'expanded' ? 'space-y-2' : 'space-y-1.5',
        multiSelectActive ? '' : size === 'expanded' ? 'pt-2' : 'pt-1.5',
      )}
    >
      {items.map((item) => {
        // 已入 Zotero 的卡片不可再选：checkbox 禁用置灰，且点卡片不切换选中态
        const selectable = item.selectable ?? true
        const checkboxNode = (
          <input
            type="checkbox"
            checked={selectedKeys.has(item.key)}
            disabled={!selectable}
            onChange={() => { if (selectable) toggleSelect(item.key) }}
            className={cn('mt-1 size-3.5', selectable ? 'cursor-pointer' : 'cursor-not-allowed opacity-40')}
          />
        )
        // 多选模式下：点可选卡片主体切换选中态；不可选 / 非多选模式：打开预览
        const handleCardClick = multiSelectActive && selectable
          ? () => toggleSelect(item.key)
          : () => onOpenPreview(item)
        return item.entry != null ? (
          <SimplePaperCard
            key={item.key}
            entry={item.entry}
            record={item.record}
            size={size}
            checkboxNode={checkboxNode}
            showCheckbox={multiSelectActive}
            isSelected={selectedKeys.has(item.key)}
            selectable={selectable}
            onOpenPreview={handleCardClick}
            onLinkZotero={onLinkZotero ? () => onLinkZotero(item) : undefined}
          />
        ) : (
          <RecordOnlyCard
            key={item.key}
            record={item.record!}
            size={size}
            checkboxNode={checkboxNode}
            showCheckbox={multiSelectActive}
            isSelected={selectedKeys.has(item.key)}
            selectable={selectable}
            onOpenPreview={handleCardClick}
            onLinkZotero={onLinkZotero ? () => onLinkZotero(item) : undefined}
          />
        )
      })}
    </ul>
  )
}
