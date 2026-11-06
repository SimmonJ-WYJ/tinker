import { test, expect } from 'bun:test'
import { inferModelContextWindow, DEFAULT_CONTEXT_WINDOW } from './model-context-window'

test('inferModelContextWindow: 空入参 → 兜底', () => {
  expect(inferModelContextWindow()).toBe(DEFAULT_CONTEXT_WINDOW)
  expect(inferModelContextWindow(null)).toBe(DEFAULT_CONTEXT_WINDOW)
  expect(inferModelContextWindow('')).toBe(DEFAULT_CONTEXT_WINDOW)
})

test('inferModelContextWindow: Claude 1M 家族（4.6 / 4.7）', () => {
  expect(inferModelContextWindow('claude-opus-4-7-20251201')).toBe(1_000_000)
  expect(inferModelContextWindow('claude-opus-4-7')).toBe(1_000_000)
  expect(inferModelContextWindow('claude-opus-4-6-20250929')).toBe(1_000_000)
  expect(inferModelContextWindow('claude-sonnet-4-6-20250929')).toBe(1_000_000)
})

test('inferModelContextWindow: Claude Haiku → 200K', () => {
  expect(inferModelContextWindow('claude-haiku-4-5-20251001')).toBe(200_000)
  expect(inferModelContextWindow('claude-3-5-haiku-latest')).toBe(200_000)
})

test('inferModelContextWindow: Claude 4.5 / 3.x → 200K', () => {
  expect(inferModelContextWindow('claude-opus-4-5-20250929')).toBe(200_000)
  expect(inferModelContextWindow('claude-sonnet-4-5-20250929')).toBe(200_000)
  expect(inferModelContextWindow('claude-3-5-sonnet-20241022')).toBe(200_000)
  expect(inferModelContextWindow('claude-3-opus-20240229')).toBe(200_000)
})

test('inferModelContextWindow: Kimi K2 → 256K', () => {
  expect(inferModelContextWindow('kimi-k2-0905-preview')).toBe(256_000)
  expect(inferModelContextWindow('kimi-k2-turbo-preview')).toBe(256_000)
})

test('inferModelContextWindow: Moonshot 容量后缀', () => {
  expect(inferModelContextWindow('moonshot-v1-128k')).toBe(128_000)
  expect(inferModelContextWindow('moonshot-v1-32k')).toBe(32_000)
  expect(inferModelContextWindow('moonshot-v1-8k')).toBe(8_000)
})

test('inferModelContextWindow: provider 提示用于消歧', () => {
  expect(inferModelContextWindow('custom-model-x', 'kimi')).toBe(200_000)
  expect(inferModelContextWindow('custom-model-x', 'moonshot')).toBe(200_000)
  expect(inferModelContextWindow('custom-model-x', 'deepseek')).toBe(128_000)
  expect(inferModelContextWindow('custom-model-x', 'minimax')).toBe(200_000)
})

test('inferModelContextWindow: DeepSeek → 128K', () => {
  expect(inferModelContextWindow('deepseek-chat')).toBe(128_000)
  expect(inferModelContextWindow('deepseek-reasoner')).toBe(128_000)
  expect(inferModelContextWindow('deepseek-v3.2')).toBe(128_000)
})

test('inferModelContextWindow: MiniMax M1 → 1M、M2 → 200K', () => {
  expect(inferModelContextWindow('MiniMax-M1')).toBe(1_000_000)
  expect(inferModelContextWindow('minimax-m1')).toBe(1_000_000)
  expect(inferModelContextWindow('MiniMax-M2')).toBe(200_000)
  expect(inferModelContextWindow('abab-m2-pro')).toBe(200_000)
})

test('inferModelContextWindow: GLM-4.6 → 200K、GLM-4.5 → 128K', () => {
  expect(inferModelContextWindow('glm-4-6')).toBe(200_000)
  expect(inferModelContextWindow('glm-4.6')).toBe(200_000)
  expect(inferModelContextWindow('glm-4-5')).toBe(128_000)
  expect(inferModelContextWindow('glm-4.5-air')).toBe(128_000)
})

test('inferModelContextWindow: 大小写不敏感', () => {
  expect(inferModelContextWindow('CLAUDE-OPUS-4-7')).toBe(1_000_000)
  expect(inferModelContextWindow('DeepSeek-Chat')).toBe(128_000)
})

test('inferModelContextWindow: 未知模型 → 兜底', () => {
  expect(inferModelContextWindow('some-unknown-model-x1')).toBe(DEFAULT_CONTEXT_WINDOW)
})

