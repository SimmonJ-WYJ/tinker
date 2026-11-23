import type { Bootstrap } from './protocol'

const statuses = ['queued', 'running', 'waitingInput', 'completed', 'cancelled', 'failed', 'interrupted'] as const
export type TaskStatus = typeof statuses[number]
export type ProjectTaskKind = 'text' | 'imageGenerate' | 'imageEdit'
export interface ProjectTaskStatus {
  kind: ProjectTaskKind
  sessionId: string
  requestId: string
  status: TaskStatus
}
function isStatus(value: unknown): value is TaskStatus {
  return statuses.some(status => status === value)
}
/** 只接受窄元数据；避免把错误的会话身份展示在另一项结果上。 */
export function parseProjectTaskStatuses(value: unknown, requireKind = false): ProjectTaskStatus[] {
  if (!Array.isArray(value)) throw new Error('invalidReply')
  const seen = new Set<string>()
  return value.map((row: unknown) => {
    if (!row || typeof row !== 'object' || !('sessionId' in row) || !('requestId' in row) || !('status' in row)
      || typeof row.sessionId !== 'string' || !row.sessionId || typeof row.requestId !== 'string' || !row.requestId
      || seen.has(row.sessionId) || !isStatus(row.status)) throw new Error('invalidReply')
    // 旧版宿主仅返回文字任务，显式未知类型不能伪装成文字任务。
    if (requireKind && !('kind' in row)) throw new Error('invalidReply')
    const kind = 'kind' in row ? row.kind : 'text'
    if (kind !== 'text' && kind !== 'imageGenerate' && kind !== 'imageEdit') throw new Error('invalidReply')
    seen.add(row.sessionId)
    return { kind, sessionId: row.sessionId, requestId: row.requestId, status: row.status }
  })
}

/** 旧版合成预览已支持此查询，旧版渠道预览只支持会话内的任务状态。 */
export function supportsProjectTaskStatuses(
  bootstrap: Pick<Bootstrap, 'nativeProjectTaskStatuses' | 'nativeTaskLifecycle' | 'credentialedChannels'>,
): boolean {
  return bootstrap.nativeProjectTaskStatuses ?? (bootstrap.nativeTaskLifecycle === true && !bootstrap.credentialedChannels)
}
