import { describe, expect, it } from 'bun:test'
import { detectIntentSwitch } from './detect-intent-switch.ts'

describe('detectIntentSwitch (A4 phase4 启发式)', () => {
  it('中文 "切换到 X" → shouldClearSticky: true', () => {
    expect(detectIntentSwitch('切换到 RAG 综述包').shouldClearSticky).toBe(true)
  })

  it('中文 "改用 X" → true', () => {
    expect(detectIntentSwitch('改用 X 包').shouldClearSticky).toBe(true)
  })

  it('中文 "关闭 X" → true', () => {
    expect(detectIntentSwitch('关闭 RAG 包').shouldClearSticky).toBe(true)
  })

  it('英文 "switch to" → true', () => {
    expect(detectIntentSwitch('please switch to the writing pack').shouldClearSticky).toBe(true)
  })

  it('英文 "stop using" → true', () => {
    expect(detectIntentSwitch('stop using the RAG pack').shouldClearSticky).toBe(true)
  })

  it('普通继续问 "再找 3 篇" → shouldClearSticky: false', () => {
    expect(detectIntentSwitch('再找 3 篇').shouldClearSticky).toBe(false)
  })

  it('英文继续问 "find more papers" → false', () => {
    expect(detectIntentSwitch('find more papers about RAG').shouldClearSticky).toBe(false)
  })

  it('空消息 → false（不触发清空）', () => {
    expect(detectIntentSwitch('').shouldClearSticky).toBe(false)
  })

  it('返回值同时含 matchedRule 便于调试', () => {
    const r = detectIntentSwitch('切换到 X')
    expect(r.shouldClearSticky).toBe(true)
    expect(r.matchedRule).toBeTruthy()
  })
})
