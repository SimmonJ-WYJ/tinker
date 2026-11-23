const statuses = ['queued', 'running', 'waitingInput', 'completed', 'cancelled', 'failed', 'interrupted'] as const
export type TaskStatus = typeof statuses[number]
export interface ProjectTaskStatus {
  sessionId: string
  requestId: string
  status: TaskStatus
}
function isStatus(value: unknown): value is TaskStatus {
  return statuses.some(status => status === value)
}
/** 只接受窄元数据；避免把错误的会话身份展示在另一项结果上。 */
export function parseProjectTaskStatuses(value: unknown): ProjectTaskStatus[] {
  if (!Array.isArray(value)) throw new Error('invalidReply')
  const seen = new Set<string>()
  return value.map((row: unknown) => {
    if (!row || typeof row !== 'object' || !('sessionId' in row) || !('requestId' in row) || !('status' in row)
      || typeof row.sessionId !== 'string' || !row.sessionId || typeof row.requestId !== 'string' || !row.requestId
      || seen.has(row.sessionId) || !isStatus(row.status)) throw new Error('invalidReply')
    seen.add(row.sessionId)
    return { sessionId: row.sessionId, requestId: row.requestId, status: row.status }
  })
}
