/** 旧科研确认服务重复调用仍立即取消，不恢复旧确认循环。 */
import { test, expect } from 'bun:test'
import { AgentSearchPlanService } from '../agent-search-plan-service.ts'
import { AgentLitReviewDirectionsService } from '../agent-litreview-directions-service.ts'

test('同会话重复与跨会话旧请求均取消，不堆积卡片或 Promise', async () => {
  const search = new AgentSearchPlanService()
  const review = new AgentLitReviewDirectionsService()
  const dispatch = (): never => { throw new Error('不应派发旧科研确认卡') }
  for (const session of ['same', 'same', 'other']) {
    const signal = new AbortController().signal
    expect(await search.handlePresentSearchPlan(session, { researchQuestion: 'q', keywords: [], sources: [] }, signal, dispatch)).toEqual({ kind: 'cancel' })
    expect(await review.handlePresentDirections(session, [], signal, dispatch)).toEqual({ kind: 'cancel' })
  }
  expect(search.getPendingRequests()).toEqual([])
  expect(review.getPendingRequests()).toEqual([])
})
