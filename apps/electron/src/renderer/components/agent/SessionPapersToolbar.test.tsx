import * as React from 'react'
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render, screen, within } from '@testing-library/react'
import { Provider as JotaiProvider } from 'jotai/react'
import { createStore } from 'jotai'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SessionPapersToolbar } from './SessionPapersToolbar.tsx'
import type { SessionPapersStats } from './session-papers-stats.ts'

afterEach(cleanup)

const emptyStats: SessionPapersStats = {
  total: 0,
  yearDistribution: [],
  sourceDistribution: [],
  yearUnknownCount: 0,
  relevanceDistribution: null,
}

function renderToolbar(): ReturnType<typeof render> {
  return render(
    <JotaiProvider store={createStore()}>
      <TooltipProvider>
        <SessionPapersToolbar
          sessionId="s-toolbar"
          totalCount={247}
          filteredCount={247}
          hiddenByUrl={0}
          stats={emptyStats}
          onRefresh={() => {}}
          onOpenInNewWindow={() => {}}
          onToggleMultiSelect={() => {}}
        />
      </TooltipProvider>
    </JotaiProvider>,
  )
}

describe('SessionPapersToolbar', () => {
  it('下行选择按钮显示文字，右侧工具仍只保留图标', () => {
    const { container } = renderToolbar()
    const toolbarRoot = container.querySelector('[data-session-papers-toolbar]')
    const toolbarClasses = toolbarRoot?.className.split(/\s+/) ?? []
    expect(toolbarRoot?.className).not.toContain('-mx-2')
    expect(toolbarClasses).not.toContain('px-[18px]')
    expect(toolbarClasses).not.toContain('px-2.5')
    expect(toolbarClasses).not.toContain('px-3')
    expect(toolbarClasses).not.toContain('px-2')
    expect(toolbarRoot?.className).not.toContain('border-b')

    const titleRow = container.querySelector('[data-session-papers-title-row]')
    const titleRowClasses = titleRow?.className.split(/\s+/) ?? []
    expect(titleRowClasses).toContain('pl-[18px]')
    expect(titleRowClasses).toContain('pr-2.5')
    expect(titleRowClasses).not.toContain('px-[18px]')

    const divider = container.querySelector('[data-session-papers-divider]')
    const dividerClasses = divider?.className.split(/\s+/) ?? []
    expect(dividerClasses).not.toContain('-mx-2')
    expect(dividerClasses).not.toContain('-mx-[18px]')
    expect(dividerClasses).not.toContain('-mx-2.5')
    expect(divider?.className).toContain('border-border/60')

    const toolbar = container.querySelector('[data-session-papers-actions]')
    expect(toolbar).toBeTruthy()
    expect(toolbar?.className.split(/\s+/)).toContain('px-2.5')
    expect(toolbar?.className.split(/\s+/)).not.toContain('px-[18px]')
    const scope = within(toolbar as HTMLElement)

    const selectButton = scope.getByRole('button', { name: 'Select' })
    expect(selectButton.className).toContain('border-border/60')
    expect(selectButton.className).toContain('w-auto')
    expect(scope.getByRole('button', { name: 'Filter' })).toBeTruthy()
    expect(scope.getByRole('combobox', { name: 'Sort by' })).toBeTruthy()
    expect(scope.getByRole('combobox', { name: 'Density' })).toBeTruthy()

    expect(scope.getByText('Select')).toBeTruthy()
    expect(scope.queryByText('Filter')).toBeNull()
    expect(scope.queryByText('Sort by')).toBeNull()
    expect(scope.queryByText('Normal')).toBeNull()
  })

  it('更多菜单保留在工具栏右侧内边距内', () => {
    renderToolbar()

    const moreButton = screen.getByTitle('More')
    expect(moreButton.className).not.toContain('-mr-')
  })

  it('筛选、排序、密度三个按钮靠右组成一组', () => {
    const { container } = renderToolbar()
    const secondaryActions = container.querySelector('[data-session-papers-secondary-actions]')
    expect(secondaryActions).toBeTruthy()
    expect(secondaryActions?.className).toContain('ml-auto')
    expect(secondaryActions?.className).not.toContain('-mr-')

    const scope = within(secondaryActions as HTMLElement)
    expect(scope.getByRole('button', { name: 'Filter' })).toBeTruthy()
    expect(scope.getByRole('combobox', { name: 'Sort by' })).toBeTruthy()
    expect(scope.getByRole('combobox', { name: 'Density' })).toBeTruthy()
    expect(scope.queryByRole('button', { name: 'Select' })).toBeNull()
  })
})
