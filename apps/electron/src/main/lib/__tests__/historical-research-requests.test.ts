import { expect, mock, test } from 'bun:test'
import { AgentSearchPlanService } from '../agent-search-plan-service'
import { AgentLitReviewDirectionsService } from '../agent-litreview-directions-service'

test('旧研究请求立即 cancel、零 renderer 派发、零 pending；迟到 confirm 不能启动工作', async () => {
 const search = new AgentSearchPlanService()
 const review = new AgentLitReviewDirectionsService()
 const dispatch = mock(() => {})
 const controller = new AbortController()
 const settled: unknown[] = []
 void search.handlePresentSearchPlan('old', { researchQuestion: 'old', keywords: [], sources: [] } as never, controller.signal, dispatch).then(value => settled.push(value))
 void review.handlePresentDirections('old', [], controller.signal, dispatch).then(value => settled.push(value))
 await Promise.resolve()
 expect(settled).toEqual([{ kind: 'cancel' }, { kind: 'cancel' }])
 expect(dispatch).toHaveBeenCalledTimes(0)
 expect(search.getPendingRequests()).toEqual([])
 expect(review.getPendingRequests()).toEqual([])
 expect(search.respondConfirm({ requestId: 'stale', choice: 'confirm' })).toBeNull()
 expect(review.respondPresentDirections({ requestId: 'stale', choice: 'comprehensive' })).toBeNull()
})
