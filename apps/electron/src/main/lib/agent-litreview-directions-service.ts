/** 已退役的科研请求兼容接口：立即取消，不派发卡片、不保存挂起 Promise。 */
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

export class AgentLitReviewDirectionsService {
  handlePresentDirections(
    _sessionId: string,
    _directions: LitReviewDirection[],
    _signal: AbortSignal,
    _sendToRenderer: (request: LitReviewPresentDirectionsRequest) => void,
    _options?: { rerollLabel?: string; customLabel?: string; comprehensiveLabel?: string; comprehensiveDescription?: string },
  ): Promise<LitReviewDirectionsResult> {
    return Promise.resolve({ kind: 'cancel' })
  }

  /** 迟到的旧选择不能重新启动工作流。 */
  respondPresentDirections(_response: LitReviewPresentDirectionsResponse): { sessionId: string } | null {
    return null
  }

  getPendingRequests(): LitReviewPresentDirectionsRequest[] { return [] }
  clearSessionPending(_sessionId: string): void {}
}

export const litReviewDirectionsService = new AgentLitReviewDirectionsService()
