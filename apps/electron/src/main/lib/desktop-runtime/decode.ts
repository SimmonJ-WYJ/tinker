/** 对 sidecar 回包逐字段验证；只在完成验证后收窄共享 DTO。 */
import { DESKTOP_RUNTIME_MAX_PAGE_BYTES } from '@asci/shared'
import type { DesktopMethod, DesktopResults } from '@asci/shared'
type Check = (value: unknown) => boolean
const text: Check = v => typeof v === 'string'
const id: Check = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v)
const integer: Check = v => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const bool: Check = v => typeof v === 'boolean'
const one = (...values: unknown[]): Check => v => values.includes(v)
const nullable = (check: Check): Check => v => v === null || check(v)
const array = (check: Check, max = 128): Check => v => Array.isArray(v) && v.length <= max && v.every(check)
function shape(fields: Record<string, Check>): Check {
  return value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const v = value as Record<string, unknown>
    return Object.keys(v).length === Object.keys(fields).length && Object.entries(fields).every(([k, check]) => Object.hasOwn(v, k) && check(v[k]))
  }
}
const effort = one('low', 'medium', 'high', 'max')
const code: Check = v => typeof v === 'string' && /^[a-z][A-Za-z0-9]{0,63}$/.test(v)
const session = shape({ sessionId: id, title: text, profileId: id, workspaceId: nullable(id), pinned: bool, archived: bool, createdAt: integer, updatedAt: integer, deleted: bool })
const turn = shape({ requestId: id, sessionId: id, profileId: id, modelId: text, userMessage: text, startedAt: integer, effort: nullable(effort), runId: id, userMessageId: v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,74}$/.test(v), assistantMessageId: v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,74}$/.test(v), configRevision: id, assistantMessage: text, status: one('queued', 'running', 'completed', 'failed', 'cancelled', 'interrupted'), sequence: integer, errorCode: nullable(code) })
const event = shape({ sessionId: id, requestId: id, runId: id, startedAt: integer, sequence: integer, kind: one('started', 'delta', 'completed', 'failed', 'cancelled', 'interrupted'), text: nullable(text), errorCode: nullable(code) })
const validators: Record<DesktopMethod, Check> = {
  'runtime.describe': shape({ version: one(1), maxFrameBytes: integer, maxPageBytes: integer, maxPending: integer, capabilities: array(text), efforts: array(effort, 4) }),
  'profiles.list': shape({ profiles: array(shape({ profileId: id, label: text, configRevision: id, protocol: one('openai-chat', 'anthropic-messages'), models: array(shape({ modelId: text, label: text, supportedEfforts: array(effort, 4) })) })) }),
  'sessions.list': shape({ sessions: array(session) }),
  'sessions.create': session,
  'sessions.update': session,
  'sessions.delete': shape({ deleted: one(true) }),
  'sessions.history': shape({ turns: array(turn), nextAfter: integer, hasMore: bool }),
  'chat.send': turn,
  'chat.cancel': turn,
  'chat.events': shape({ turn, events: array(event, 256), nextAfterSequence: integer, hasMore: bool }),
}
export function decodeResult<M extends DesktopMethod>(method: M, value: unknown): DesktopResults[M] {
  if ((method==='sessions.history'||method==='chat.events') && Buffer.byteLength(JSON.stringify(value))>DESKTOP_RUNTIME_MAX_PAGE_BYTES) throw new Error('DESKTOP_PROTOCOL')
  if (!validators[method](value)) throw new Error('DESKTOP_PROTOCOL')
  if (method === 'chat.events') {
    const page = value as DesktopResults['chat.events']
    if (page.events.some(e => e.sessionId !== page.turn.sessionId || e.requestId !== page.turn.requestId || e.runId !== page.turn.runId || e.startedAt !== page.turn.startedAt)) throw new Error('DESKTOP_PROTOCOL')
  }
  return value as DesktopResults[M]
}
export function decodeEnvelope(value: unknown): { id: string; result?: unknown; error?: { code: string } } {
  const good = shape({ version: one(1), id, result: () => true })(value)
    || shape({ version: one(1), id, error: shape({ code }) })(value)
  if (!good) throw new Error('DESKTOP_PROTOCOL')
  return value as { id: string; result?: unknown; error?: { code: string } }
}
