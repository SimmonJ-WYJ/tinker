/**
 * SearchPlanCard — lit-search 检索方案确认 ChoiceCard（issue #435）
 *
 * 触发：main 进程 lit-search SDK MCP server tool handler 发起
 *   `search_plan_request` event → useGlobalAgentListeners 入队 →
 *   Conversation 区按 sessionId 取该请求并渲染本组件。
 *
 * 用户路径：
 *   - confirm → tool result `{ choice: 'confirm' }` → Agent 按原方案执行检索
 *   - adjust  → 弹 textarea 让用户用自然语言描述要改什么 →
 *               tool result `{ choice: 'adjust', adjustment }` → Agent 重出方案再确认
 *   - cancel (Esc) → tool result `{ choice: 'cancel' }` → Agent 不检索、收口
 *
 * 方案分项（关键词/源/时间范围/数量等）在 ChoiceCard body 内只读展示；
 * 「细粒度内联编辑」不在本组件范围（后续 issue 迭代）。
 */

import * as React from 'react'
import type { SearchPlanConfirmRequest, SearchPlanConfirmResponse, SearchPlanProposal } from '@asci/shared'
import { useT } from '@/hooks/useT'
import { Button } from '@/components/ui/button'
import { ChoiceCard, type ChoiceOption } from './ChoiceCard.tsx'

interface SearchPlanCardProps {
  request: SearchPlanConfirmRequest
  /** 用户操作后调用 — 内部 ipc invoke `search-plan:confirm-respond` */
  onRespond: (response: SearchPlanConfirmResponse) => void | Promise<void>
}

/** 把时间范围拼成可读文案 */
function formatTimeRange(range: SearchPlanProposal['timeRange'], dash: string): string | null {
  if (!range) return null
  const { from, to } = range
  if (from != null && to != null) return `${from}${dash}${to}`
  if (from != null) return `≥ ${from}`
  if (to != null) return `≤ ${to}`
  return null
}

export function SearchPlanCard({ request, onRespond }: SearchPlanCardProps): React.ReactElement {
  const { t } = useT('conversation')
  const [adjustMode, setAdjustMode] = React.useState(false)
  const [adjustText, setAdjustText] = React.useState('')

  const { plan } = request
  const timeRangeText = formatTimeRange(plan.timeRange, '–')

  const options: ChoiceOption[] = React.useMemo(
    () => [
      { id: 'confirm', label: t('agent.searchPlanConfirm.action.confirm') },
      { id: 'adjust', label: t('agent.searchPlanConfirm.action.adjust') },
      { id: 'cancel', label: t('agent.searchPlanConfirm.action.cancel') },
    ],
    [t],
  )

  // 方案分项只读展示
  const body = (
    <div className="flex flex-col gap-2 px-3 py-2 text-sm">
      <PlanField label={t('agent.searchPlanConfirm.field.researchQuestion')}>
        <span className="text-foreground">{plan.researchQuestion}</span>
      </PlanField>
      <PlanField label={t('agent.searchPlanConfirm.field.keywords')}>
        <Chips items={plan.keywords} />
      </PlanField>
      <PlanField label={t('agent.searchPlanConfirm.field.sources')}>
        <Chips items={plan.sources} />
      </PlanField>
      {plan.methodTerms && plan.methodTerms.length > 0 && (
        <PlanField label={t('agent.searchPlanConfirm.field.methodTerms')}>
          <Chips items={plan.methodTerms} />
        </PlanField>
      )}
      {plan.objectTerms && plan.objectTerms.length > 0 && (
        <PlanField label={t('agent.searchPlanConfirm.field.objectTerms')}>
          <Chips items={plan.objectTerms} />
        </PlanField>
      )}
      {timeRangeText && (
        <PlanField label={t('agent.searchPlanConfirm.field.timeRange')}>
          <span className="text-foreground">{timeRangeText}</span>
        </PlanField>
      )}
      {plan.targetCount != null && (
        <PlanField label={t('agent.searchPlanConfirm.field.targetCount')}>
          <span className="text-foreground">{plan.targetCount}</span>
        </PlanField>
      )}
    </div>
  )

  const handleSelect = (optionId: string): void => {
    if (optionId === 'confirm') {
      void onRespond({ requestId: request.requestId, choice: 'confirm' })
      return
    }
    if (optionId === 'adjust') {
      setAdjustMode(true)
      return
    }
    if (optionId === 'cancel') {
      void onRespond({ requestId: request.requestId, choice: 'cancel' })
      return
    }
  }

  const handleSubmitAdjust = (): void => {
    const trimmed = adjustText.trim()
    if (trimmed.length === 0) return
    void onRespond({ requestId: request.requestId, choice: 'adjust', adjustment: trimmed })
  }

  if (adjustMode) {
    return (
      <div className="rounded-md border border-border/40 bg-card p-3 shadow-sm">
        <div className="text-sm font-medium text-foreground mb-2">{t('agent.searchPlanConfirm.adjustTitle')}</div>
        <textarea
          autoFocus
          value={adjustText}
          onChange={(e) => setAdjustText(e.target.value)}
          placeholder={t('agent.searchPlanConfirm.adjustPlaceholder')}
          className="w-full min-h-[100px] resize-y rounded-md border border-border/40 bg-background px-3 py-2 text-sm focus:outline-none"
        />
        <div className="flex justify-end gap-2 mt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => { setAdjustMode(false); setAdjustText('') }}
            className="h-auto px-3 py-1.5 text-sm text-foreground/70 hover:bg-muted"
          >
            {t('agent.searchPlanConfirm.action.cancel')}
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={handleSubmitAdjust}
            disabled={adjustText.trim().length === 0}
            className="h-auto px-3 py-1.5 text-sm shadow-none disabled:cursor-not-allowed"
          >
            {t('agent.searchPlanConfirm.adjustSubmit')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <ChoiceCard
      title={t('agent.searchPlanConfirm.title')}
      subtitle={t('agent.searchPlanConfirm.subtitle')}
      body={body}
      options={options}
      defaultFocusedId="confirm"
      onSelect={handleSelect}
      onDismiss={() => void onRespond({ requestId: request.requestId, choice: 'cancel' })}
    />
  )
}

function PlanField({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex gap-2">
      <span className="shrink-0 w-20 text-xs text-muted-foreground pt-0.5">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

function Chips({ items }: { items: string[] }): React.ReactElement {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item, i) => (
        <span key={`${item}-${i}`} className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-badge text-foreground">
          {item}
        </span>
      ))}
    </div>
  )
}
