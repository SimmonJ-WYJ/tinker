import { beforeEach, describe, expect, it } from 'bun:test'
import { createBatchedSpansSink, type SpansSinkStorage } from './agent-orchestrator-spans-sink.ts'
import type { AgentSessionMeta, SubagentSpan } from '@asci/shared'

const mkMeta = (overrides: Partial<AgentSessionMeta> = {}): AgentSessionMeta => ({
  id: 'sess-1', title: 't', createdAt: 0, updatedAt: 0,
  ...overrides,
})

const mkSpan = (overrides: Partial<SubagentSpan> = {}): SubagentSpan => ({
  scenarioAgentName: 'searcher',
  startedAt: 1700000000000,
  ...overrides,
})

describe('createBatchedSpansSink (Phase 2 TODO #3)', () => {
  let writeCalls: { sessionId: string; spans: SubagentSpan[] }[]
  let readBacking: Map<string, AgentSessionMeta>
  let storage: SpansSinkStorage

  beforeEach(() => {
    writeCalls = []
    readBacking = new Map<string, AgentSessionMeta>()
    storage = {
      read: (sessionId) => readBacking.get(sessionId) ?? null,
      write: (sessionId, spans) => {
        writeCalls.push({ sessionId, spans })
        const existing = readBacking.get(sessionId) ?? mkMeta({ id: sessionId })
        readBacking.set(sessionId, { ...existing, subagentSpans: spans })
      },
    }
    readBacking.set('sess-1', mkMeta({ id: 'sess-1' }))
  })

  it('append 写到 cache，不立即触发磁盘 write', () => {
    const sink = createBatchedSpansSink(storage)
    sink.append('sess-1', mkSpan({ scenarioAgentName: 'a' }))
    expect(writeCalls).toHaveLength(0)
    sink.flush()
    expect(writeCalls).toHaveLength(1)
    expect(writeCalls[0].spans.map((s) => s.scenarioAgentName)).toEqual(['a'])
  })

  it('多次 append 在显式 flush 时合并成一次 write', () => {
    const sink = createBatchedSpansSink(storage)
    sink.append('sess-1', mkSpan({ scenarioAgentName: 'a' }))
    sink.append('sess-1', mkSpan({ scenarioAgentName: 'b' }))
    sink.append('sess-1', mkSpan({ scenarioAgentName: 'c' }))
    expect(writeCalls).toHaveLength(0)
    sink.flush()
    expect(writeCalls).toHaveLength(1)
    expect(writeCalls[0].spans.map((s) => s.scenarioAgentName)).toEqual(['a', 'b', 'c'])
  })

  it('update 命中 cache 内的 span 回填字段', () => {
    const sink = createBatchedSpansSink(storage)
    sink.append('sess-1', mkSpan({ scenarioAgentName: 'searcher', startedAt: 100 }))
    sink.update('sess-1', (s) => s.scenarioAgentName === 'searcher', { finishedAt: 200, success: true, durationMs: 100 })
    sink.flush()
    expect(writeCalls[0].spans[0]).toMatchObject({
      scenarioAgentName: 'searcher',
      startedAt: 100,
      finishedAt: 200,
      success: true,
      durationMs: 100,
    })
  })

  it('update 命中已 flush 的 span（cache 已清空）— 走 storage.read + write 路径', () => {
    const sink = createBatchedSpansSink(storage)
    sink.append('sess-1', mkSpan({ scenarioAgentName: 'searcher', startedAt: 100 }))
    sink.flush()
    expect(writeCalls).toHaveLength(1)
    // 此时 cache 已清空；下一次 update 应直接改已落盘的 spans
    sink.update('sess-1', (s) => s.scenarioAgentName === 'searcher', { finishedAt: 200 })
    expect(writeCalls).toHaveLength(2)
    expect(writeCalls[1].spans[0].finishedAt).toBe(200)
  })

  it('flush 完成后 cache 清空 — 第二次 flush 不重复 write 上一批', () => {
    const sink = createBatchedSpansSink(storage)
    sink.append('sess-1', mkSpan({ scenarioAgentName: 'a' }))
    sink.flush()
    sink.flush()  // 空 cache 的 flush 不应再 write
    expect(writeCalls).toHaveLength(1)
  })

  it('append 后等待 debounce 窗口自动 flush', async () => {
    const sink = createBatchedSpansSink(storage)
    sink.append('sess-1', mkSpan({ scenarioAgentName: 'a' }))
    // 等待 600ms （> 默认 debounce 500ms）
    await new Promise((r) => setTimeout(r, 600))
    expect(writeCalls).toHaveLength(1)
  })

  it('storage.read 返回 null（session 不存在）时 flush 跳过该 sessionId', () => {
    const sink = createBatchedSpansSink(storage)
    sink.append('non-existent', mkSpan())
    sink.flush()
    expect(writeCalls.filter((c) => c.sessionId === 'non-existent')).toHaveLength(0)
  })

  it('append 多个 session — flush 一次为每个 sessionId 各 write 一次', () => {
    readBacking.set('sess-2', mkMeta({ id: 'sess-2' }))
    const sink = createBatchedSpansSink(storage)
    sink.append('sess-1', mkSpan({ scenarioAgentName: 'a' }))
    sink.append('sess-2', mkSpan({ scenarioAgentName: 'b' }))
    sink.flush()
    expect(writeCalls).toHaveLength(2)
    expect(writeCalls.map((c) => c.sessionId).sort()).toEqual(['sess-1', 'sess-2'])
  })

  it('flush 与已落盘 spans 合并 — 累加不替换', () => {
    readBacking.set('sess-1', mkMeta({
      id: 'sess-1',
      subagentSpans: [mkSpan({ scenarioAgentName: 'old', startedAt: 50 })],
    }))
    const sink = createBatchedSpansSink(storage)
    sink.append('sess-1', mkSpan({ scenarioAgentName: 'new', startedAt: 100 }))
    sink.flush()
    expect(writeCalls[0].spans.map((s) => s.scenarioAgentName)).toEqual(['old', 'new'])
  })
})
