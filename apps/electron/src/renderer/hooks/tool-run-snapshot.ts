/** 工具 run 的纯恢复归并；身份使用显式 run 元数据与完整 ID，绝不按 UUID 前缀删除。 */
import type { PermissionRequest, SDKAssistantMessage, SDKMessage, ToolRunSnapshotEvent } from '@asci/shared'
import type { ToolActivity } from '../atoms/agent-atoms.ts'
export interface ToolSnapshotState {
  messages: SDKMessage[]
  permissions: readonly PermissionRequest[]
  activities: ToolActivity[]
  content: string
  newPermissions?: PermissionRequest[]
}
function blocks(message: SDKMessage): Record<string, unknown>[] {
  const body = (message as Record<string, unknown>).message
  if (!body || typeof body !== 'object' || !('content' in body) || !Array.isArray(body.content)) return []
  return body.content.filter((b: unknown): b is Record<string, unknown> => typeof b === 'object' && b !== null)
}
function messageIdentity(message: SDKMessage): string | undefined {
  const value = message as Record<string, unknown>
  if (typeof value._desktopQueueChainId === 'string' && typeof value._desktopQueueUuid === 'string') return JSON.stringify(['queue',value._desktopQueueChainId,value._desktopQueueUuid])
  return typeof value._desktopRunId === 'string' && value._desktopRunId.length > 0
    && typeof value.uuid === 'string' && value.uuid.length > 0
    ? JSON.stringify([value._desktopRunId, value.uuid]) : undefined
}
export function reconcileToolSnapshot(previous: ToolSnapshotState, run: string, snapshot: ToolRunSnapshotEvent): ToolSnapshotState {
  const toolIds = new Set(Array.from({length:4}, (_, round) => `${run}-tool-${round}`))
  const permissionIds = new Set(Array.from({length:4}, (_, round) => `p-${run}-${round}`))
  // 缺失或冲突身份不能授权破坏性替换，也不从裸 UUID 猜测旧 Electron 消息归属。
  if (!run || snapshot.sdkMessages.some(message => (message as Record<string, unknown>)._desktopRunId !== run || messageIdentity(message) === undefined)) return previous
  if (snapshot.pendingPermissions.some(permission => !permissionIds.has(permission.requestId))) return previous
  // 消息归属正确仍不足以授权修改其他 run 的工具活动；先完整校验再写入。
  if (snapshot.sdkMessages.some(message => blocks(message).some(block => {
    if (block.type === 'tool_use') return typeof block.id !== 'string' || !toolIds.has(block.id)
    if (block.type === 'tool_result') return typeof block.tool_use_id !== 'string' || !toolIds.has(block.tool_use_id)
    return false
  }))) return previous
  const ownedMessages = (m: SDKMessage) => (m as Record<string, unknown>)._desktopRunId === run
  const messages = [...previous.messages.filter(m => !ownedMessages(m)), ...snapshot.sdkMessages]
  const permissions = [...previous.permissions.filter(p => !permissionIds.has(p.requestId)), ...snapshot.pendingPermissions]
  const activities = previous.activities.filter(a => !toolIds.has(a.toolUseId))
  for (const message of snapshot.sdkMessages) {
    for (const b of blocks(message)) {
      if (b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string') {
        activities.push({toolUseId:b.id, toolName:b.name, input:typeof b.input === 'object' && b.input !== null ? b.input as Record<string, unknown> : {}, done:false})
      } else if (b.type === 'tool_result' && typeof b.tool_use_id === 'string') {
        const activity = activities.find(a => a.toolUseId === b.tool_use_id)
        if (activity) { activity.done=true; activity.result=typeof b.content === 'string' ? b.content : ''; activity.isError=b.is_error === true }
      }
    }
  }
  if (JSON.stringify([messages,permissions,activities,snapshot.activeText]) === JSON.stringify([previous.messages,previous.permissions,previous.activities,previous.content])) return previous
  return {messages,permissions,activities,content:snapshot.activeText,newPermissions:snapshot.pendingPermissions.filter(p => !previous.permissions.some(old => old.requestId===p.requestId && old.sessionId===p.sessionId))}
}

/** 恢复与实时流可能包含不同对象的同一消息；仅 formal run 使用稳定身份去重。 */
export function mergeToolRunMessages(persisted: SDKMessage[], live: SDKMessage[]): SDKMessage[] {
  const liveReferences = new Set(live)
  const liveIds = new Set(live.map(messageIdentity).filter((id): id is string => id !== undefined))
  // composer 的乐观人类消息尚无 SDK uuid；只由同请求的正式人类快照替换。
  const confirmedUsers = new Set(live.filter(message => message.type === 'user'
    && messageIdentity(message) !== undefined && blocks(message).some(block => block.type === 'text'))
    .map(message => (message as Record<string, unknown>)._desktopRunId))
  return [...persisted.filter(message => {
    const request = (message as Record<string, unknown>)._agentRequestId
    if (message.type === 'user' && typeof request === 'string' && confirmedUsers.has(request)) return false
    const id = messageIdentity(message)
    return !liveReferences.has(message) && (id === undefined || !liveIds.has(id))
  }), ...live]
}


/** 同一图片调用可以从运行中变为终态；重复快照不能让终态重新运行。 */
export function isImageTaskTerminalUpdate(previous: SDKMessage, next: SDKMessage): boolean {
  if (previous.type !== 'assistant' || next.type !== 'assistant') return false
  const old = previous as SDKAssistantMessage
  const incoming = next as SDKAssistantMessage
  return !!old._desktopImageTaskRequestId && old._desktopImageTaskRequestId === incoming._desktopImageTaskRequestId &&
    !!old.uuid && old.uuid === incoming.uuid && old._desktopImageTaskStatus === 'running' &&
    Boolean(incoming._desktopImageTaskStatus && incoming._desktopImageTaskStatus !== 'running')
}

function taskIdentity(message: SDKMessage, allowOptimistic: boolean): string | undefined {
  const record = message as Record<string, unknown>
  const id = record._desktopImageTaskRequestId ?? record._desktopTextTaskRequestId
  if (typeof id === 'string') return message.type + ':' + id
  if (message.type !== 'user' || typeof record._agentRequestId !== 'string') return
  if (!record.uuid && allowOptimistic) return 'user:' + record._agentRequestId
  if (typeof record.uuid === 'string' && blocks(message).some(block => block.type === 'tool_result')) {
    return JSON.stringify(['result', record._agentRequestId, record.uuid])
  }
}

/** 合并乐观、持久与实时副本，保留同文不同请求和已经确认的终态。 */
export function reconcileNativeTaskMessages(messages: SDKMessage[]): SDKMessage[] {
  const authoritative = new Map<string, SDKMessage>()
  for (const message of messages) {
    const id = taskIdentity(message, false)
    if (!id) continue
    const previous = authoritative.get(id)
    if (!previous || !(previous as Record<string, unknown>)._desktopImageTaskStatus || isImageTaskTerminalUpdate(previous, message)) {
      authoritative.set(id, message)
    }
  }
  if (!authoritative.size) return messages
  const used = new Set<string>()
  const result: SDKMessage[] = []
  for (const message of messages) {
    const identity = taskIdentity(message, true)
    const confirmed = identity && authoritative.get(identity)
    if (identity && confirmed) {
      if (!used.has(identity)) result.push(confirmed)
      used.add(identity)
    } else result.push(message)
  }
  return result
}
