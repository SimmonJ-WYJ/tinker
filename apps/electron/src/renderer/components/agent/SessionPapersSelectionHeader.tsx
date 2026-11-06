/**
 * SessionPapersSelectionHeader — 多选「选择态」顶栏
 *
 * 进入选择态后替换普通工具栏（筛选 / 排序 / 标题退场）：
 * 左 = 已选计数，右 = 全选/清空 + 取消（退出选择态）。
 * 批量动作（加入 Zotero 等）下沉到底部 SessionPapersSelectionActions。
 */
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { useT } from '@/hooks/useT'

/** 右侧文字动作按钮（全选/清空 · 取消）共用样式 */
const HEADER_ACTION_CLS = 'h-auto px-2 py-1 text-xs text-primary hover:bg-primary/15 hover:text-primary'

export interface SessionPapersSelectionHeaderProps {
  /** 已选数量 */
  selectedCount: number
  /** 可选总数（用于判断是否全选） */
  totalCount: number
  /** 全选 / 清空切换 */
  onToggleSelectAll: () => void
  /** 退出选择态 */
  onExit: () => void
}

export function SessionPapersSelectionHeader({
  selectedCount,
  totalCount,
  onToggleSelectAll,
  onExit,
}: SessionPapersSelectionHeaderProps): React.ReactElement {
  const { t } = useT('conversation')
  const allSelected = totalCount > 0 && selectedCount === totalCount
  const someSelected = selectedCount > 0 && !allSelected

  return (
    // mx-1 让宽度与下方列表（ul px-1）对齐；mt-2/mb-2 让上下留白等于卡片间距（8px），
    // mb-2 避免选中态顶栏与首张卡片同色（bg-primary/10）背景糊在一起
    // pl-3 与卡片 pl-3 同值，使头部勾选框与下方行 checkbox 同列对齐
    <div className="mx-1 mb-2 mt-2 flex flex-shrink-0 items-center justify-between gap-2 rounded-md bg-primary/10 px-3 py-2">
      {/* 左：勾选框 + 全选/清空（同一 label，点击即切换）+ 取消 */}
      <div className="flex items-center gap-2">
        <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-primary">
          <input
            type="checkbox"
            ref={(el) => { if (el) el.indeterminate = someSelected }}
            checked={allSelected}
            disabled={totalCount === 0}
            onChange={onToggleSelectAll}
            className="size-3.5 cursor-pointer"
          />
          {allSelected ? t('sessionPapers.bulk.clearAll') : t('sessionPapers.bulk.selectAll')}
        </label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onExit}
          className={HEADER_ACTION_CLS}
        >
          {t('sessionPapers.bulk.exit')}
        </Button>
      </div>
      <span className="text-xs font-medium text-primary">
        {t('sessionPapers.selection.selectedCount', { count: selectedCount })}
      </span>
    </div>
  )
}
