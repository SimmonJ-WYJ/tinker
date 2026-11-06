/**
 * lit-search present_search_plan 服务（检索方案确认 · issue #435）
 *
 * 与 AgentLitReviewDirectionsService 对称的 Promise + Map 异步等待模式：
 *  1. lit-search SDK MCP server 的 `present_search_plan` tool handler 调
 *     handlePresentSearchPlan() 拦截
 *  2. 发请求给 renderer 渲染 ChoiceCard（方案分项 + 确认/调整/取消）
 *  3. 阻塞等用户操作 → IPC 回填 respondConfirm() → Promise resolve
 *  4. tool handler 把 resolve 值序列化为 tool_result → SDK 续走 Agent
 *
 * 不在本服务范围：
 *  - 方案内容生成（由 lit-search 场景 Agent 规划轮负责）
 *  - choice='adjust' 后的方案重写（由 lit-search prompt 自己识别处理）
 */

import { randomUUID } from 'node:crypto'
import type {
  SearchPlanProposal,
  SearchPlanConfirmRequest,
  SearchPlanConfirmResponse,
} from '@asci/shared'

/** tool handler 等待用户操作后的结果（驱动 SDK 续走 Agent） */
export type SearchPlanConfirmResult =
  | { kind: 'confirm' }
  | { kind: 'adjust'; adjustment: string }
  | { kind: 'cancel' }

interface PendingRequest {
  resolve: (result: SearchPlanConfirmResult) => void
  request: SearchPlanConfirmRequest
  /**
   * 是否已向 renderer 发过确认卡。同 session 仅首个 pending 为 true；后续重复请求被
   * **折叠**（不再弹第二张卡），挂到现有卡上，用户答一次即随该 session 一起 resolve。
   * 防止 present_search_plan 被多次调用（scenario 误调 + master 确认门、或重派）时堆叠多张卡。
   */
  shown: boolean
}

/**
 * lit-search present_search_plan 服务（单例）
 *
 * 复用 AgentLitReviewDirectionsService 异步等待范式；管理跨 session 的 pending 请求。
 */
export class AgentSearchPlanService {
  private pendingRequests = new Map<string, PendingRequest>()

  /**
   * lit-search SDK MCP server tool handler 入口
   *
   * @param sessionId 触发的 agent session ID
   * @param plan 拟定的检索方案
   * @param signal AbortSignal — session 取消时清理
   * @param sendToRenderer IPC 发请求函数
   */
  handlePresentSearchPlan(
    sessionId: string,
    plan: SearchPlanProposal,
    signal: AbortSignal,
    sendToRenderer: (request: SearchPlanConfirmRequest) => void,
  ): Promise<SearchPlanConfirmResult> {
    const request: SearchPlanConfirmRequest = {
      requestId: randomUUID(),
      sessionId,
      plan,
    }

    // 同 session 折叠：若该 session 已有未解决的确认卡，则不再弹新卡——把本请求挂到
    // 现有卡上（shown=false），用户答一次时随 respondConfirm 一并 resolve。保证一个
    // session 同时最多一张检索确认卡，无论 present_search_plan 被调几次。
    const hasActive = [...this.pendingRequests.values()].some(
      (p) => p.request.sessionId === sessionId,
    )
    const shown = !hasActive
    if (shown) {
      sendToRenderer(request)
    } else {
      console.warn(
        `[SearchPlanService] session=${sessionId} 已有未解决确认卡，折叠重复请求 requestId=${request.requestId}（不再弹新卡）`,
      )
    }

    return new Promise<SearchPlanConfirmResult>((resolve) => {
      this.pendingRequests.set(request.requestId, { resolve, request, shown })

      signal.addEventListener(
        'abort',
        () => {
          if (this.pendingRequests.has(request.requestId)) {
            console.warn(`[SearchPlanService] AbortSignal 触发，cancel: requestId=${request.requestId}`)
            this.pendingRequests.delete(request.requestId)
            resolve({ kind: 'cancel' })
          }
        },
        { once: true },
      )
    })
  }

  /** IPC handler 调用：用户在 renderer 操作后回填 */
  respondConfirm(response: SearchPlanConfirmResponse): { sessionId: string } | null {
    const pending = this.pendingRequests.get(response.requestId)
    if (!pending) return null

    const sessionId = pending.request.sessionId
    const result: SearchPlanConfirmResult =
      response.choice === 'confirm'
        ? { kind: 'confirm' }
        : response.choice === 'adjust'
          ? { kind: 'adjust', adjustment: response.adjustment }
          : { kind: 'cancel' }

    // 一个 session 的用户决定应用到该 session 的**所有**挂起请求（含被折叠的重复），
    // 用同一结果一并 resolve 并清除——避免折叠的重复请求成为永不解决的悬挂 Promise。
    for (const [requestId, p] of [...this.pendingRequests]) {
      if (p.request.sessionId === sessionId) {
        p.resolve(result)
        this.pendingRequests.delete(requestId)
      }
    }
    return { sessionId }
  }

  /** renderer 刷新后下发当前 pending 请求列表，恢复 UI（仅已弹卡的，折叠的重复不恢复成额外卡） */
  getPendingRequests(): SearchPlanConfirmRequest[] {
    return [...this.pendingRequests.values()].filter((p) => p.shown).map((p) => p.request)
  }

  /** 清除指定会话的所有待处理请求 */
  clearSessionPending(sessionId: string): void {
    for (const [requestId, pending] of this.pendingRequests) {
      if (pending.request.sessionId === sessionId) {
        pending.resolve({ kind: 'cancel' })
        this.pendingRequests.delete(requestId)
      }
    }
  }
}

/** 全局 lit-search present_search_plan 服务实例 */
export const searchPlanService = new AgentSearchPlanService()
