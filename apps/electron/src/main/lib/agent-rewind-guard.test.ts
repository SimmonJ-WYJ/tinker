/**
 * agent-rewind-guard 单元测试
 *
 * guard 输入完全是查询结果布尔值，无 I/O；测试只关心判断矩阵。
 */

import { test, expect } from 'bun:test'
import { evaluateRewindGuard } from './agent-rewind-guard'

test('happy path：单会话目标 uuid 在当前 SDK JSONL → 不阻断', () => {
  const r = evaluateRewindGuard({
    hasForkSource: false,
    targetInCurrentJsonl: true,
    targetInForkSourceJsonl: false,
  })
  expect(r.blocked).toBeUndefined()
})

test('fork-pre-fork：fork 会话 + 目标只在源 JSONL → 阻断', () => {
  const r = evaluateRewindGuard({
    hasForkSource: true,
    targetInCurrentJsonl: false,
    targetInForkSourceJsonl: true,
  })
  expect(r.blocked?.reason).toBe('fork-pre-fork')
})

test('fork 会话但目标在 fork JSONL 内 → 不阻断（fork 后产生的消息）', () => {
  const r = evaluateRewindGuard({
    hasForkSource: true,
    targetInCurrentJsonl: true,
    targetInForkSourceJsonl: false,
  })
  expect(r.blocked).toBeUndefined()
})

test('post-recovery：非 fork 会话 + 目标既不在当前也不在源 → 阻断 post-recovery', () => {
  const r = evaluateRewindGuard({
    hasForkSource: false,
    targetInCurrentJsonl: false,
    targetInForkSourceJsonl: false,
  })
  expect(r.blocked?.reason).toBe('post-recovery')
})

test('fork 会话 + 目标既不在 fork JSONL 也不在源 JSONL → 仍按 post-recovery 处理', () => {
  const r = evaluateRewindGuard({
    hasForkSource: true,
    targetInCurrentJsonl: false,
    targetInForkSourceJsonl: false,
  })
  expect(r.blocked?.reason).toBe('post-recovery')
})
