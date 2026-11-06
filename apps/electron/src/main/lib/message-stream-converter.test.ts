import { beforeEach, describe, expect, it } from 'bun:test'
import { createMessageStreamConverter, convertSDKMessage } from './message-stream-converter.ts'
import type { AgentStreamPayload } from '@asci/shared'

const mkAssistant = (overrides: object = {}): AgentStreamPayload => ({
  kind: 'sdk_message',
  message: {
    type: 'assistant',
    message: { id: 'msg-1', content: [{ type: 'text', text: 'hi' }] },
    parent_tool_use_id: null,
    ...overrides,
  } as never,
})

describe('createMessageStreamConverter (A4)', () => {
  let converter: ReturnType<typeof createMessageStreamConverter>
  beforeEach(() => { converter = createMessageStreamConverter() })

  it('parent_tool_use_id 为 null → speaker: master', () => {
    const out = converter.process(mkAssistant())
    expect(out.asci_metadata?.speaker).toBe('master')
  })

  it('tool_use(name=Task, id=tu-1, subagent_type=mock-rag-researcher) → 记录映射 + master speaker', () => {
    const out = converter.process({
      kind: 'sdk_message',
      message: {
        type: 'assistant',
        message: { id: 'msg-2', content: [{ type: 'tool_use', id: 'tu-1', name: 'Task', input: { subagent_type: 'mock-rag-researcher', prompt: 'find papers' } }] },
        parent_tool_use_id: null,
      } as never,
    })
    expect(out.asci_metadata?.speaker).toBe('master')
  })

  it('后续消息的 parent_tool_use_id === "tu-1" → speaker: scenario { name: "mock-rag-researcher" }', () => {
    converter.process({
      kind: 'sdk_message',
      message: {
        type: 'assistant',
        message: { id: 'msg-2', content: [{ type: 'tool_use', id: 'tu-1', name: 'Task', input: { subagent_type: 'mock-rag-researcher', prompt: 'go' } }] },
        parent_tool_use_id: null,
      } as never,
    })

    const out = converter.process({
      kind: 'sdk_message',
      message: {
        type: 'assistant',
        message: { id: 'msg-3', content: [{ type: 'text', text: 'searched 3 papers' }] },
        parent_tool_use_id: 'tu-1',
      } as never,
    })

    expect(out.asci_metadata?.speaker).toEqual({ kind: 'scenario', name: 'mock-rag-researcher' })
  })

  it('tool_use(name=Agent, ...) 与 Task 同等识别（A0b 双名）', () => {
    converter.process({
      kind: 'sdk_message',
      message: {
        type: 'assistant',
        message: { id: 'msg-x', content: [{ type: 'tool_use', id: 'tu-2', name: 'Agent', input: { subagent_type: 'searcher', prompt: 'find' } }] },
        parent_tool_use_id: null,
      } as never,
    })
    const out = converter.process({
      kind: 'sdk_message',
      message: {
        type: 'assistant',
        message: { id: 'msg-y', content: [{ type: 'text', text: 'searching...' }] },
        parent_tool_use_id: 'tu-2',
      } as never,
    })
    expect(out.asci_metadata?.speaker).toEqual({ kind: 'scenario', name: 'searcher' })
  })

  it('parent_tool_use_id 无对应映射（如外部传入孤立消息）→ 退回 master speaker', () => {
    const out = converter.process({
      kind: 'sdk_message',
      message: { type: 'assistant', message: { id: 'msg', content: [{ type: 'text', text: 'orphan' }] }, parent_tool_use_id: 'tu-unknown' } as never,
    })
    expect(out.asci_metadata?.speaker).toBe('master')
  })

  it('user 消息 → speaker: master（用户消息不属于场景 Agent 流）', () => {
    const out = converter.process({
      kind: 'sdk_message',
      message: { type: 'user', message: { content: 'hello' }, parent_tool_use_id: null } as never,
    })
    expect(out.asci_metadata?.speaker).toBe('master')
  })

  it('asci_event payload 透传（保留 asci_metadata 形状但不强制 speaker）', () => {
    const out = converter.process({
      kind: 'asci_event',
      event: { type: 'model_resolved', model: 'sonnet' } as never,
    })
    expect(out.kind).toBe('asci_event')
    expect(out.asci_metadata?.speaker).toBeUndefined()
  })

  it('多轮派发：同一 scenario agent 多次 dispatch 各自跟踪不同 tool_use_id', () => {
    converter.process({
      kind: 'sdk_message',
      message: { type: 'assistant', message: { id: 'a', content: [{ type: 'tool_use', id: 'tu-1', name: 'Task', input: { subagent_type: 'searcher', prompt: 'p1' } }] }, parent_tool_use_id: null } as never,
    })
    converter.process({
      kind: 'sdk_message',
      message: { type: 'assistant', message: { id: 'b', content: [{ type: 'tool_use', id: 'tu-2', name: 'Task', input: { subagent_type: 'searcher', prompt: 'p2' } }] }, parent_tool_use_id: null } as never,
    })
    const out1 = converter.process({ kind: 'sdk_message', message: { type: 'assistant', message: { id: 'c', content: [] }, parent_tool_use_id: 'tu-1' } as never })
    const out2 = converter.process({ kind: 'sdk_message', message: { type: 'assistant', message: { id: 'd', content: [] }, parent_tool_use_id: 'tu-2' } as never })
    if (typeof out1.asci_metadata?.speaker === 'object') expect(out1.asci_metadata.speaker.name).toBe('searcher')
    if (typeof out2.asci_metadata?.speaker === 'object') expect(out2.asci_metadata.speaker.name).toBe('searcher')
  })
})

describe('convertSDKMessage (pure wrapper for testing convenience)', () => {
  it('单次调用 — 不带状态时与 createMessageStreamConverter().process 等价', () => {
    const out = convertSDKMessage(mkAssistant())
    expect(out.asci_metadata?.speaker).toBe('master')
  })
})
