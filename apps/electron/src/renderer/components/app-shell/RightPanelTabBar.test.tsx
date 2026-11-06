import * as React from 'react'
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Provider as JotaiProvider } from 'jotai/react'
import { createStore } from 'jotai'
import { currentAgentSessionIdAtom } from '@/atoms/agent-atoms'
import {
  rightPanelTabsBySessionAtom,
  upsertTab,
} from '@/atoms/right-panel-tabs.ts'
import { TooltipProvider } from '@/components/ui/tooltip'
import { RightPanelTabBar } from './RightPanelTabBar.tsx'

afterEach(cleanup)

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver ??= NoopResizeObserver as never

function renderWithPreviewTab(): ReturnType<typeof render> {
  const sessionId = 's-right-tabs'
  const store = createStore()
  store.set(currentAgentSessionIdAtom, sessionId)
  const tabsAtom = rightPanelTabsBySessionAtom(sessionId)
  const initial = store.get(tabsAtom)
  const next = upsertTab(
    initial,
    'file-preview:/tmp/report.md',
    'file-preview',
    'report.md',
    { kind: 'file', path: '/tmp/report.md', ext: 'md', size: 1 },
  )
  store.set(tabsAtom, next)

  return render(
    <JotaiProvider store={store}>
      <TooltipProvider>
        <RightPanelTabBar />
      </TooltipProvider>
    </JotaiProvider>,
  )
}

describe('RightPanelTabBar', () => {
  it('顶部 tab 使用右栏卡片 p-1 作为左侧留白，不额外负偏移', () => {
    renderWithPreviewTab()

    const tabList = screen.getByRole('tablist')
    expect(tabList.className).not.toContain('-ml-1')
    expect(tabList.className).not.toContain('px-2')
  })

  it('右上角工具按钮统一为 28px 且圆角一致', () => {
    renderWithPreviewTab()

    const searchButton = screen.getByRole('button', { name: /tabSearch\.trigger|搜索|search/i })
    const maximizeButton = screen.getByRole('button', { name: /maximize|最大化|restore|还原/i })
    expect(searchButton.className).toContain('size-[28px]')
    expect(searchButton.className).toContain('rounded-xl')
    expect(maximizeButton.className).toContain('size-[28px]')
    expect(maximizeButton.className).toContain('rounded-xl')
  })

  it('动态 tab 显示行内关闭按钮，点击后关闭该 tab', () => {
    renderWithPreviewTab()

    // 可关闭的动态 tab（file-preview）渲染行内 × 关闭按钮（i18n 未初始化时 aria-label 为 raw key，含 close）
    const closeBtn = screen.getByRole('button', { name: /close|关闭/i })
    expect(closeBtn).not.toBeNull()
    expect(screen.getByRole('tab', { name: /report\.md/i })).toBeTruthy()

    // 点 × 后该 tab 不再存在
    fireEvent.click(closeBtn)
    expect(screen.queryByRole('tab', { name: /report\.md/i })).toBeNull()
  })
})
