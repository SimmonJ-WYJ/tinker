/**
 * conversation-turns-service：Q&A 回合分组纯函数 buildTurnsFromMessages 行为
 */
import { describe, expect, it } from 'bun:test'
import type { SDKMessage } from '@asci/shared'
import { buildTurnsFromMessages } from './conversation-turns-service.ts'

function user(uuid: string, text: string): SDKMessage {
  return {
    type: 'user',
    uuid,
    parent_tool_use_id: null,
    message: { content: [{ type: 'text', text }] },
  } as unknown as SDKMessage
}

function assistant(uuid: string, text: string): SDKMessage {
  return {
    type: 'assistant',
    uuid,
    parent_tool_use_id: null,
    message: { content: text ? [{ type: 'text', text }] : [] },
  } as unknown as SDKMessage
}

function toolUserMsg(): SDKMessage {
  return {
    type: 'user',
    uuid: 'tool',
    parent_tool_use_id: null,
    message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] },
  } as unknown as SDKMessage
}

describe('buildTurnsFromMessages', () => {
  it('一问一答 → 一个回合，snapshotText 为 Q/A 格式', () => {
    const turns = buildTurnsFromMessages([user('u1', '什么是 RAG?'), assistant('a1', 'RAG 是…')])
    expect(turns).toHaveLength(1)
    expect(turns[0]!.messageUuid).toBe('a1')
    expect(turns[0]!.userMessageUuid).toBe('u1')
    expect(turns[0]!.questionPreview).toBe('什么是 RAG?')
    expect(turns[0]!.answerPreview).toBe('RAG 是…')
    expect(turns[0]!.snapshotText).toBe('Q: 什么是 RAG?\n\nA: RAG 是…')
  })

  it('一个回合内多条 assistant（工具循环）→ 合并文本，messageUuid 取最后一条', () => {
    const turns = buildTurnsFromMessages([
      user('u1', '查一下'),
      assistant('a1', '先看看…'),
      toolUserMsg(), // tool_result 不切回合
      assistant('a2', '结论是…'),
    ])
    expect(turns).toHaveLength(1)
    expect(turns[0]!.messageUuid).toBe('a2') // lastUuid
    expect(turns[0]!.snapshotText).toBe('Q: 查一下\n\nA: 先看看…\n结论是…')
  })

  it('纯工具调用 / 空回答的回合被跳过', () => {
    const turns = buildTurnsFromMessages([
      user('u1', '只调工具'),
      assistant('a1', ''), // 无 text
    ])
    expect(turns).toHaveLength(0)
  })

  it('多回合按出现顺序产出', () => {
    const turns = buildTurnsFromMessages([
      user('u1', 'Q1'),
      assistant('a1', 'A1'),
      user('u2', 'Q2'),
      assistant('a2', 'A2'),
    ])
    expect(turns.map((t) => t.messageUuid)).toEqual(['a1', 'a2'])
    expect(turns.map((t) => t.questionPreview)).toEqual(['Q1', 'Q2'])
  })

  it('无配对 user 的开场 assistant → 退化为只有 A 的 snapshot', () => {
    const turns = buildTurnsFromMessages([assistant('a1', '开场白')])
    expect(turns).toHaveLength(1)
    expect(turns[0]!.userMessageUuid).toBeUndefined()
    expect(turns[0]!.questionPreview).toBe('')
    expect(turns[0]!.snapshotText).toBe('A: 开场白')
  })

  it('合成 user 消息（isSynthetic）不作为问句边界', () => {
    const synthetic = {
      type: 'user',
      uuid: 'syn',
      isSynthetic: true,
      parent_tool_use_id: null,
      message: { content: [{ type: 'text', text: 'skill 展开' }] },
    } as unknown as SDKMessage
    const turns = buildTurnsFromMessages([user('u1', '真问题'), synthetic, assistant('a1', '答')])
    expect(turns).toHaveLength(1)
    expect(turns[0]!.userMessageUuid).toBe('u1') // 不被合成消息覆盖
    expect(turns[0]!.questionPreview).toBe('真问题')
  })
})
