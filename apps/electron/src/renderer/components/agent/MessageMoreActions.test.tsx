import { afterEach, expect, mock, test } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setAppLanguage } from '@/lib/i18n'
import { MessageMoreActions } from './MessageMoreActions.tsx'
afterEach(cleanup)
test('键盘可打开更多操作并执行分叉，回退仍可访问', async () => {
  await setAppLanguage('en')
  const fork = mock(() => {})
  const rewind = mock(() => {})
  const user = userEvent.setup()
  render(<MessageMoreActions onFork={fork} onRewind={rewind} />)
  expect(screen.queryByRole('menuitem')).toBeNull()
  screen.getByRole('button', { name: 'More message actions' }).focus()
  await user.keyboard('{Enter}')
  expect(await screen.findByRole('menuitem', { name: 'Fork from here' })).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: 'Rewind to here' })).toBeInTheDocument()
  await user.keyboard('{Enter}')
  expect(fork).toHaveBeenCalledTimes(1)
  expect(rewind).not.toHaveBeenCalled()
})
test('没有可用操作时不展示空菜单', () => {
  render(<MessageMoreActions />)
  expect(screen.queryByRole('button')).toBeNull()
})
test('在回复的操作菜单选择编辑和重新生成分别派发一次', async () => {
  await setAppLanguage('en')
  const revise = mock(() => {})
  const user = userEvent.setup()
  render(<MessageMoreActions onRevise={revise} />)
  for (const [label, action] of [['Edit question in new branch', 'edit'], ['Regenerate in new branch', 'regenerate']]) {
    await user.click(screen.getByRole('button', { name: 'More message actions' }))
    await user.click(await screen.findByRole('menuitem', { name: label }))
    expect(revise).toHaveBeenLastCalledWith(action)
  }
  expect(revise).toHaveBeenCalledTimes(2)
})
