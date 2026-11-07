// 只读历史 IPC 的边界解码；未经验证的原生数据不能进入界面状态。
export interface HistoryEntry {
  lineNumber: number
  kind: string
  text: string
  uuid: string | null
  raw: Record<string, unknown>
}
export interface HistoryPage {
  protocolVersion: 1
  entries: HistoryEntry[]
  nextBeforeLine: number | null
  incompleteTail: number | null
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function isLine(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}
export function decodeHistoryPage(value: unknown): HistoryPage {
  if (!isRecord(value) || value.protocolVersion !== 1 || !Array.isArray(value.entries) || value.entries.length > 256) throw 'protocolMismatch'
  const entries: HistoryEntry[] = []
  let lastLine = 0
  for (const item of value.entries) {
    if (!isRecord(item) || !isLine(item.lineNumber) || item.lineNumber <= lastLine || typeof item.kind !== 'string' || item.kind.length === 0 || typeof item.text !== 'string' || (item.uuid !== null && typeof item.uuid !== 'string') || !isRecord(item.raw)) throw 'protocolMismatch'
    entries.push({ lineNumber: item.lineNumber, kind: item.kind, text: item.text, uuid: item.uuid, raw: item.raw })
    lastLine = item.lineNumber
  }
  const { nextBeforeLine, incompleteTail } = value
  if (nextBeforeLine !== null && (!isLine(nextBeforeLine) || entries.length === 0 || nextBeforeLine !== entries[0]?.lineNumber)) throw 'protocolMismatch'
  if (incompleteTail !== null && (!isLine(incompleteTail) || incompleteTail <= lastLine)) throw 'protocolMismatch'
  return { protocolVersion: 1, entries, nextBeforeLine, incompleteTail }
}
