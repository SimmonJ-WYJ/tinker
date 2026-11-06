import { test, expect, describe } from 'bun:test'
import type { SDKMessage } from '@asci/shared'
import { findToolResultInMessages } from './tool-result-lookup.ts'

function userToolResult(toolUseId: string, content: unknown, isError?: boolean): SDKMessage {
  return {
    type: 'user',
    parent_tool_use_id: null,
    message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, content, is_error: isError }] },
  } as unknown as SDKMessage
}

describe('findToolResultInMessages', () => {
  test('未找到返回 null', () => {
    expect(findToolResultInMessages('missing', [])).toBeNull()
  })

  test('string content 直接作为 result', () => {
    const msgs = [userToolResult('t1', 'hello')]
    expect(findToolResultInMessages('t1', msgs)).toEqual({ result: 'hello', isError: undefined })
  })

  test('数组 content 拼接 text 片段', () => {
    const msgs = [userToolResult('t1', [
      { type: 'text', text: 'a' },
      { type: 'image' },
      { type: 'text', text: 'b' },
    ])]
    expect(findToolResultInMessages('t1', msgs)).toEqual({ result: 'a\nb', isError: undefined })
  })

  test('is_error 透传', () => {
    const msgs = [userToolResult('t1', 'boom', true)]
    expect(findToolResultInMessages('t1', msgs)).toEqual({ result: 'boom', isError: true })
  })
})
