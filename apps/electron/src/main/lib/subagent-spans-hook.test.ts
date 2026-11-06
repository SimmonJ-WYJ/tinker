import { beforeEach, describe, expect, it } from 'bun:test'
import { createSubagentSpanHooks, type SpanSink } from './subagent-spans-hook.ts'
import type { SubagentSpan } from '@asci/shared'

describe('createSubagentSpanHooks (A0a)', () => {
  let spans: { name: string; span: SubagentSpan }[]
  let sink: SpanSink

  beforeEach(() => {
    spans = []
    sink = {
      append: (sessionId, span) => { spans.push({ name: sessionId, span }) },
      update: (sessionId, predicate, patch) => {
        const target = spans.find((s) => s.name === sessionId && predicate(s.span))
        if (target) Object.assign(target.span, patch)
      },
    }
  })

  it('SubagentStart 写一条新 span（含 scenarioAgentName + startedAt）', () => {
    const hooks = createSubagentSpanHooks('sess-1', sink)
    hooks.SubagentStart[0].hooks[0]({
      hook_event_name: 'SubagentStart',
      agent_type: 'searcher',
    } as never)
    expect(spans).toHaveLength(1)
    expect(spans[0].span.scenarioAgentName).toBe('searcher')
    expect(spans[0].span.startedAt).toBeGreaterThan(0)
    expect(spans[0].span.finishedAt).toBeUndefined()
  })

  it('SubagentStop 配对最近一条同名未结束 span，回填 finishedAt / success / durationMs', async () => {
    const hooks = createSubagentSpanHooks('sess-1', sink)
    hooks.SubagentStart[0].hooks[0]({
      hook_event_name: 'SubagentStart',
      agent_type: 'reader',
    } as never)
    await new Promise((r) => setTimeout(r, 10))
    hooks.SubagentStop[0].hooks[0]({
      hook_event_name: 'SubagentStop',
      agent_type: 'reader',
      success: true,
    } as never)
    expect(spans[0].span.finishedAt).toBeGreaterThan(spans[0].span.startedAt)
    expect(spans[0].span.success).toBe(true)
    expect(spans[0].span.durationMs).toBeGreaterThan(0)
  })

  it('多次派发同一个 subagent → 多条 span 分别配对（FIFO）', () => {
    const hooks = createSubagentSpanHooks('sess-1', sink)
    const start = hooks.SubagentStart[0].hooks[0]
    const stop = hooks.SubagentStop[0].hooks[0]

    start({ hook_event_name: 'SubagentStart', agent_type: 'searcher' } as never)
    start({ hook_event_name: 'SubagentStart', agent_type: 'searcher' } as never)
    stop({ hook_event_name: 'SubagentStop', agent_type: 'searcher', success: true } as never)
    stop({ hook_event_name: 'SubagentStop', agent_type: 'searcher', success: false } as never)

    expect(spans.filter((s) => s.span.scenarioAgentName === 'searcher')).toHaveLength(2)
    // 第一条配对到第一个 stop（success: true），第二条配对到第二个 stop（success: false）
    expect(spans[0].span.success).toBe(true)
    expect(spans[1].span.success).toBe(false)
  })

  it('兜底：SDK 旧字段 subagent_type 仍能解析（防字段再漂移）', () => {
    const hooks = createSubagentSpanHooks('sess-1', sink)
    hooks.SubagentStart[0].hooks[0]({
      hook_event_name: 'SubagentStart',
      subagent_type: 'searcher',
    } as never)
    expect(spans[0].span.scenarioAgentName).toBe('searcher')
  })
})
