import { test, expect, describe } from 'bun:test'
import { getAdapter, AnthropicAdapter } from './index.ts'

describe('getAdapter', () => {
  test('返回 anthropic 适配器（基线）', () => {
    const adapter = getAdapter('anthropic')
    expect(adapter).toBeInstanceOf(AnthropicAdapter)
  })

  test('返回 minimax 适配器（基线）', () => {
    const adapter = getAdapter('minimax')
    expect(adapter).toBeInstanceOf(AnthropicAdapter)
  })

  test('返回 kimi 适配器（复用 AnthropicAdapter）', () => {
    const adapter = getAdapter('kimi')
    expect(adapter).toBeInstanceOf(AnthropicAdapter)
  })

  test('返回 moonshot 适配器（复用 AnthropicAdapter）', () => {
    const adapter = getAdapter('moonshot')
    expect(adapter).toBeInstanceOf(AnthropicAdapter)
  })

  test('返回 deepseek 适配器（复用 AnthropicAdapter）', () => {
    const adapter = getAdapter('deepseek')
    expect(adapter).toBeInstanceOf(AnthropicAdapter)
  })

  test('返回 openrouter 适配器（复用 AnthropicAdapter，Anthropic Skin 协议兼容）', () => {
    const adapter = getAdapter('openrouter')
    expect(adapter).toBeInstanceOf(AnthropicAdapter)
  })

  test('未注册的供应商抛出明确错误', () => {
    // @ts-expect-error 故意传入不在 ProviderType 里的值，验证抛错路径
    expect(() => getAdapter('nonexistent')).toThrow(/不支持的供应商/)
  })
})
