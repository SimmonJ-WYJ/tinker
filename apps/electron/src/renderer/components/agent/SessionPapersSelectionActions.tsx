/**
 * SessionPapersSelectionActions — 选择态底部常驻动作条
 *
 * 对选中的一组论文的批量动作：加入 Zotero / 找研究空白（0.4 Epic 1 的 spec 入口：
 * 勾选一组论文 → 发起研究空白对照分析，以选中论文为输入）。
 * 顶部计数 / 全选 / 取消见 SessionPapersSelectionHeader；导出等后续动作再加。
 */
import * as React from 'react'
import { BookMarked, Loader2 } from 'lucide-react'
import { TelescopeIcon } from './result-card-icons'
import { Button } from '@/components/ui/button'
import { useT } from '@/hooks/useT'

export interface SessionPapersSelectionActionsProps {
  /** 已选数量；为 0 时禁用动作 */
  selectedCount: number
  /** 批量加入 Zotero */
  onAddToZoteroBatch: () => void | Promise<void>
  /** 找研究空白：以选中的论文为输入打开研究空白对照表（0.4 Epic 1） */
  onFindResearchGap: () => void
  /** 研究空白正在生成中（本会话 Agent 运行中）：按钮转 loading + 禁用，完成后再激活 */
  researchGapBusy?: boolean
}

export function SessionPapersSelectionActions({
  selectedCount,
  onAddToZoteroBatch,
  onFindResearchGap,
  researchGapBusy = false,
}: SessionPapersSelectionActionsProps): React.ReactElement {
  const { t } = useT('conversation')
  const [submitting, setSubmitting] = React.useState(false)

  const handleAdd = async (): Promise<void> => {
    if (selectedCount === 0 || submitting) return
    setSubmitting(true)
    try {
      await onAddToZoteroBatch()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-shrink-0 items-center gap-2 px-1 pt-2">
      {/* 加入 Zotero：有选中 → 主色填充强按钮；未选中 → outline 弱样式（且 disabled） */}
      <Button
        type="button"
        variant={selectedCount > 0 ? 'default' : 'outline'}
        onClick={handleAdd}
        disabled={selectedCount === 0 || submitting}
        className="h-auto flex-1 gap-2 py-2 text-sm font-medium [&_svg]:size-4"
      >
        <BookMarked className="size-4" />
        {t('sessionPapers.bulk.addToZotero')}
      </Button>
      {/* 找研究空白：以选中论文为输入发起对照分析（spec §5.1 入口 A）。
          生成中（researchGapBusy）转 loading + 禁用，等上一份生成完成再激活，避免并发发起 */}
      <Button
        type="button"
        variant="outline"
        onClick={onFindResearchGap}
        disabled={selectedCount === 0 || researchGapBusy}
        className="h-auto flex-1 gap-2 py-2 text-sm font-medium [&_svg]:size-4"
      >
        {researchGapBusy ? <Loader2 className="size-4 animate-spin" /> : <TelescopeIcon className="size-4" />}
        {researchGapBusy
          ? t('sessionPapers.bulk.findingResearchGap')
          : t('sessionPapers.bulk.findResearchGap')}
      </Button>
    </div>
  )
}
