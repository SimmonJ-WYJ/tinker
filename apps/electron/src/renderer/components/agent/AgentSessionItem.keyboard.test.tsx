import { afterEach, expect, mock, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { setAppLanguage } from '@/lib/i18n'
import { AgentSessionItem } from './AgentSessionItem'

afterEach(cleanup)

test('键盘可打开会话并显露操作，编辑标题的 Enter 不触发导航', async () => {
  await setAppLanguage('en')
  const select = mock(() => {})
  const renameSession = mock(async () => {})
  render(<TooltipProvider><AgentSessionItem
    session={{ id: 'keyboard', title: 'Keyboard session', workspaceId: 'project', createdAt: 1, updatedAt: 1 }}
    active={false} hovered={false} indicatorStatus="idle" appearance="home"
    onSelect={select} onRequestDelete={() => {}} onRename={renameSession}
    onToggleArchive={async () => {}} onMouseEnter={() => {}} onMouseLeave={() => {}}
  /></TooltipProvider>)
  const row = screen.getByText('Keyboard session').closest('[role="button"]')!
  fireEvent.keyDown(row, { key: 'Enter' })
  fireEvent.keyDown(row, { key: ' ' })
  expect(select).toHaveBeenCalledTimes(2)
  fireEvent.focusIn(row)
  const rename = screen.getByRole('button', { name: 'Rename' })
  const actions = rename.closest('.absolute')!
  expect(actions.className).toContain('opacity-100')
  expect(actions.className).not.toContain('pointer-events-none')
  fireEvent.click(rename)
  const input = screen.getByRole('textbox')
  await act(async () => {
    fireEvent.change(input, { target: { value: 'Renamed from keyboard' } })
    fireEvent.keyDown(input, { key: 'Enter' })
  })
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(renameSession).toHaveBeenCalledWith('keyboard', 'Renamed from keyboard')
  expect(select).toHaveBeenCalledTimes(2)
})
