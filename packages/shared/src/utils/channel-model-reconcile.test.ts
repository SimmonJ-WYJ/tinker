import { describe, expect, it } from 'bun:test'
import type { Channel } from '../types/channel'
import {
  isModelEnabledInChannel,
  pickFallbackModel,
  reconcileActiveModel,
  isClaudeFamilyEnabled,
  hasAnyEnabledClaudeModel,
} from './channel-model-reconcile'

function makeChannel(models: Array<{ id: string; name: string; enabled: boolean }>): Channel {
  return {
    id: 'ch-1',
    name: 'My Channel',
    provider: 'anthropic',
    baseUrl: 'https://api.example.com',
    apiKey: 'encrypted',
    models,
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
  }
}

describe('isModelEnabledInChannel', () => {
  const channel = makeChannel([
    { id: 'a', name: 'A', enabled: true },
    { id: 'b', name: 'B', enabled: false },
  ])

  it('returns false when channel or modelId is null/undefined', () => {
    expect(isModelEnabledInChannel(null, 'a')).toBe(false)
    expect(isModelEnabledInChannel(channel, null)).toBe(false)
    expect(isModelEnabledInChannel(channel, undefined)).toBe(false)
  })

  it('returns true only when model exists and is enabled', () => {
    expect(isModelEnabledInChannel(channel, 'a')).toBe(true)
    expect(isModelEnabledInChannel(channel, 'b')).toBe(false)
    expect(isModelEnabledInChannel(channel, 'missing')).toBe(false)
  })
})

describe('pickFallbackModel', () => {
  it('returns the first enabled model', () => {
    const channel = makeChannel([
      { id: 'a', name: 'A', enabled: false },
      { id: 'b', name: 'B', enabled: true },
      { id: 'c', name: 'C', enabled: true },
    ])
    expect(pickFallbackModel(channel)).toEqual({ id: 'b', name: 'B' })
  })

  it('returns null when no enabled model exists', () => {
    expect(pickFallbackModel(makeChannel([{ id: 'a', name: 'A', enabled: false }]))).toBeNull()
    expect(pickFallbackModel(null)).toBeNull()
    expect(pickFallbackModel(undefined)).toBeNull()
  })
})

describe('reconcileActiveModel', () => {
  it('returns null result when channel is missing', () => {
    expect(reconcileActiveModel(null, 'x')).toEqual({
      valid: false,
      changed: true,
      modelId: null,
      modelName: null,
    })
    expect(reconcileActiveModel(null, null)).toEqual({
      valid: false,
      changed: false,
      modelId: null,
      modelName: null,
    })
  })

  it('keeps modelId unchanged when it is enabled in channel', () => {
    const channel = makeChannel([{ id: 'a', name: 'Alpha', enabled: true }])
    expect(reconcileActiveModel(channel, 'a')).toEqual({
      valid: true,
      changed: false,
      modelId: 'a',
      modelName: 'Alpha',
    })
  })

  it('falls back to first enabled model when current modelId is disabled', () => {
    const channel = makeChannel([
      { id: 'old', name: 'Old', enabled: false },
      { id: 'new', name: 'New', enabled: true },
    ])
    expect(reconcileActiveModel(channel, 'old')).toEqual({
      valid: true,
      changed: true,
      modelId: 'new',
      modelName: 'New',
    })
  })

  it('falls back when modelId is no longer present in channel.models', () => {
    const channel = makeChannel([{ id: 'new', name: 'New', enabled: true }])
    expect(reconcileActiveModel(channel, 'kimi-for-coding')).toEqual({
      valid: true,
      changed: true,
      modelId: 'new',
      modelName: 'New',
    })
  })

  it('returns invalid when channel has no enabled models', () => {
    const channel = makeChannel([
      { id: 'a', name: 'A', enabled: false },
      { id: 'b', name: 'B', enabled: false },
    ])
    expect(reconcileActiveModel(channel, 'a')).toEqual({
      valid: false,
      changed: true,
      modelId: null,
      modelName: null,
    })
  })

  it('picks fallback even when modelId is null', () => {
    const channel = makeChannel([{ id: 'a', name: 'Alpha', enabled: true }])
    expect(reconcileActiveModel(channel, null)).toEqual({
      valid: true,
      changed: true,
      modelId: 'a',
      modelName: 'Alpha',
    })
  })
})

describe('isClaudeFamilyEnabled', () => {
  it('matches an enabled concrete id whose id contains the family word', () => {
    const channel = makeChannel([
      { id: 'claude-sonnet-4-5-20250929', name: 'Sonnet', enabled: true },
      { id: 'claude-3-opus-20240229', name: 'Opus', enabled: true },
    ])
    expect(isClaudeFamilyEnabled(channel, 'sonnet')).toBe(true)
    expect(isClaudeFamilyEnabled(channel, 'opus')).toBe(true)
    expect(isClaudeFamilyEnabled(channel, 'haiku')).toBe(false)
  })

  it('disabled model of the family does not count', () => {
    const channel = makeChannel([
      { id: 'claude-haiku-4-5-20251001', name: 'Haiku', enabled: false },
      { id: 'claude-sonnet-4-5-20250929', name: 'Sonnet', enabled: true },
    ])
    expect(isClaudeFamilyEnabled(channel, 'haiku')).toBe(false)
    expect(isClaudeFamilyEnabled(channel, 'sonnet')).toBe(true)
  })

  it('returns false for null/empty channel', () => {
    expect(isClaudeFamilyEnabled(null, 'sonnet')).toBe(false)
    expect(isClaudeFamilyEnabled(makeChannel([]), 'sonnet')).toBe(false)
  })
})

describe('hasAnyEnabledClaudeModel', () => {
  it('true when any enabled model id contains claude', () => {
    expect(hasAnyEnabledClaudeModel(makeChannel([
      { id: 'deepseek-v4', name: 'DS', enabled: true },
      { id: 'claude-sonnet-4-5-20250929', name: 'Sonnet', enabled: true },
    ]))).toBe(true)
  })

  it('false when all claude models disabled or none present', () => {
    expect(hasAnyEnabledClaudeModel(makeChannel([
      { id: 'claude-sonnet-4-5-20250929', name: 'Sonnet', enabled: false },
    ]))).toBe(false)
    expect(hasAnyEnabledClaudeModel(makeChannel([
      { id: 'deepseek-v4', name: 'DS', enabled: true },
    ]))).toBe(false)
    expect(hasAnyEnabledClaudeModel(null)).toBe(false)
  })
})

it('生图渠道不会被当作聊天模型或聊天回退模型', () => {
 const channel = {...makeChannel([{id:'gpt-image-2-o',name:'Image',enabled:true}]),provider:'custom-image' as const}
 expect(isModelEnabledInChannel(channel,'gpt-image-2-o')).toBe(false)
 expect(pickFallbackModel(channel)).toBeNull()
 expect(reconcileActiveModel(channel,'gpt-image-2-o').valid).toBe(false)
})
