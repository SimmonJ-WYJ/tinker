/**
 * mcp__paper-search__process_search_results 工具结果渲染:
 * 标准:Layers icon + 「找到 N 篇论文」+ 「sources · 'query'」副行 + 「打开」按钮。
 * 点击卡片任意位置或「打开」→ 确保右栏 session-papers tab 存在并激活。
 * 解析失败 / isError → fallback 到 DefaultResultRenderer。
 */
import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Layers, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils.ts'
import { useT } from '@/hooks/useT.ts'
import { Button } from '@/components/ui/button.tsx'
import { currentAgentSessionIdAtom } from '@/atoms/agent-atoms.ts'
import {
  rightPanelTabsBySessionAtom,
  upsertTab,
} from '@/atoms/right-panel-tabs.ts'
import { DefaultResultRenderer } from './default-result'
import { parsePaperSearchResult } from './paper-search-result.ts'

interface PaperSearchResultRendererProps {
  result: string
  isError: boolean
  input: Record<string, unknown>
}

function readQuery(input: Record<string, unknown>): string | null {
  const q = input.query
  return typeof q === 'string' && q.length > 0 ? q : null
}

export function PaperSearchResultRenderer({
  result,
  isError,
  input,
}: PaperSearchResultRendererProps): React.ReactElement {
  const { t } = useT('conversation')
  const sessionId = useAtomValue(currentAgentSessionIdAtom)
  const setTabs = useSetAtom(
    rightPanelTabsBySessionAtom(sessionId ?? '__no_session__'),
  )

  const summary = isError ? null : parsePaperSearchResult(result)

  // 解析失败 / 工具报错 → 走默认 renderer (JSON 平铺)
  if (!summary) {
    return <DefaultResultRenderer result={result} isError={isError} />
  }

  const query = readQuery(input)
  const sourcesJoined = summary.sources.join('+')
  const hasSubline = sourcesJoined.length > 0 || query != null

  const handleOpen = (): void => {
    if (!sessionId) return
    setTabs((prev) => upsertTab(prev, 'session-papers', 'session-papers', '', null))
  }

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
      <Layers className="size-4 flex-shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground">
          {t('tool.paperSearch.foundN', { count: summary.count })}
        </div>
        {hasSubline && (
          <div className="text-sm text-muted-foreground truncate">
            {sourcesJoined}
            {sourcesJoined.length > 0 && query != null ? ' · ' : ''}
            {query != null ? `'${query}'` : ''}
          </div>
        )}
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={(e) => { e.stopPropagation(); handleOpen() }}
        disabled={!sessionId}
        className="gap-1 flex-shrink-0"
      >
        {t('tool.paperSearch.open')}
        <ArrowRight className="!size-3" />
      </Button>
    </Button>
  )
}
