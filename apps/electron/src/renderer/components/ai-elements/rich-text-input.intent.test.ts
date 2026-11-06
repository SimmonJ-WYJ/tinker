import { describe, it, expect } from 'bun:test'
import { resolveSendIntent } from './rich-text-input.tsx'

const mods = (o: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }>) => ({
  metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...o,
})

describe('resolveSendIntent — 默认模式（Enter 发送）', () => {
  it('Enter → 发送、不打断', () => {
    expect(resolveSendIntent(mods({}), false)).toEqual({ isSend: true, interrupt: false })
  })
  it('⌥+Enter → 发送、打断', () => {
    expect(resolveSendIntent(mods({ altKey: true }), false)).toEqual({ isSend: true, interrupt: true })
  })
  it('Shift+Enter → 不发送（换行）', () => {
    expect(resolveSendIntent(mods({ shiftKey: true }), false)).toEqual({ isSend: false, interrupt: false })
  })
  it('⌘+Enter → 不发送（默认模式下为换行）', () => {
    expect(resolveSendIntent(mods({ metaKey: true }), false)).toEqual({ isSend: false, interrupt: false })
  })
})

describe('resolveSendIntent — ⌘+Enter 发送模式', () => {
  it('⌘+Enter → 发送、不打断', () => {
    expect(resolveSendIntent(mods({ metaKey: true }), true)).toEqual({ isSend: true, interrupt: false })
  })
  it('⌘+⌥+Enter → 发送、打断', () => {
    expect(resolveSendIntent(mods({ metaKey: true, altKey: true }), true)).toEqual({ isSend: true, interrupt: true })
  })
  it('Enter → 不发送（该模式下为换行）', () => {
    expect(resolveSendIntent(mods({}), true)).toEqual({ isSend: false, interrupt: false })
  })
  it('Ctrl+Enter（Win/Linux）→ 发送', () => {
    expect(resolveSendIntent(mods({ ctrlKey: true }), true)).toEqual({ isSend: true, interrupt: false })
  })
})
