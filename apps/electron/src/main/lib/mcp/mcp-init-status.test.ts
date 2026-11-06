import { test, expect } from 'bun:test'
import type { SDKSystemMessage } from '@asci/shared'
import {
  parseMcpInitSnapshot,
  listUnhealthyMcpServers,
  snapshotHasTool,
  formatMcpSnapshotSummary,
} from './mcp-init-status.ts'

const initMsg = (extra: Partial<SDKSystemMessage>): SDKSystemMessage => ({
  type: 'system',
  subtype: 'init',
  ...extra,
})

test('init 消息：解析 mcp_servers 状态 + tools 列表', () => {
  const snap = parseMcpInitSnapshot(
    initMsg({
      mcp_servers: [
        { name: 'paper-search', status: 'connected' },
        { name: 'zotero', status: 'failed' },
      ],
      tools: ['Bash', 'mcp__paper-search__retrieve'],
    }),
    1000,
  )
  expect(snap).not.toBeNull()
  expect(snap?.capturedAtMs).toBe(1000)
  expect(snap?.servers).toEqual([
    { name: 'paper-search', status: 'connected' },
    { name: 'zotero', status: 'failed' },
  ])
  expect(snap?.tools).toEqual(['Bash', 'mcp__paper-search__retrieve'])
})

test('非 init 消息 → null', () => {
  expect(parseMcpInitSnapshot({ type: 'system', subtype: 'compact_boundary' }, 0)).toBeNull()
})

test('init 但 mcp_servers 与 tools 都缺失 → null（SDK 版本不带该信息）', () => {
  expect(parseMcpInitSnapshot(initMsg({}), 0)).toBeNull()
})

test('字段残缺：name/status 非字符串回落 unknown，tools 过滤非字符串项', () => {
  const snap = parseMcpInitSnapshot(
    initMsg({
      mcp_servers: [{ name: 'ok', status: 'connected' }, {}, { name: 'x' }],
      tools: ['Bash', 42, null] as unknown as string[],
    }),
    0,
  )
  expect(snap?.servers).toEqual([
    { name: 'ok', status: 'connected' },
    { name: 'unknown', status: 'unknown' },
    { name: 'x', status: 'unknown' },
  ])
  expect(snap?.tools).toEqual(['Bash'])
})

test('listUnhealthyMcpServers：仅返回非 connected 条目', () => {
  const snap = parseMcpInitSnapshot(
    initMsg({
      mcp_servers: [
        { name: 'a', status: 'connected' },
        { name: 'b', status: 'failed' },
        { name: 'c', status: 'pending' },
      ],
    }),
    0,
  )!
  expect(listUnhealthyMcpServers(snap).map((s) => s.name)).toEqual(['b', 'c'])
})

test('snapshotHasTool：tools 缺失 → null（无法判断），存在 → 布尔', () => {
  const withTools = parseMcpInitSnapshot(initMsg({ tools: ['mcp__paper-search__retrieve'] }), 0)!
  expect(snapshotHasTool(withTools, 'mcp__paper-search__retrieve')).toBe(true)
  expect(snapshotHasTool(withTools, 'mcp__paper-search__search_papers')).toBe(false)

  const noTools = parseMcpInitSnapshot(initMsg({ mcp_servers: [{ name: 'a', status: 'connected' }] }), 0)!
  expect(snapshotHasTool(noTools, 'anything')).toBeNull()
})

test('formatMcpSnapshotSummary：单行摘要', () => {
  const snap = parseMcpInitSnapshot(
    initMsg({ mcp_servers: [{ name: 'paper-search', status: 'connected' }, { name: 'zotero', status: 'failed' }] }),
    0,
  )!
  expect(formatMcpSnapshotSummary(snap)).toBe('paper-search=connected, zotero=failed')
})
