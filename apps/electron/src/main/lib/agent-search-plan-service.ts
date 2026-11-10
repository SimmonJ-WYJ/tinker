/** 已退役的科研请求兼容接口：立即取消，不派发卡片、不保存挂起 Promise。 */
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

export class AgentSearchPlanService {
  handlePresentSearchPlan(
    _sessionId: string,
    _plan: SearchPlanProposal,
    _signal: AbortSignal,
    _sendToRenderer: (request: SearchPlanConfirmRequest) => void,
  ): Promise<SearchPlanConfirmResult> {
    return Promise.resolve({ kind: 'cancel' })
  }

  /** 迟到的旧选择不能重新启动工作流。 */
  respondConfirm(_response: SearchPlanConfirmResponse): { sessionId: string } | null {
    return null
  }

  getPendingRequests(): SearchPlanConfirmRequest[] { return [] }
  clearSessionPending(_sessionId: string): void {}
}

export const searchPlanService = new AgentSearchPlanService()
