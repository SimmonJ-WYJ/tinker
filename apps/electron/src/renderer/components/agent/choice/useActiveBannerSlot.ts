/** 通用确认 banner 互斥仲裁：权限、用户问题、计划审批；旧科研请求不占活动位。 */
import { useAtomValue } from 'jotai'
import {
  allPendingPermissionRequestsAtom,
  allPendingAskUserRequestsAtom,
  allPendingExitPlanRequestsAtom,
} from '@/atoms/agent-atoms'

export type BannerSlot = 'permission' | 'askUser' | 'exitPlan' | null

export function useActiveBannerSlot(sessionId: string): BannerSlot {
  const permission = useAtomValue(allPendingPermissionRequestsAtom)
  const askUser = useAtomValue(allPendingAskUserRequestsAtom)
  const exitPlan = useAtomValue(allPendingExitPlanRequestsAtom)

  if ((permission.get(sessionId)?.length ?? 0) > 0) return 'permission'
  if ((askUser.get(sessionId)?.length ?? 0) > 0) return 'askUser'
  if ((exitPlan.get(sessionId)?.length ?? 0) > 0) return 'exitPlan'
  return null
}
