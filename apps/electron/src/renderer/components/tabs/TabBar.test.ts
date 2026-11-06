import { describe, expect, it } from 'bun:test'
import { conversationTabBarRootClassName, selectTopConversationTabs } from './TabBar.tsx'
import type { TabItem } from '@/atoms/tab-atoms'

function makeTab(id: string): TabItem {
  return { id, type: 'agent', sessionId: id, title: id, workspaceId: 'ws' }
}

describe('selectTopConversationTabs', () => {
  it('只返回当前 active tab', () => {
    expect(selectTopConversationTabs([makeTab('a'), makeTab('b')], 'b').map((tab) => tab.id)).toEqual(['b'])
  })

  it('active 不可见时回退到第一个可见 tab', () => {
    expect(selectTopConversationTabs([makeTab('a'), makeTab('b')], 'missing').map((tab) => tab.id)).toEqual(['a'])
  })

  it('没有可见 tab 时返回空数组', () => {
    expect(selectTopConversationTabs([], 'missing')).toEqual([])
  })
})

describe('conversationTabBarRootClassName', () => {
  it('中间栏顶部标题区使用内容区域背景色', () => {
    const cls = conversationTabBarRootClassName()
    expect(cls).toContain('bg-content-area')
    expect(cls).not.toContain('bg-background')
    expect(cls).not.toContain('tabbar-bg')
  })
})
