/** 历史检索方案只读展示，不提供确认、调整或重新检索。 */
import * as React from 'react'
import type { SearchPlanConfirmRequest, SearchPlanConfirmResponse, SearchPlanProposal } from '@asci/shared'
import { useT } from '@/hooks/useT'

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

export function SearchPlanCard({ request }: SearchPlanCardProps): React.ReactElement {
  const { t } = useT('conversation')
  const { plan } = request
  const timeRangeText = formatTimeRange(plan.timeRange, '–')

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

  return <div className="rounded-md bg-card p-3 text-sm shadow-sm">
    <p className="text-muted-foreground">{t('agent.scientificReadOnly')}</p>
    {body}
  </div>
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
