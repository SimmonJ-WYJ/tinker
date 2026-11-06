import * as React from 'react'
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render } from '@testing-library/react'
import { Provider as JotaiProvider } from 'jotai/react'
import { createStore } from 'jotai'
import { currentAgentSessionIdAtom } from '@/atoms/agent-atoms.ts'
import { rightPanelTabsBySessionAtom } from '@/atoms/right-panel-tabs.ts'
import { TooltipProvider } from '@/components/ui/tooltip.tsx'
import { RightPanelTabHost } from './RightPanelTabHost.tsx'

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver ??= NoopResizeObserver as never

afterEach(cleanup)

describe('RightPanelTabHost', () => {
  it('只给 TabBar 区域提供 p-1 留白，内容区保持原来的左对齐基线', () => {
    const store = createStore()
    const sessionId = 's-right-host'
    store.set(currentAgentSessionIdAtom, sessionId)
    const tabsAtom = rightPanelTabsBySessionAtom(sessionId)
    store.set(tabsAtom, { ...store.get(tabsAtom), activeId: 'session-files' })

    const { container } = render(
      <JotaiProvider store={store}>
        <TooltipProvider>
          <RightPanelTabHost />
        </TooltipProvider>
      </JotaiProvider>,
    )

    const host = container.firstElementChild
    const tabBarShell = container.querySelector('[data-right-panel-tab-bar-shell]')
    const content = container.querySelector('[data-right-panel-tab-content-shell]')

    expect(host?.className).not.toContain('p-1')
    expect(host?.className).not.toContain('gap-2')
    expect(tabBarShell?.className).toContain('p-1')
    expect(tabBarShell?.className).toContain('px-2.5')
    expect(tabBarShell?.className).not.toContain('pl-2.5')
    expect(tabBarShell?.className).not.toContain('pb-0')
    expect(content?.className).not.toContain('p-1')
  })
})
