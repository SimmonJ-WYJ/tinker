import { describe, expect, it } from 'bun:test'
import { PLAN_MODE_ALLOWED_TOOLS } from './agent-allowed-tools.ts'

describe('PLAN_MODE_ALLOWED_TOOLS - 派发语义位点双名兼容（A0b）', () => {
  it('同时包含 "Task" 与 "Agent"（兼容 SDK v2.1.63 前后版本）', () => {
    expect(PLAN_MODE_ALLOWED_TOOLS.has('Task')).toBe(true)
    expect(PLAN_MODE_ALLOWED_TOOLS.has('Agent')).toBe(true)
  })
})
