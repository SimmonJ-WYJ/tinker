/** 同一持久 turn 同时投影旧消息和正式 SDK renderer 消息，不补造用量。 */
import type { AgentMessage, AgentSessionMeta, DesktopSession, SDKMessage, DesktopTurn } from '@asci/shared'
import { HOST_TURN_STOPPED_SUBTYPE } from '@asci/shared'
import { t } from '../i18n-main.ts'
export function projectSession(s: DesktopSession): AgentSessionMeta {
  return { id: s.sessionId, title: s.title, channelId: s.profileId, workspaceId: s.workspaceId ?? undefined, pinned: s.pinned, archived: s.archived, createdAt: s.createdAt, updatedAt: s.updatedAt }
}
export function projectHistory(turns: DesktopTurn[]): { messages: AgentMessage[]; sdkMessages: SDKMessage[] } {
  const messages: AgentMessage[] = []
  const sdkMessages: SDKMessage[] = []
  for (const turn of turns) {
    messages.push({ id: turn.userMessageId, role: 'user', content: turn.userMessage, createdAt: turn.startedAt })
    const user = { type: 'user' as const, uuid: turn.userMessageId, message: { content: [{ type: 'text' as const, text: turn.userMessage }] }, parent_tool_use_id: null, _createdAt: turn.startedAt }
    sdkMessages.push(user)
    if (turn.status === 'queued' || turn.status === 'running') continue
    const failed = turn.status !== 'completed' && turn.status !== 'cancelled'
    const error = failed ? { message: t('errors.desktopRuntime.failed'), errorType: turn.errorCode ?? 'INTERRUPTED' } : undefined
    messages.push({ id: turn.assistantMessageId, role: 'assistant', content: turn.assistantMessage, createdAt: turn.startedAt, model: turn.modelId })
    const assistant = { type: 'assistant' as const, uuid: turn.assistantMessageId, message: { content: [{ type: 'text' as const, text: turn.assistantMessage }], model: turn.modelId }, parent_tool_use_id: null, _createdAt: turn.startedAt, _channelModelId: turn.modelId, _desktopRuntimeStatus: turn.status, ...(error ? { error } : {}) }
    sdkMessages.push(assistant)
    if(turn.status==='cancelled') sdkMessages.push({type:'system',subtype:HOST_TURN_STOPPED_SUBTYPE,uuid:`${turn.requestId}-stopped`,_createdAt:turn.startedAt})
  }
  return { messages, sdkMessages }
}
