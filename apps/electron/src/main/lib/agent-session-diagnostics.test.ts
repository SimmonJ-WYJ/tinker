import { test, expect } from 'bun:test'
import {
  extractToolNotFoundName,
  extractToolResultText,
  buildToolNotFoundEvent,
} from './agent-session-diagnostics.ts'
import type { McpInitSnapshot } from './mcp/mcp-init-status.ts'

test('extractToolNotFoundName：命中 SDK 错误文本提取工具名', () => {
  expect(
    extractToolNotFoundName('Error: No such tool available: mcp__paper-search__retrieve'),
  ).toBe('mcp__paper-search__retrieve')
  // 真实报错被 <tool_use_error> 标签包裹（issue #587 截图原文），闭合标签不能混进工具名
  expect(
    extractToolNotFoundName('<tool_use_error>Error: No such tool available: mcp__paper-search__retrieve</tool_use_error>'),
  ).toBe('mcp__paper-search__retrieve')
})

test('extractToolNotFoundName：普通错误不误报', () => {
  expect(extractToolNotFoundName('Error: network timeout')).toBeNull()
  expect(extractToolNotFoundName('')).toBeNull()
})

test('extractToolResultText：字符串 / text block 数组 / 其他', () => {
  expect(extractToolResultText('plain')).toBe('plain')
  expect(
    extractToolResultText([
      { type: 'text', text: 'line1' },
      { type: 'image', source: {} },
      { type: 'text', text: 'line2' },
    ]),
  ).toBe('line1\nline2')
  expect(extractToolResultText(undefined)).toBe('')
  expect(extractToolResultText(42)).toBe('')
})

test('buildToolNotFoundEvent：带快照时计算 elapsed + server 状态', () => {
  const snapshot: McpInitSnapshot = {
    capturedAtMs: 1_000,
    servers: [{ name: 'paper-search', status: 'failed' }],
    tools: ['Bash'],
  }
  const event = buildToolNotFoundEvent({
    sessionId: 's1',
    toolName: 'mcp__paper-search__retrieve',
    nowMs: 4_500,
    snapshot,
    toolInInitTable: false,
  })
  expect(event.kind).toBe('tool_not_found')
  expect(event.sessionId).toBe('s1')
  expect(event.toolName).toBe('mcp__paper-search__retrieve')
  expect(event.elapsedSinceInitMs).toBe(3_500)
  expect(event.mcpServers).toEqual([{ name: 'paper-search', status: 'failed' }])
  expect(event.toolInInitTable).toBe(false)
})

test('buildToolNotFoundEvent：无快照时上下文字段为 null', () => {
  const event = buildToolNotFoundEvent({
    sessionId: 's1',
    toolName: 'mcp__x__y',
    nowMs: 100,
    snapshot: null,
    toolInInitTable: null,
  })
  expect(event.elapsedSinceInitMs).toBeNull()
  expect(event.mcpServers).toBeNull()
  expect(event.toolInInitTable).toBeNull()
})
