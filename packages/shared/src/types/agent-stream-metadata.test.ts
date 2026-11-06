import { describe, expect, it } from 'bun:test'
import type { AgentStreamPayload, AgentSessionMeta } from './agent.ts'

describe('AgentStreamPayload.asci_metadata (A4 phase4)', () => {
  it('asci_metadata 可选 — 不传也合法（向后兼容现有 payload）', () => {
    const p: AgentStreamPayload = { kind: 'sdk_message', message: { type: 'assistant' } as never }
    expect(p.asci_metadata).toBeUndefined()
  })

  it('speaker === "master" 表示主 Agent', () => {
    const p: AgentStreamPayload = {
      kind: 'sdk_message',
      message: { type: 'assistant' } as never,
      asci_metadata: { speaker: 'master' },
    }
    if (p.kind === 'sdk_message' && p.asci_metadata?.speaker === 'master') {
      expect(true).toBe(true)
    } else throw new Error('expected master speaker')
  })

  it('speaker 为 scenario 对象 — 含 kind / name / packId?', () => {
    const p: AgentStreamPayload = {
      kind: 'sdk_message',
      message: { type: 'assistant' } as never,
      asci_metadata: { speaker: { kind: 'scenario', name: 'mock-rag-researcher', packId: 'mock-rag-pack' } },
    }
    if (p.kind === 'sdk_message' && typeof p.asci_metadata?.speaker === 'object') {
      expect(p.asci_metadata.speaker.kind).toBe('scenario')
      expect(p.asci_metadata.speaker.name).toBe('mock-rag-researcher')
      expect(p.asci_metadata.speaker.packId).toBe('mock-rag-pack')
    } else throw new Error('expected scenario speaker')
  })

  it('asci_event payload 也支持 asci_metadata（同一 schema）', () => {
    const p: AgentStreamPayload = {
      kind: 'asci_event',
      event: { type: 'model_resolved', model: 'sonnet' } as never,
      asci_metadata: { speaker: 'master' },
    }
    expect(p.asci_metadata?.speaker).toBe('master')
  })
})

describe('AgentSessionMeta.stickyCapabilityPackId (A4 phase4)', () => {
  it('stickyCapabilityPackId 是可选字符串字段（向后兼容）', () => {
    const meta: AgentSessionMeta = {
      id: 's', title: 't', createdAt: 0, updatedAt: 0,
    }
    expect(meta.stickyCapabilityPackId).toBeUndefined()
  })

  it('可以设置 stickyCapabilityPackId', () => {
    const meta: AgentSessionMeta = {
      id: 's', title: 't', createdAt: 0, updatedAt: 0,
      stickyCapabilityPackId: 'mock-rag-pack',
    }
    expect(meta.stickyCapabilityPackId).toBe('mock-rag-pack')
  })
})
