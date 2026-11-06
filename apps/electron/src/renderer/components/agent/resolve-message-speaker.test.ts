import { describe, expect, it } from 'bun:test'
import { resolveMessageSpeaker, speakerDisplayName } from './resolve-message-speaker.ts'

describe('resolveMessageSpeaker (A4 phase4)', () => {
  it('metadataSpeaker 优先 — 直接返回', () => {
    expect(resolveMessageSpeaker({ metadataSpeaker: 'master' })).toBe('master')
    expect(resolveMessageSpeaker({ metadataSpeaker: { kind: 'scenario', name: 'mock-researcher' } }))
      .toEqual({ kind: 'scenario', name: 'mock-researcher' })
  })

  it('无 metadataSpeaker 但有 parent_tool_use_id + agentToolIds → fallback 推断 scenario', () => {
    const map = new Map<string, string>([['tu-1', 'searcher']])
    expect(resolveMessageSpeaker({ parentToolUseId: 'tu-1', agentToolIds: map }))
      .toEqual({ kind: 'scenario', name: 'searcher' })
  })

  it('parent_tool_use_id 无对应映射 → master', () => {
    const map = new Map<string, string>([['tu-1', 'searcher']])
    expect(resolveMessageSpeaker({ parentToolUseId: 'tu-unknown', agentToolIds: map })).toBe('master')
  })

  it('parent_tool_use_id 为 null/undefined → master', () => {
    expect(resolveMessageSpeaker({ parentToolUseId: null })).toBe('master')
    expect(resolveMessageSpeaker({})).toBe('master')
  })

  it('metadataSpeaker 缺省时即使有 parent_tool_use_id 也用 fallback', () => {
    const map = new Map<string, string>([['tu-1', 'reader']])
    expect(resolveMessageSpeaker({ parentToolUseId: 'tu-1', agentToolIds: map }))
      .toEqual({ kind: 'scenario', name: 'reader' })
  })

  it('metadataSpeaker 与 fallback 不一致时 — metadataSpeaker 优先（实时流权威）', () => {
    const map = new Map<string, string>([['tu-1', 'searcher']])
    expect(resolveMessageSpeaker({
      metadataSpeaker: { kind: 'scenario', name: 'overridden-name' },
      parentToolUseId: 'tu-1',
      agentToolIds: map,
    })).toEqual({ kind: 'scenario', name: 'overridden-name' })
  })
})

describe('speakerDisplayName', () => {
  it('master 返回 null（不显示标签）', () => {
    expect(speakerDisplayName('master')).toBeNull()
  })

  it('scenario 返回 name 字符串', () => {
    expect(speakerDisplayName({ kind: 'scenario', name: 'mock-researcher' })).toBe('mock-researcher')
    expect(speakerDisplayName({ kind: 'scenario', name: 'searcher', packId: 'pack-1' })).toBe('searcher')
  })
})
