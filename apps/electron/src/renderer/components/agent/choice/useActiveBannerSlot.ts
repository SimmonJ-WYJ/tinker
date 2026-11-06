/**
 * useActiveBannerSlot — 五类 banner 互斥仲裁。
 *
 * 读取 permission / askUser / exitPlan / litReviewDirections / searchPlan 五个 pending
 * atoms，按优先级 Permission > AskUser > ExitPlan > LitReviewDirections > SearchPlan
 * 返回当前 sessionId 应展示的 slot。用于保证同一时间只有一个 banner 挂载（避免多个
 * document keydown listener 互相干扰）。
 *
 * litReviewDirections（spec §5.4 Turn 1）/ searchPlan（issue #435）优先级最低 —— 它们
 * 是任务流程的一部分，不像 permission / askUser 那样阻塞所有进度；同时也允许 ExitPlanMode
 * 优先抢占（用户在 plan 模式下应先决定 plan 是否继续）。二者来自不同能力包，不会并发。
 */

import { useAtomValue } from 'jotai'
import {
  allPendingPermissionRequestsAtom,
  allPendingAskUserRequestsAtom,
  allPendingExitPlanRequestsAtom,
  allPendingLitReviewDirectionsRequestsAtom,
  allPendingSearchPlanRequestsAtom,
} from '@/atoms/agent-atoms'

export type BannerSlot = 'permission' | 'askUser' | 'exitPlan' | 'litReviewDirections' | 'searchPlan' | null

export function useActiveBannerSlot(sessionId: string): BannerSlot {
  const permission = useAtomValue(allPendingPermissionRequestsAtom)
  const askUser = useAtomValue(allPendingAskUserRequestsAtom)
  const exitPlan = useAtomValue(allPendingExitPlanRequestsAtom)
  const litReviewDirections = useAtomValue(allPendingLitReviewDirectionsRequestsAtom)
  const searchPlan = useAtomValue(allPendingSearchPlanRequestsAtom)

  if ((permission.get(sessionId)?.length ?? 0) > 0) return 'permission'
  if ((askUser.get(sessionId)?.length ?? 0) > 0) return 'askUser'
  if ((exitPlan.get(sessionId)?.length ?? 0) > 0) return 'exitPlan'
  // searchPlan 与 litReviewDirections 同属任务流程内确认，优先级最低；二者来自不同能力包不会并发
  if ((litReviewDirections.get(sessionId)?.length ?? 0) > 0) return 'litReviewDirections'
  if ((searchPlan.get(sessionId)?.length ?? 0) > 0) return 'searchPlan'
  return null
}
