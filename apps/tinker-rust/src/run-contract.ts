// 离线执行 IPC 的严格边界契约；未验证的原生数据不能进入面板状态。
export type RunScenario = 'success' | 'failure' | 'slow'
export type RunStatus = 'queued' | 'running' | 'waitingInput' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
export interface RunSnapshot {
  protocolVersion: 1
  runId: string
  requestId: string
  providerKind: 'offlineFixture'
  scenario: RunScenario
  input: string
  output: string
  status: RunStatus
  sequence: number
  errorCode: string | null
  recoveryRequired: boolean
}
export interface RunRecord {
  protocolVersion: 1
  runId: string
  sequence: number
  kind: 'started' | 'delta' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
  text: string | null
  errorCode: string | null
}
export interface RunPage {
  protocolVersion: 1
  snapshot: RunSnapshot
  events: RunRecord[]
  nextAfterSequence: number
  hasMore: boolean
}
const statuses: readonly string[] = ['queued', 'running', 'waitingInput', 'completed', 'failed', 'cancelled', 'interrupted']
const kinds: readonly string[] = ['started', 'delta', 'completed', 'failed', 'cancelled', 'interrupted']
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function id(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value) }
function sequence(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 }
function nullableText(value: unknown): value is string | null { return value === null || typeof value === 'string' }
function bytes(value: string): number { return new TextEncoder().encode(value).length }
export function decodeRunSnapshot(value: unknown): RunSnapshot {
  if (!record(value) || value.protocolVersion !== 1 || !id(value.runId) || !id(value.requestId) || value.runId !== value.requestId || value.providerKind !== 'offlineFixture'
    || !['success', 'failure', 'slow'].includes(value.scenario as string) || !statuses.includes(value.status as string)
    || typeof value.input !== 'string' || bytes(value.input) > 65536 || typeof value.output !== 'string' || bytes(value.output) > 256 * 1024
    || !sequence(value.sequence) || !nullableText(value.errorCode) || typeof value.recoveryRequired !== 'boolean') throw 'protocolMismatch'
  return { protocolVersion: 1, runId: value.runId, requestId: value.requestId, providerKind: 'offlineFixture', scenario: value.scenario as RunScenario,
    input: value.input, output: value.output, status: value.status as RunStatus, sequence: value.sequence, errorCode: value.errorCode, recoveryRequired: value.recoveryRequired }
}
export function decodeRunPage(value: unknown, afterSequence = 0): RunPage {
  if (!record(value) || value.protocolVersion !== 1 || !Array.isArray(value.events) || value.events.length > 256
    || !sequence(afterSequence) || !sequence(value.nextAfterSequence) || typeof value.hasMore !== 'boolean') throw 'protocolMismatch'
  const snapshot = decodeRunSnapshot(value.snapshot)
  const events: RunRecord[] = []
  let cursor = afterSequence
  for (const event of value.events) {
    if (!record(event) || event.protocolVersion !== 1 || event.runId !== snapshot.runId || !sequence(event.sequence)
      || event.sequence !== cursor + 1 || event.sequence > snapshot.sequence || !kinds.includes(event.kind as string)
      || !nullableText(event.text) || !nullableText(event.errorCode) || bytes(JSON.stringify(event)) > 16 * 1024) throw 'protocolMismatch'
    if (event.kind === 'delta' ? typeof event.text !== 'string' || event.errorCode !== null : event.text !== null) throw 'protocolMismatch'
    if (['started', 'completed', 'cancelled'].includes(event.kind as string) && event.errorCode !== null) throw 'protocolMismatch'
    events.push({ protocolVersion: 1, runId: event.runId as string, sequence: event.sequence, kind: event.kind as RunRecord['kind'], text: event.text, errorCode: event.errorCode })
    cursor = event.sequence
  }
  if (value.nextAfterSequence !== cursor || cursor > snapshot.sequence || value.hasMore !== (cursor < snapshot.sequence)
    || (value.hasMore && events.length === 0)) throw 'protocolMismatch'
  return { protocolVersion: 1, snapshot, events, nextAfterSequence: cursor, hasMore: value.hasMore }
}
export function isRunActive(snapshot: RunSnapshot | undefined): boolean {
  return snapshot !== undefined && ['queued', 'running', 'waitingInput'].includes(snapshot.status)
}
