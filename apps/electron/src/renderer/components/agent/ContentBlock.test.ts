import { test, expect, describe } from 'bun:test'
import type { TFunction } from 'i18next'
import { formatThinkingLabel } from './ContentBlock'

// 伪 t：按 key 返回固定英文文案，便于断言纯函数分支逻辑（与 i18n 解耦）
const fakeT = ((key: string, opts?: { duration?: number }): string => {
  switch (key) {
    case 'agent.messages.thinkingStreaming':
      return 'Thinking...'
    case 'agent.messages.thinking':
      return 'Thinking'
    case 'agent.messages.thinkingWithDuration':
      return `Thinking · ${opts?.duration}s`
    default:
      return key
  }
}) as unknown as TFunction<'conversation'>

describe('formatThinkingLabel', () => {
  test('流式中返回 Thinking... 且带脉冲', () => {
    expect(formatThinkingLabel(true, undefined, fakeT)).toEqual({ text: 'Thinking...', pulse: true })
    expect(formatThinkingLabel(true, 5, fakeT)).toEqual({ text: 'Thinking...', pulse: true })
  })

  test('流式结束且无 duration 返回纯 Thinking', () => {
    expect(formatThinkingLabel(false, undefined, fakeT)).toEqual({ text: 'Thinking', pulse: false })
  })

  test('duration 为 0 时不拼接秒数', () => {
    expect(formatThinkingLabel(false, 0, fakeT)).toEqual({ text: 'Thinking', pulse: false })
  })

  test('duration > 0 时拼接 · Ns 格式（无空格）', () => {
    expect(formatThinkingLabel(false, 1, fakeT)).toEqual({ text: 'Thinking · 1s', pulse: false })
    expect(formatThinkingLabel(false, 3, fakeT)).toEqual({ text: 'Thinking · 3s', pulse: false })
    expect(formatThinkingLabel(false, 12, fakeT)).toEqual({ text: 'Thinking · 12s', pulse: false })
  })
})
