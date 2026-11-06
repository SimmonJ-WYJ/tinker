/**
 * 自进化信号 schema 白名单测试（issue #427）
 *
 * 核心断言：schema 即可采集字段上界——未声明字段被 strip 丢弃，
 * 非法信号整体拒绝（返回 null），红线字段无法混入。
 */
import { describe, expect, test } from 'bun:test'
import { validateSignal, SignalEnvelope } from './telemetry-signals.ts'

describe('validateSignal', () => {
  test('合法信号通过并保留声明字段', () => {
    const signal = validateSignal({
      kind: 'tool_usage',
      ts: 1000,
      sessionId: 'abc',
      toolName: 'Read',
      success: true,
    })
    expect(signal).not.toBeNull()
    expect(signal).toEqual({
      kind: 'tool_usage',
      ts: 1000,
      sessionId: 'abc',
      toolName: 'Read',
      success: true,
    })
  })

  test('未声明字段被 strip 丢弃（白名单语义，红线字段无法混入）', () => {
    const signal = validateSignal({
      kind: 'task_structure',
      ts: 1000,
      promptChars: 42,
      // 以下均为红线字段，必须被丢弃
      promptText: '用户的对话原文',
      email: 'user@example.com',
      filePath: '/Users/alice/papers/secret.pdf',
    })
    expect(signal).not.toBeNull()
    expect(signal).toEqual({ kind: 'task_structure', ts: 1000, promptChars: 42 })
    expect(JSON.stringify(signal)).not.toContain('alice')
  })

  test('未知 kind / 缺必填字段 → 整体拒绝', () => {
    expect(validateSignal({ kind: 'proposal_decision', ts: 1000 })).toBeNull() // Proposal 信号已移出 0.3
    expect(validateSignal({ kind: 'tool_usage', ts: 1000 })).toBeNull() // 缺 toolName
    expect(validateSignal({ kind: 'implicit_feedback', ts: 1000, action: 'invalid' })).toBeNull()
    expect(validateSignal(null)).toBeNull()
  })

  test('error_event 的 message 超长被拒（脱敏截断兜底）', () => {
    expect(
      validateSignal({ kind: 'error_event', ts: 1000, stage: 'agent_run', message: 'x'.repeat(513) }),
    ).toBeNull()
  })

  test('隐式反馈全部动作枚举可用（thumbs 为 0.3 占位）', () => {
    for (const action of ['copy', 'save', 'cite', 'discard', 'thumbs_up', 'thumbs_down', 'retry']) {
      expect(validateSignal({ kind: 'implicit_feedback', ts: 1, action })).not.toBeNull()
    }
  })
})

describe('SignalEnvelope', () => {
  test('封皮校验：deviceId + 信号数组', () => {
    const result = SignalEnvelope.safeParse({
      deviceId: 'device-uuid',
      signals: [{ kind: 'model_choice', ts: 1, modelId: 'claude-sonnet-4-6' }],
    })
    expect(result.success).toBe(true)
  })
})
