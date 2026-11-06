/**
 * mcp__researchgap__present_research_gap_table 工具结果渲染：
 * 在对话流内呈现一张持久卡片（Table2 icon + AI 标题 + 「N 篇 · M 空白 · K 冲突」副行 + 「打开」），
 * 点击 → 把表灌回 store（内存若已无，按工具入参重建）并打开/聚焦右栏对应的研究空白 Tab。
 * 关掉 Tab 后随时能从这张卡片再唤起。解析失败 / isError → fallback 默认渲染。
 */
import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { ArrowRight } from 'lucide-react'
import { TelescopeIcon } from '../result-card-icons.tsx'
import { cn } from '@/lib/utils.ts'
import { useT } from '@/hooks/useT.ts'
import { Button } from '@/components/ui/button.tsx'
import { currentAgentSessionIdAtom } from '@/atoms/agent-atoms.ts'
import { rightPanelTabsBySessionAtom, openResearchGapTab } from '@/atoms/right-panel-tabs.ts'
import {
  researchGapTablesBySessionAtom,
  appendResearchGapTable,
} from '@/atoms/research-gap-atoms.ts'
import { DefaultResultRenderer } from './default-result'
import { parseResearchGapResult, buildTableFromInput } from './research-gap-result.ts'

interface ResearchGapResultRendererProps {
  result: string
  isError: boolean
  input: Record<string, unknown>
}

export function ResearchGapResultRenderer({
  result,
  isError,
  input,
}: ResearchGapResultRendererProps): React.ReactElement {
  const { t } = useT('conversation')
  const sessionId = useAtomValue(currentAgentSessionIdAtom)
  const setTabs = useSetAtom(rightPanelTabsBySessionAtom(sessionId ?? '__no_session__'))
  const setTables = useSetAtom(researchGapTablesBySessionAtom)

  const summary = isError ? null : parseResearchGapResult(result)
  if (!summary) {
    return <DefaultResultRenderer result={result} isError={isError} />
  }

  const title = summary.title || t('rightPanel.tabs.researchGap')

  const handleOpen = (): void => {
    if (!sessionId) return
    // 内存态可能已被清空（重启）→ 按工具入参重建并灌回，保证 Tab 打开有数据
    const rebuilt = buildTableFromInput(input, summary.tableId)
    if (rebuilt) {
      setTables((prev) => appendResearchGapTable(prev, sessionId, rebuilt))
    }
    setTabs((prev) => openResearchGapTab(prev, summary.tableId, summary.title))
  }

  // 副行：N 篇 · M 空白 · K 冲突
  const subline = [
    t('researchGap.insights.involvedPapers', { count: summary.rows }),
    t('tool.researchGap.gapsN', { count: summary.gaps }),
    t('tool.researchGap.conflictsN', { count: summary.conflicts }),
  ].join(' · ')

  return (
    <Button
      type="button"
      variant="list"
      size="row"
      onClick={handleOpen}
      disabled={!sessionId}
      className={cn(
        'group gap-3 rounded-md border border-border bg-muted/30',
        'hover:bg-muted/60 hover:text-foreground',
        !sessionId && 'opacity-60 cursor-not-allowed',
      )}
    >
      <TelescopeIcon className="size-4 flex-shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="truncate text-sm font-medium text-foreground">{title}</div>
        <div className="truncate text-sm text-muted-foreground">{subline}</div>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={(e) => { e.stopPropagation(); handleOpen() }}
        disabled={!sessionId}
        className="gap-1 flex-shrink-0"
      >
        {t('tool.researchGap.open')}
        <ArrowRight className="!size-3" />
      </Button>
    </Button>
  )
}
