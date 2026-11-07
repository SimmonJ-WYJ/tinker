// IPC v1 保留旧字段；缺少持久化信息的旧后端只能标记为内存模式。
export interface Snapshot {
  protocolVersion: 1
  architecture: string
  draft: string
  storageKind: 'memory' | 'file'
  sessionId?: string
  revision?: number
  recoveryRequired: boolean
}
export function decodeSnapshot(value: unknown): Snapshot {
  if (typeof value !== 'object' || value === null) throw 'protocolMismatch'
  const record = value as Record<string, unknown>
  if (record.protocolVersion !== 1 || typeof record.architecture !== 'string' || typeof record.draft !== 'string') throw 'protocolMismatch'
  const base = { protocolVersion: 1 as const, architecture: record.architecture, draft: record.draft }
  if (record.storageKind === undefined || record.storageKind === 'memory') return { ...base, storageKind: 'memory', recoveryRequired: false }
  if (record.storageKind !== 'file' || typeof record.sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(record.sessionId) || typeof record.revision !== 'number' || !Number.isInteger(record.revision) || record.revision < 0 || record.revision > 0xffffffff || typeof record.recoveryRequired !== 'boolean') throw 'protocolMismatch'
  return { ...base, storageKind: 'file', sessionId: record.sessionId, revision: record.revision, recoveryRequired: record.recoveryRequired }
}
