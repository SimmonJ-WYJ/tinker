import { describe, expect, test } from 'bun:test'
import { TELEMETRY_EVENTS, TELEMETRY_PROP_ALLOWLIST } from './event-registry.ts'

describe('#710 TELEMETRY_PROP_ALLOWLIST（第三方出口字段白名单）', () => {
  test('每个 TELEMETRY_EVENTS 事件都有 allowlist 条目', () => {
    for (const event of Object.values(TELEMETRY_EVENTS)) {
      expect(Object.prototype.hasOwnProperty.call(TELEMETRY_PROP_ALLOWLIST, event)).toBe(true)
    }
  })

  test('allowlist 仅受控属性名，绝不含 raw query / prompt / path / secret / thinking 字段', () => {
    const a = TELEMETRY_PROP_ALLOWLIST.agent_task_completed
    expect(a).toContain('conversationType')
    expect(a).toContain('totalTokens')
    for (const all of Object.values(TELEMETRY_PROP_ALLOWLIST)) {
      for (const forbidden of ['query', 'prompt', 'toolInput', 'path', 'apiKey', 'token', 'thinking']) {
        expect(all).not.toContain(forbidden)
      }
    }
  })
})
