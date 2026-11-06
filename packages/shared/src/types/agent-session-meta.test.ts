import { describe, expect, it } from 'bun:test'
import type { AgentSessionMeta, SubagentSpan } from './agent.ts'

describe('AgentSessionMeta.subagentSpans (A0a)', () => {
  it('SubagentSpan 有必需字段', () => {
    const span: SubagentSpan = {
      scenarioAgentName: 'searcher',
      startedAt: 1700000000000,
      finishedAt: 1700000005000,
      success: true,
      durationMs: 5000,
    }
    expect(span.scenarioAgentName).toBe('searcher')
  })

  it('SubagentSpan 的 packId 可选', () => {
    const span: SubagentSpan = {
      scenarioAgentName: 'mock-x',
      startedAt: 1700000000000,
      packId: 'pack-1',
    }
    expect(span.packId).toBe('pack-1')
  })

  it('AgentSessionMeta.subagentSpans 是可选字段（向后兼容旧 meta 文件）', () => {
    const meta: AgentSessionMeta = {
      id: 's', title: 't', createdAt: 0, updatedAt: 0,
    }
    expect(meta.subagentSpans).toBeUndefined()
  })

  it('可以挂多条 span', () => {
    const meta: AgentSessionMeta = {
      id: 's', title: 't', createdAt: 0, updatedAt: 0,
      subagentSpans: [
        { scenarioAgentName: 'searcher', startedAt: 1, finishedAt: 2, success: true, durationMs: 1 },
        { scenarioAgentName: 'reader', startedAt: 3 },
      ],
    }
    expect(meta.subagentSpans).toHaveLength(2)
  })
})
