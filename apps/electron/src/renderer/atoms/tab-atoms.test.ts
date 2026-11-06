/**
 * tab-atoms 纯函数单元测试 — 工作区过滤 / scoped 关闭 / workspaceId 回填（#458）
 */

import { describe, test, expect } from 'bun:test'
import {
  filterVisibleTabs,
  openTab,
  closeTab,
  backfillTabWorkspaceIds,
} from './tab-atoms.ts'
import type { TabItem } from './tab-atoms.ts'

function makeTab(id: string, workspaceId?: string): TabItem {
  return { id, type: 'agent', sessionId: id, title: `t-${id}`, ...(workspaceId != null ? { workspaceId } : {}) }
}

describe('filterVisibleTabs', () => {
  const tabs = [makeTab('a1', 'A'), makeTab('a2', 'A'), makeTab('b1', 'B'), makeTab('x')]

  test('按工作区过滤，无归属 tab 各处可见', () => {
    expect(filterVisibleTabs(tabs, 'A').map((t) => t.id)).toEqual(['a1', 'a2', 'x'])
    expect(filterVisibleTabs(tabs, 'B').map((t) => t.id)).toEqual(['b1', 'x'])
  })

  test('当前工作区为 null 时显示全部', () => {
    expect(filterVisibleTabs(tabs, null)).toBe(tabs)
  })
})

describe('openTab', () => {
  test('新建 tab 时写入 workspaceId', () => {
    const result = openTab([], { type: 'agent', sessionId: 's1', title: 'T', workspaceId: 'A' })
    expect(result.tabs[0]!.workspaceId).toBe('A')
    expect(result.activeTabId).toBe('s1')
  })

  test('聚焦已有 tab 时回填缺失的 workspaceId', () => {
    const tabs = [makeTab('s1')]
    const result = openTab(tabs, { type: 'agent', sessionId: 's1', title: 'T', workspaceId: 'A' })
    expect(result.tabs[0]!.workspaceId).toBe('A')
    expect(result.activeTabId).toBe('s1')
    expect(result.tabs).toHaveLength(1)
  })

  test('已有归属不被覆盖', () => {
    const tabs = [makeTab('s1', 'A')]
    const result = openTab(tabs, { type: 'agent', sessionId: 's1', title: 'T', workspaceId: 'B' })
    expect(result.tabs).toBe(tabs)
    expect(result.tabs[0]!.workspaceId).toBe('A')
  })
})

describe('closeTab（scoped）', () => {
  // 布局：A1 A2 B1 A3（B1 在当前工作区 A 中不可见）
  const tabs = [makeTab('a1', 'A'), makeTab('a2', 'A'), makeTab('b1', 'B'), makeTab('a3', 'A')]

  test('关闭活跃 tab 后邻位跳过隐藏的外部工作区 tab', () => {
    const result = closeTab(tabs, 'a2', 'a2', 'A')
    // 可见序 [a1, a2, a3]，关 a2（idx 1）→ 邻位 a3，而非全局邻位 b1
    expect(result.activeTabId).toBe('a3')
    expect(result.tabs.map((t) => t.id)).toEqual(['a1', 'b1', 'a3'])
  })

  test('关闭最后可见 tab → activeTabId 为 null，外部 tab 仍保留', () => {
    const only = [makeTab('a1', 'A'), makeTab('b1', 'B')]
    const result = closeTab(only, 'a1', 'a1', 'A')
    expect(result.activeTabId).toBeNull()
    expect(result.tabs.map((t) => t.id)).toEqual(['b1'])
  })

  test('未提供 visibleWorkspaceId 时退化为全量邻位（兼容旧行为）', () => {
    const result = closeTab(tabs, 'a2', 'a2')
    expect(result.activeTabId).toBe('b1')
  })

  test('关闭非活跃 tab 不改变 activeTabId', () => {
    const result = closeTab(tabs, 'a1', 'a2', 'A')
    expect(result.activeTabId).toBe('a1')
    expect(result.tabs.map((t) => t.id)).toEqual(['a1', 'b1', 'a3'])
  })
})

describe('backfillTabWorkspaceIds', () => {
  test('用 session meta 补齐缺失归属', () => {
    const tabs = [makeTab('s1'), makeTab('s2', 'B')]
    const next = backfillTabWorkspaceIds(tabs, [{ id: 's1', workspaceId: 'A' }])
    expect(next[0]!.workspaceId).toBe('A')
    expect(next[1]!.workspaceId).toBe('B')
  })

  test('无变化时返回原引用', () => {
    const tabs = [makeTab('s1', 'A')]
    expect(backfillTabWorkspaceIds(tabs, [{ id: 's1', workspaceId: 'B' }])).toBe(tabs)
    const noMeta = [makeTab('s2')]
    expect(backfillTabWorkspaceIds(noMeta, [])).toBe(noMeta)
  })
})
