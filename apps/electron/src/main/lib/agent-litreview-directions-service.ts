/**
 * Lit-review present_directions 服务（spec §5.4 Turn 1 ChoiceCard 异步等待）
 *
 * 与 AgentExitPlanService 对称的 Promise + Map 异步等待模式：
 *  1. lit-review SDK MCP server 的 `present_directions` tool handler 调
 *     handlePresentDirections() 拦截
 *  2. 发请求给 renderer 渲染 ChoiceCardShell + 方向卡片
 *  3. 阻塞等用户选择 → IPC 回填 respondPresentDirections() → Promise resolve
 *  4. tool handler 把 resolve 值序列化为 tool_result → SDK 续走 Agent
 *
 * 不在本服务范围（推迟 PR-F）：
 *  - directions 内容生成（由 review-proposer Skill / lit-review 场景 Agent 负责）
 *  - choice='custom' / 'reroll' 的下游 Agent 续作（由 lit-review prompt 自己识别处理）
 */

import { randomUUID } from 'node:crypto'
import type {
  LitReviewDirection,
  LitReviewPresentDirectionsRequest,
  LitReviewPresentDirectionsResponse,
} from '@asci/shared'

/** tool handler 等待用户选择后的结果（驱动 SDK 续走 Agent） */
export type LitReviewDirectionsResult =
  | { kind: 'pick'; choice: '1' | '2' | '3'; direction: LitReviewDirection }
  | { kind: 'comprehensive' }
  | { kind: 'reroll' }
  | { kind: 'custom'; customDirection: string }
  | { kind: 'cancel' }

interface PendingRequest {
  resolve: (result: LitReviewDirectionsResult) => void
  request: LitReviewPresentDirectionsRequest
  /**
   * 是否已向 renderer 发过方向卡。同 session 仅首个 pending 为 true；后续重复请求被
   * **折叠**（不再弹第二张卡），挂到现有卡上，用户选一次即随该 session 一起 resolve。
   * 防止 present_directions 被多次调用（如 master 重派闭合轮）时堆叠多张方向卡。
   */
  shown: boolean
}

/**
 * Lit-review present_directions 服务（单例）
 *
 * 复用 AgentExitPlanService 异步等待范式；管理跨 session 的 pending 请求。
 */
export class AgentLitReviewDirectionsService {
  private pendingRequests = new Map<string, PendingRequest>()

  /**
   * lit-review SDK MCP server tool handler 入口
   *
   * @param sessionId 触发的 agent session ID
   * @param directions 3 个候选方向
   * @param signal AbortSignal — session 取消时清理
   * @param sendToRenderer IPC 发请求函数
   * @param options 可选 reroll / custom / comprehensive 按钮文案 + comprehensive 说明（均由 Agent 按回复语言传入）
   */
  handlePresentDirections(
    sessionId: string,
    directions: LitReviewDirection[],
    signal: AbortSignal,
    sendToRenderer: (request: LitReviewPresentDirectionsRequest) => void,
    options?: {
      rerollLabel?: string
      customLabel?: string
      comprehensiveLabel?: string
      comprehensiveDescription?: string
    },
  ): Promise<LitReviewDirectionsResult> {
    const request: LitReviewPresentDirectionsRequest = {
      requestId: randomUUID(),
      sessionId,
      directions,
      ...(options?.rerollLabel && { rerollLabel: options.rerollLabel }),
      ...(options?.customLabel && { customLabel: options.customLabel }),
      ...(options?.comprehensiveLabel && { comprehensiveLabel: options.comprehensiveLabel }),
      ...(options?.comprehensiveDescription && { comprehensiveDescription: options.comprehensiveDescription }),
    }

    // 同 session 折叠：若该 session 已有未解决的方向卡，则不再弹新卡——把本请求挂到
    // 现有卡上（shown=false），用户选一次时随 respondPresentDirections 一并 resolve。
    const hasActive = [...this.pendingRequests.values()].some(
      (p) => p.request.sessionId === sessionId,
    )
    const shown = !hasActive
    if (shown) {
      sendToRenderer(request)
    } else {
      console.warn(
        `[LitReviewDirectionsService] session=${sessionId} 已有未解决方向卡，折叠重复请求 requestId=${request.requestId}（不再弹新卡）`,
      )
    }

    return new Promise<LitReviewDirectionsResult>((resolve) => {
      this.pendingRequests.set(request.requestId, { resolve, request, shown })

      signal.addEventListener(
        'abort',
        () => {
          if (this.pendingRequests.has(request.requestId)) {
            console.warn(`[LitReviewDirectionsService] AbortSignal 触发，cancel: requestId=${request.requestId}`)
            this.pendingRequests.delete(request.requestId)
            resolve({ kind: 'cancel' })
          }
        },
        { once: true },
      )
    })
  }

  /** IPC handler 调用：用户在 renderer 选完后回填 */
  respondPresentDirections(response: LitReviewPresentDirectionsResponse): { sessionId: string } | null {
    const matched = this.pendingRequests.get(response.requestId)
    if (!matched) return null

    const sessionId = matched.request.sessionId

    // 'pick' 的 direction 取自各请求自己的 directions，故逐请求计算 result（折叠的重复
    // 一般 directions 相同，但仍按各自查找以保正确）；其余 choice 的 result 一致。
    const resultFor = (p: PendingRequest): LitReviewDirectionsResult => {
      switch (response.choice) {
        case '1':
        case '2':
        case '3': {
          const direction = p.request.directions.find((d) => d.key === response.choice)
          return direction
            ? { kind: 'pick', choice: response.choice, direction }
            : { kind: 'cancel' }
        }
        case 'comprehensive':
          return { kind: 'comprehensive' }
        case 'reroll':
          return { kind: 'reroll' }
        case 'custom':
          return { kind: 'custom', customDirection: response.customDirection }
        case 'cancel':
          return { kind: 'cancel' }
      }
    }

    // 用户决定应用到该 session 的**所有**挂起请求（含被折叠的重复），一并 resolve 并清除。
    for (const [requestId, p] of [...this.pendingRequests]) {
      if (p.request.sessionId === sessionId) {
        p.resolve(resultFor(p))
        this.pendingRequests.delete(requestId)
      }
    }
    return { sessionId }
  }

  /** renderer 刷新后下发当前 pending 请求列表，恢复 UI（仅已弹卡的，折叠的重复不恢复成额外卡） */
  getPendingRequests(): LitReviewPresentDirectionsRequest[] {
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

/** 全局 lit-review present_directions 服务实例 */
export const litReviewDirectionsService = new AgentLitReviewDirectionsService()