// ============================================================
// 用户提供的完整模型清单覆盖
// ============================================================

test('inferModelContextWindow: GPT-5.5 / 5.4 系列', () => {
  expect(inferModelContextWindow('gpt-5.5-thinking')).toBe(1_050_000)
  expect(inferModelContextWindow('gpt-5-5-thinking')).toBe(1_050_000)
  expect(inferModelContextWindow('gpt-5.5-instant')).toBe(128_000)
  expect(inferModelContextWindow('gpt-5-5-instant')).toBe(128_000)
  expect(inferModelContextWindow('gpt-5.4-flagship')).toBe(1_000_000)
  expect(inferModelContextWindow('gpt-5-4-flagship')).toBe(1_000_000)
})

test('inferModelContextWindow: Claude 反向命名（4.7-opus / 4.6-sonnet）', () => {
  expect(inferModelContextWindow('claude-4.7-opus')).toBe(1_000_000)
  expect(inferModelContextWindow('claude-4-7-opus')).toBe(1_000_000)
  expect(inferModelContextWindow('claude-4.6-sonnet')).toBe(1_000_000)
  expect(inferModelContextWindow('claude-4-6-sonnet')).toBe(1_000_000)
})

test('inferModelContextWindow: Gemini 3.1 Pro / 2.5 Flash', () => {
  expect(inferModelContextWindow('gemini-3.1-pro')).toBe(1_000_000)
  expect(inferModelContextWindow('gemini-3-1-pro')).toBe(1_000_000)
  expect(inferModelContextWindow('gemini-2.5-flash')).toBe(1_000_000)
  expect(inferModelContextWindow('gemini-2-5-flash')).toBe(1_000_000)
})

test('inferModelContextWindow: Llama 4 系列', () => {
  expect(inferModelContextWindow('llama-4-scout')).toBe(10_000_000)
  expect(inferModelContextWindow('llama-4-maverick')).toBe(1_000_000)
})

test('inferModelContextWindow: Grok 4.20 Vision → 2M', () => {
  expect(inferModelContextWindow('grok-4.20-vision')).toBe(2_000_000)
  expect(inferModelContextWindow('grok-4-20-vision')).toBe(2_000_000)
})

test('inferModelContextWindow: Qwen 3-coder-480b / 3.6-plus → 1M', () => {
  expect(inferModelContextWindow('qwen-3-coder-480b')).toBe(1_000_000)
  expect(inferModelContextWindow('qwen3-coder-480b')).toBe(1_000_000)
  expect(inferModelContextWindow('qwen-3.6-plus')).toBe(1_000_000)
  expect(inferModelContextWindow('qwen3.6-plus')).toBe(1_000_000)
})

test('inferModelContextWindow: DeepSeek V4 Pro / Flash → 1M', () => {
  expect(inferModelContextWindow('deepseek-v4-pro')).toBe(1_000_000)
  expect(inferModelContextWindow('deepseek-v4-flash')).toBe(1_000_000)
})

test('inferModelContextWindow: DeepSeek R1-Distill → 163840', () => {
  expect(inferModelContextWindow('deepseek-r1-distill')).toBe(163_840)
  expect(inferModelContextWindow('deepseek-r1-distill-7b')).toBe(163_840)
})

test('inferModelContextWindow: Kimi K2.6 Infinite → 2M', () => {
  expect(inferModelContextWindow('kimi-k2.6-infinite')).toBe(2_000_000)
  expect(inferModelContextWindow('kimi-k2-6-infinite')).toBe(2_000_000)
  // 早期 K2 仍命中 256K，证明排序正确
  expect(inferModelContextWindow('kimi-k2-0905-preview')).toBe(256_000)
})

test('inferModelContextWindow: Mistral Large 3 → 128K', () => {
  expect(inferModelContextWindow('mistral-large-3')).toBe(128_000)
  expect(inferModelContextWindow('mistral-large-2407')).toBe(128_000)
})

test('inferModelContextWindow: LTM-2-mini → 100M', () => {
  expect(inferModelContextWindow('ltm-2-mini')).toBe(100_000_000)
})

test('inferModelContextWindow: Cohere Command R v2 → 128K', () => {
  expect(inferModelContextWindow('command-r-v2')).toBe(128_000)
  expect(inferModelContextWindow('command-r-plus')).toBe(128_000)
  expect(inferModelContextWindow('command-r')).toBe(128_000)
})
