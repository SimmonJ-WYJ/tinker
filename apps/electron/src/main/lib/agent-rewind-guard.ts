/**
 * 会话回退入口预检
 *
 * 在动 ASCI JSONL / 写 resumeAtMessageUuid 之前判断：本次回退点是否仍能被 SDK 的
 * resumeSessionAt 接受。若不能（fork-pre-fork / post-recovery）就返回 blocked，
 * 让上层把决定交回给用户，而不是让会话进入半截断的坏状态。
 *
 * 函数零 I/O —— 调用方负责把"目标 uuid 是否存在于某 JSONL"查清楚后传进来。
 */

import type { RewindBlockedResult } from '@asci/shared'

export interface RewindGuardInput {
  /** 当前会话是 fork 出来的（sessionMeta.forkSourceSdkSessionId 存在） */
  hasForkSource: boolean
  /** 目标 assistant uuid 是否存在于当前 sdkSessionId 的 SDK JSONL */
  targetInCurrentJsonl: boolean
  /** 目标 assistant uuid 是否存在于 forkSourceSdkSessionId 的 SDK JSONL（无 fork 源时传 false） */
  targetInForkSourceJsonl: boolean
}

export interface RewindGuardResult {
  blocked?: RewindBlockedResult
}

export function evaluateRewindGuard(input: RewindGuardInput): RewindGuardResult {
  if (input.targetInCurrentJsonl) {
    return {}
  }
  if (input.hasForkSource && input.targetInForkSourceJsonl) {
    return {
      blocked: {
        reason: 'fork-pre-fork',
        details: '回退点位于 fork 之前的源会话，当前 fork SDK JSONL 找不到对应 uuid',
      },
    }
  }
  return {
    blocked: {
      reason: 'post-recovery',
      details: '当前 SDK 会话已不包含该回退点（可能在 session-not-found 恢复中被替换）',
    },
  }
}
