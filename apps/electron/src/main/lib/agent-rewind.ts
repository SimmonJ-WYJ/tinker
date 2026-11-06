/**
 * 会话快照回退主体
 *
 * 抽出自 AgentOrchestrator.rewindSession：
 * 1. 直接从 SDK JSONL 的 file-history-snapshot 恢复文件到目标时刻的状态
 * 2. 截断 ASCI JSONL 到 assistantMessageUuid（inclusive）
 * 3. 记录 resumeAtMessageUuid，下次发消息时 SDK 从该点分支继续
 *
 * 不依赖 electron / SDK 运行时，方便用 tmpHome fixture 单测。
 * 并发保护（拒绝运行中会话回退）由调用方负责。
 */

import { homedir } from 'node:os'
import { errMsg } from '@asci/shared'
import type { RewindSessionResult } from '@asci/shared'
import {
  getAgentSessionMeta,
  resolveUserUuidFromSDK,
  rewindFilesFromSnapshot,
  truncateSDKMessages,
  updateAgentSessionMeta,
  assistantUuidExistsInSdkJsonl,
} from './agent-session-manager'
import { evaluateRewindGuard } from './agent-rewind-guard'
import { discardFeedbackForRemovedMessages } from './output-feedback-service'
import { getAgentWorkspace, getWorkspaceAttachedDirectories } from './agent-workspace-manager'
import { getAgentSessionWorkspacePath, getWorkspaceFilesDir } from './config-paths'

export async function executeRewind(
  sessionId: string,
  assistantMessageUuid: string,
): Promise<RewindSessionResult> {
  const sessionMeta = getAgentSessionMeta(sessionId)
  if (!sessionMeta?.sdkSessionId) {
    throw new Error('会话没有 SDK session ID，无法回退')
  }

  // 0.4 入口预检：判断目标 uuid 是否仍能被 SDK 的 resumeSessionAt 接受
  const hasForkSource = !!sessionMeta.forkSourceSdkSessionId
  const targetInCurrentJsonl = assistantUuidExistsInSdkJsonl(sessionMeta.sdkSessionId, assistantMessageUuid)
  const targetInForkSourceJsonl = hasForkSource
    ? assistantUuidExistsInSdkJsonl(sessionMeta.forkSourceSdkSessionId!, assistantMessageUuid)
    : false
  const guard = evaluateRewindGuard({ hasForkSource, targetInCurrentJsonl, targetInForkSourceJsonl })
  if (guard.blocked) {
    console.warn(`[Agent 回退] 被阻断: reason=${guard.blocked.reason}, details=${guard.blocked.details ?? ''}`)
    return {
      remainingMessages: 0,
      blocked: guard.blocked,
    }
  }

  // 0.5 从 SDK session JSONL 解析对应的 user message UUID（rewindFiles 需要）
  let projectDir: string | undefined
  let workspaceSlug: string | undefined
  if (sessionMeta.workspaceId) {
    const ws = getAgentWorkspace(sessionMeta.workspaceId)
    if (ws) {
      workspaceSlug = ws.slug
      projectDir = getAgentSessionWorkspacePath(ws.slug, sessionMeta.id)
    }
  }
  const userMessageUuid = resolveUserUuidFromSDK(sessionMeta.sdkSessionId, assistantMessageUuid, projectDir, sessionMeta.forkSourceSdkSessionId)
  console.log(`[Agent 回退] 解析 user uuid=${userMessageUuid || '未找到'} (assistant uuid=${assistantMessageUuid}, forkSource=${sessionMeta.forkSourceSdkSessionId ?? 'none'})`)

  // 1. 文件恢复
  let fileRewindResult: { canRewind: boolean; error?: string; filesChanged?: string[]; insertions?: number; deletions?: number } | undefined
  if (userMessageUuid === '__LAST_TURN__') {
    console.log(`[Agent 回退] 最后一个 turn，跳过文件恢复`)
    fileRewindResult = { canRewind: true, filesChanged: [] }
  } else if (userMessageUuid) {
    try {
      let cwd = homedir()
      if (projectDir) cwd = projectDir
      const rewindAttachedDirs: string[] = []
      if (workspaceSlug) {
        rewindAttachedDirs.push(...getWorkspaceAttachedDirectories(workspaceSlug))
        rewindAttachedDirs.push(getWorkspaceFilesDir(workspaceSlug))
      }
      console.log(`[Agent 回退] 直接从 snapshot 恢复文件 (cwd=${cwd}, forkSource=${sessionMeta.forkSourceSdkSessionId ?? 'none'}, attachedDirs=${rewindAttachedDirs.length})`)
      fileRewindResult = rewindFilesFromSnapshot(sessionMeta.sdkSessionId, userMessageUuid, cwd, projectDir, sessionMeta.forkSourceSdkSessionId, rewindAttachedDirs)
    } catch (err) {
      const msg = errMsg(err)
      console.warn('[Agent 回退] 文件恢复失败，继续截断对话:', msg)
      if (err instanceof Error && err.stack) console.warn('[Agent 回退] 文件恢复错误堆栈:', err.stack)
      fileRewindResult = { canRewind: false, error: msg }
    }
  } else {
    fileRewindResult = { canRewind: false, error: '无法从 SDK session 中解析 user message UUID' }
  }

  // 2. 截断 ASCI JSONL
  const kept = truncateSDKMessages(sessionId, assistantMessageUuid)

  // 2.1 废弃被截断回答的 👍/👎 反馈（issue #477）：保留 kept 内的，其余追加 'none' 墓碑抹掉。
  // 失败不阻断回退（反馈是次要数据，回退是关键路径）。
  try {
    const keptUuids = new Set<string>()
    for (const m of kept) {
      const uuid = (m as { uuid?: string }).uuid
      if (typeof uuid === 'string') keptUuids.add(uuid)
    }
    const discarded = discardFeedbackForRemovedMessages(sessionId, keptUuids)
    if (discarded > 0) console.log(`[Agent 回退] 已废弃 ${discarded} 条被截断回答的反馈`)
  } catch (err) {
    console.warn('[Agent 回退] 废弃反馈失败（不阻断回退）:', errMsg(err))
  }

  // 3. 记录 resumeAtMessageUuid，下次发消息时 SDK 从此点继续
  updateAgentSessionMeta(sessionId, { resumeAtMessageUuid: assistantMessageUuid })

  console.log(`[Agent 回退] 完成: sessionId=${sessionId}, 保留 ${kept.length} 条消息, 文件恢复=${fileRewindResult?.canRewind ?? '跳过'}`)

  return {
    remainingMessages: kept.length,
    fileRewind: fileRewindResult,
  }
}
