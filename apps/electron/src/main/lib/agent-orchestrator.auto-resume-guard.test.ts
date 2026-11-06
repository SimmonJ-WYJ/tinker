import { describe, expect, it } from 'bun:test'
import type { SDKMessage } from '@asci/shared'
import {
  extractTopLevelAssistantText,
  shouldSkipRedundantAutoResume,
} from './agent-orchestrator.auto-resume-guard.ts'

/** 构造一条 assistant 消息（默认顶层：parent_tool_use_id === null） */
function assistant(text: string, parentToolUseId: string | null = null, isReplay = false): SDKMessage {
  return {
    type: 'assistant',
    message: { content: [{ type: 'text', text }] },
    parent_tool_use_id: parentToolUseId,
    isReplay,
  } as unknown as SDKMessage
}

/** 构造一条 result 消息 */
function result(subtype: string, resultText: string | undefined): SDKMessage {
  return {
    type: 'result',
    subtype,
    ...(resultText !== undefined && { result: resultText }),
  } as unknown as SDKMessage
}

const LONG_SUMMARY =
  '文献检索报告已生成。本次共检索 104 篇文献，召回 26 篇高相关，已按主题分 6 节呈现，参考文献按出现顺序编号。'

describe('extractTopLevelAssistantText', () => {
  it('提取主 Agent 顶层 assistant（parent_tool_use_id === null）的纯文本', () => {
    expect(extractTopLevelAssistantText(assistant(LONG_SUMMARY))).toBe(LONG_SUMMARY)
  })

  it('忽略子 Agent 文本（parent_tool_use_id 非空）', () => {
    expect(extractTopLevelAssistantText(assistant('worker 中间产物', 'toolu_123'))).toBe('')
  })

  it('忽略 replay 消息', () => {
    expect(extractTopLevelAssistantText(assistant(LONG_SUMMARY, null, true))).toBe('')
  })

  it('非 assistant 消息返回空串', () => {
    expect(extractTopLevelAssistantText(result('success', LONG_SUMMARY))).toBe('')
  })
})

describe('shouldSkipRedundantAutoResume', () => {
  it('①已交付：success result 的 result.result 与本 turn 顶层正文一致 → 跳过', () => {
    expect(
      shouldSkipRedundantAutoResume({
        resultMessage: result('success', LONG_SUMMARY),
        topLevelText: LONG_SUMMARY,
      }),
    ).toBe(true)
  })

  it('①已交付：顶层正文为多段（含中间文本），result.result 为最终段 → 仍跳过', () => {
    expect(
      shouldSkipRedundantAutoResume({
        resultMessage: result('success', LONG_SUMMARY),
        topLevelText: `我先整理一下检索结果。\n${LONG_SUMMARY}`,
      }),
    ).toBe(true)
  })

  it('②仅子 Agent 文本匹配：本 turn 无顶层正文（topLevelText 为空）→ 不跳过', () => {
    expect(
      shouldSkipRedundantAutoResume({
        resultMessage: result('success', LONG_SUMMARY),
        topLevelText: '',
      }),
    ).toBe(false)
  })

  it('③无匹配正文：顶层正文与 result.result 不一致 → 不跳过', () => {
    expect(
      shouldSkipRedundantAutoResume({
        resultMessage: result('success', LONG_SUMMARY),
        topLevelText: '我已派出 worker，正在等待结果……',
      }),
    ).toBe(false)
  })

  it('④非成功 result：subtype 非 success（即使文本一致）→ 不跳过', () => {
    expect(
      shouldSkipRedundantAutoResume({
        resultMessage: result('error_during_execution', LONG_SUMMARY),
        topLevelText: LONG_SUMMARY,
      }),
    ).toBe(false)
  })

  it('watchdog 中断路径：无 result 消息（null）→ 不跳过', () => {
    expect(
      shouldSkipRedundantAutoResume({
        resultMessage: null,
        topLevelText: '',
      }),
    ).toBe(false)
  })

  it('result.result 缺失或为空 → 不跳过', () => {
    expect(
      shouldSkipRedundantAutoResume({
        resultMessage: result('success', undefined),
        topLevelText: LONG_SUMMARY,
      }),
    ).toBe(false)
  })
})
