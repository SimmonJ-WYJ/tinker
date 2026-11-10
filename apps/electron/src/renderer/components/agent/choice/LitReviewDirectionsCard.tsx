/** 历史方向选择仅展示保存内容；通用 ChoiceCard 不受影响。 */
import type { ReactElement } from 'react'
import type { LitReviewPresentDirectionsRequest, LitReviewPresentDirectionsResponse } from '@asci/shared'
import { useT } from '@/hooks/useT'

interface LitReviewDirectionsCardProps {
  request: LitReviewPresentDirectionsRequest
  onRespond: (response: LitReviewPresentDirectionsResponse) => void | Promise<void>
}

export function LitReviewDirectionsCard({ request }: LitReviewDirectionsCardProps): ReactElement {
  const { t } = useT('conversation')
  return <div className="rounded-md bg-card p-3 text-sm shadow-sm">
    <p className="mb-2 text-muted-foreground">{t('agent.scientificReadOnly')}</p>
    {request.directions.map(direction => <div key={direction.key} className="mb-2">
      <p className="font-medium">{direction.key}. {direction.title}</p>
      <p>{direction.thesis}</p>
      <p>{direction.outlinePreview.join(' · ')}</p>
    </div>)}
  </div>
}
