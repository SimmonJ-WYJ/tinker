/**
 * 确认卡「同 session 折叠」守卫测试
 *
 * present_search_plan / present_directions 是 in-process SDK MCP，服务层按 requestId 存 pending、
 * renderer 按 session 追加队列——两层都不去重。若确认工具被多次调用（scenario 误调 + master
 * 确认门、或重派闭合轮），会堆叠多张确认卡。守卫：同 session 已有未解决卡时折叠后续请求（不再弹
 * 新卡），用户答一次时该 session 所有挂起请求用同一结果一并 resolve。
 */
import { test, expect, describe } from 'bun:test'
import { AgentSearchPlanService } from '../agent-search-plan-service.ts'
import { AgentLitReviewDirectionsService } from '../agent-litreview-directions-service.ts'
import type { SearchPlanProposal, LitReviewDirection } from '@asci/shared'

const sig = (): AbortSignal => new AbortController().signal
const PLAN: SearchPlanProposal = { researchQuestion: 'q', keywords: ['k'], sources: ['openalex'] }
const DIRS: LitReviewDirection[] = (['1', '2', '3'] as const).map((key) => ({
  key,
  title: `dir ${key}`,
  thesis: '',
  outlinePreview: [],
  papersInScope: [],
}))

describe('AgentSearchPlanService — 同 session 折叠', () => {
  test('同 session 第二次请求不再弹卡；用户答一次两个 Promise 同结果 resolve', async () => {
    const svc = new AgentSearchPlanService()
    const sent: string[] = []
    let firstReqId = ''
    const send = (r: { requestId: string }): void => {
      sent.push(r.requestId)
      if (!firstReqId) firstReqId = r.requestId
    }
    const p1 = svc.handlePresentSearchPlan('s1', PLAN, sig(), send)
    const p2 = svc.handlePresentSearchPlan('s1', PLAN, sig(), send)

    expect(sent.length).toBe(1) // 只弹一张卡（第二次被折叠）
    expect(svc.getPendingRequests().length).toBe(1) // 仅一张可恢复

    const res = svc.respondConfirm({ requestId: firstReqId, choice: 'confirm' })
    expect(res?.sessionId).toBe('s1')
    expect(await p1).toEqual({ kind: 'confirm' })
    expect(await p2).toEqual({ kind: 'confirm' }) // 折叠的重复也被同结果 resolve，不悬挂
    expect(svc.getPendingRequests().length).toBe(0)
  })

  test('不同 session 各弹各的卡', () => {
    const svc = new AgentSearchPlanService()
    const sent: string[] = []
    svc.handlePresentSearchPlan('a', PLAN, sig(), (r) => sent.push(r.sessionId))
    svc.handlePresentSearchPlan('b', PLAN, sig(), (r) => sent.push(r.sessionId))
    expect(sent).toEqual(['a', 'b'])
    expect(svc.getPendingRequests().length).toBe(2)
  })

  test('答完后同 session 新请求重新弹卡（adjust 回环不受影响）', () => {
    const svc = new AgentSearchPlanService()
    const sent: string[] = []
    let id = ''
    const send = (r: { requestId: string }): void => { sent.push(r.requestId); id = r.requestId }
    svc.handlePresentSearchPlan('s1', PLAN, sig(), send)
    svc.respondConfirm({ requestId: id, choice: 'adjust', adjustment: 'only arxiv' })
    svc.handlePresentSearchPlan('s1', PLAN, sig(), send) // 旧卡已 resolve → 新卡照常弹
    expect(sent.length).toBe(2)
  })
})

describe('AgentLitReviewDirectionsService — 同 session 折叠', () => {
  test('同 session 第二次不再弹卡；pick 用各自 directions 一并 resolve', async () => {
    const svc = new AgentLitReviewDirectionsService()
    const sent: string[] = []
    let firstReqId = ''
    const send = (r: { requestId: string }): void => {
      sent.push(r.requestId)
      if (!firstReqId) firstReqId = r.requestId
    }
    const p1 = svc.handlePresentDirections('s1', DIRS, sig(), send)
    const p2 = svc.handlePresentDirections('s1', DIRS, sig(), send)

    expect(sent.length).toBe(1)
    expect(svc.getPendingRequests().length).toBe(1)

    svc.respondPresentDirections({ requestId: firstReqId, choice: '2' })
    expect(await p1).toEqual({ kind: 'pick', choice: '2', direction: DIRS[1] })
    expect(await p2).toEqual({ kind: 'pick', choice: '2', direction: DIRS[1] })
    expect(svc.getPendingRequests().length).toBe(0)
  })
})
