import * as React from 'react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import { Provider as JotaiProvider } from 'jotai/react'
import { createStore } from 'jotai'
import { TooltipProvider } from '@/components/ui/tooltip'

interface MockFileBrowserProps {
  baseIndent?: number
  disableRowHoverBackground?: boolean
  hideEntryIcons?: boolean
  rowClassName?: string
}

let latestFileBrowserProps: MockFileBrowserProps | null = null

mock.module('@/components/file-browser', () => ({
  FileBrowser: (props: MockFileBrowserProps): React.ReactElement => {
    latestFileBrowserProps = props
    return <div data-testid="file-browser" />
  },
}))

const { SessionFilesView } = await import('./SessionFilesView.tsx')

afterEach(cleanup)

function renderSessionFilesView(): ReturnType<typeof render> {
  return render(
    <JotaiProvider store={createStore()}>
      <TooltipProvider>
        <SessionFilesView
          sessionId="s-session-files"
          sessionPath="/tmp/default/ee8f0302-1c7d-49fe-aff7-d8558c8be20f"
        />
      </TooltipProvider>
    </JotaiProvider>,
  )
}

describe('SessionFilesView', () => {
  it('隐藏基础设施路径，根目录时显示 / 并保留右侧操作', () => {
    const { container } = renderSessionFilesView()

    const root = container.querySelector('section')
    const header = container.querySelector('[data-session-files-actions]')

    expect(root?.className).not.toContain('mx-2')
    expect(root?.className).not.toContain('mb-2')
    expect(header).toBeTruthy()
    expect(header?.className).toContain('py-1.5')
    expect(header?.className).toContain('space-y-1.5')
    expect(header?.className).not.toContain('px-3')
    expect(header?.className).not.toContain('px-2')
    expect(header?.className).not.toContain('h-[32px]')
    const actionRow = container.querySelector('[data-session-files-action-row]')
    const actionRowClasses = actionRow?.className.split(/\s+/) ?? []
    expect(actionRowClasses).toContain('pl-[18px]')
    expect(actionRowClasses).toContain('pr-2.5')
    expect(actionRowClasses).not.toContain('px-2.5')
    expect(actionRowClasses).toContain('gap-1')
    expect(actionRowClasses).toContain('min-h-8')
    const divider = container.querySelector('[data-session-files-divider]')
    expect(divider?.className).not.toContain('-mx-2')
    expect(divider?.className).not.toContain('-mx-3')
    expect(divider?.className).toContain('border-border/60')
    expect(screen.queryByText('Session files')).toBeNull()
    expect(screen.queryByText(/\.\.\.\/default\//)).toBeNull()
    expect(screen.getByText('/')).toBeTruthy()
    const uploadButton = screen.getByRole('button', { name: 'Upload file to session' })
    const finderButton = screen.getByRole('button', { name: 'Open in Finder' })
    expect(uploadButton.className).toContain('border-border/60')
    expect(uploadButton.className).toContain('rounded-xl')
    expect(finderButton.className).toContain('border-border/60')
    expect(finderButton.className).toContain('rounded-xl')
    expect(latestFileBrowserProps?.baseIndent).toBeUndefined()
    expect(latestFileBrowserProps?.disableRowHoverBackground).toBeUndefined()
    expect(latestFileBrowserProps?.hideEntryIcons).toBeUndefined()
    expect(latestFileBrowserProps?.rowClassName).toBeUndefined()
  })
})
