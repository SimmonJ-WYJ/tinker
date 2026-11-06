import * as React from 'react'
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { SessionPapersMoreMenu } from './SessionPapersMoreMenu.tsx'

afterEach(cleanup)

describe('SessionPapersMoreMenu', () => {
  it('更多菜单项保持单行显示', async () => {
    render(
      <SessionPapersMoreMenu
        onRefresh={() => {}}
        onOpenInNewWindow={() => {}}
      />,
    )

    const trigger = screen.getByTitle('More')
    expect(trigger.className).toContain('h-[28px]')
    expect(trigger.className).toContain('w-[28px]')
    expect(trigger.className).toContain('rounded-xl')

    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    fireEvent.mouseDown(trigger, { button: 0, ctrlKey: false })

    const refreshItem = await screen.findByRole('menuitem', { name: /Refresh/ })
    const openInNewWindowItem = await screen.findByRole('menuitem', { name: /Open in new window/ })

    expect(refreshItem.className).toContain('whitespace-nowrap')
    expect(openInNewWindowItem.className).toContain('whitespace-nowrap')
  })
})
