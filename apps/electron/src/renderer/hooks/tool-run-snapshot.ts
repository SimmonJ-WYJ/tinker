/** 工具 run 的纯恢复归并；身份使用显式 run 元数据与完整 ID，绝不按 UUID 前缀删除。 */
import type { PermissionRequest, SDKMessage, ToolRunSnapshotEvent } from '@asci/shared'
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
export function reconcileToolSnapshot(previous: ToolSnapshotState, run: string, snapshot: ToolRunSnapshotEvent): ToolSnapshotState {
  const uuid = (m: SDKMessage): string | undefined => {
    const value=(m as Record<string, unknown>).uuid
    return typeof value === 'string' ? value : undefined
  }
  const incomingIds = new Set(snapshot.sdkMessages.map(uuid).filter((id): id is string => id !== undefined))
  const ownedMessages = (m: SDKMessage) => (m as Record<string, unknown>)._desktopRunId === run || uuid(m) === `${run}-user` || (uuid(m) !== undefined && incomingIds.has(uuid(m)!))
  const messages = [...previous.messages.filter(m => !ownedMessages(m)), ...snapshot.sdkMessages]
  const toolIds = new Set(Array.from({length:4}, (_, round) => `${run}-tool-${round}`))
  const permissionIds = new Set(Array.from({length:4}, (_, round) => `p-${run}-${round}`))
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
  const identity = (message: SDKMessage): string | undefined => {
    const value = message as Record<string, unknown>
    return typeof value._desktopRunId === 'string' && typeof value.uuid === 'string'
      ? JSON.stringify([value._desktopRunId, value.uuid]) : undefined
  }
  const liveReferences = new Set(live)
  const liveIds = new Set(live.map(identity).filter((id): id is string => id !== undefined))
  return [...persisted.filter(message => {
    const id = identity(message)
    return !liveReferences.has(message) && (id === undefined || !liveIds.has(id))
  }), ...live]
}
