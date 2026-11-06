/**
 * AgentEventBus + speaker 转换中间件集成测试（A4 phase4）
 *
 * 验证：
 * 1. speaker 中间件在 IPC 转发之前注入 asci_metadata.speaker
 * 2. per-session converter 跨 session 隔离（dispatchMap 不串）
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import { AgentEventBus } from './agent-event-bus.ts'
import { createMessageStreamConverter } from './message-stream-converter.ts'
import type { AgentStreamPayload } from '@asci/shared'

describe('AgentEventBus + speaker converter middleware (A4 phase4)', () => {
  let bus: AgentEventBus
  let received: { sid: string; payload: AgentStreamPayload }[]

  beforeEach(() => {
    bus = new AgentEventBus()
    received = []

    // 模拟 agent-service 的接入：per-session converter（跨 session 隔离）
    const convertersBySession = new Map<string, ReturnType<typeof createMessageStreamConverter>>()

    // 中间件 1：speaker 注入（必须在 IPC 转发中间件之前）
    bus.use((sessionId, payload, next) => {
      let converter = convertersBySession.get(sessionId)
      if (!converter) {
        converter = createMessageStreamConverter()
        convertersBySession.set(sessionId, converter)
      }
      const enriched = converter.process(payload)
      next(sessionId, enriched)
    })

    // 中间件 2：模拟 IPC 转发 — 收集富化后的 payload
    bus.use((sessionId, payload, next) => {
      received.push({ sid: sessionId, payload })
      next()
    })
  })

  it('emit sdk_message → handler 收到带 asci_metadata.speaker 的 payload', () => {
    bus.emit('sess-1', {
      kind: 'sdk_message',
      message: {
        type: 'assistant',
        message: { id: 'm1', content: [{ type: 'text', text: 'hi' }] },
        parent_tool_use_id: null,
      } as never,
    })
    expect(received).toHaveLength(1)
    expect(received[0]!.payload.asci_metadata?.speaker).toBe('master')
  })

  it('Master 派发 Task → 后续子 Agent 消息 speaker 正确', () => {
    // Master 派发 Task tool_use
    bus.emit('sess-1', {
      kind: 'sdk_message',
      message: {
        type: 'assistant',
        message: {
          id: 'm2',
          content: [{ type: 'tool_use', id: 'tu-1', name: 'Task', input: { subagent_type: 'mock-researcher', prompt: 'go' } }],
        },
        parent_tool_use_id: null,
      } as never,
    })
    // 子 Agent 回复（parent_tool_use_id 命中 tu-1）
    bus.emit('sess-1', {
      kind: 'sdk_message',
      message: {
        type: 'assistant',
        message: { id: 'm3', content: [{ type: 'text', text: 'found' }] },
        parent_tool_use_id: 'tu-1',
      } as never,
    })

    expect(received).toHaveLength(2)
    expect(received[0]!.payload.asci_metadata?.speaker).toBe('master')
    expect(received[1]!.payload.asci_metadata?.speaker).toEqual({ kind: 'scenario', name: 'mock-researcher' })
  })

  it('跨 session 隔离：sess-1 派发 tu-1，sess-2 的 parent_tool_use_id=tu-1 不命中（master fallback）', () => {
    // sess-1 派发 Task（tu-1 → mock-researcher 进入 sess-1 的 dispatchMap）
    bus.emit('sess-1', {
      kind: 'sdk_message',
      message: {
        type: 'assistant',
        message: {
          id: 'm-1',
          content: [{ type: 'tool_use', id: 'tu-1', name: 'Task', input: { subagent_type: 'mock-researcher', prompt: 'go' } }],
        },
        parent_tool_use_id: null,
      } as never,
    })

    // sess-2 收到 parent_tool_use_id=tu-1（不应命中 sess-1 的 map，应回退到 master）
    bus.emit('sess-2', {
      kind: 'sdk_message',
      message: {
        type: 'assistant',
        message: { id: 'm-2', content: [{ type: 'text', text: 'orphan from another session' }] },
        parent_tool_use_id: 'tu-1',
      } as never,
    })

    const sess2Msg = received.find((r) => r.sid === 'sess-2')
    expect(sess2Msg).toBeDefined()
    // sess-2 的 dispatchMap 没有 tu-1，不会被 sess-1 干扰，退回 master
    expect(sess2Msg!.payload.asci_metadata?.speaker).toBe('master')
  })
})
