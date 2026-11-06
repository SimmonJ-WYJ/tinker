/** 文档面板默认为关闭，并按会话保存手动开关。 */
import { afterEach, expect, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Provider, createStore } from 'jotai'
import { currentAgentSessionIdAtom, currentSessionSidePanelOpenAtom } from '@/atoms/agent-atoms'
import { currentPreviewAtom } from '@/atoms/side-panel-layout'
import { setAppLanguage } from '@/lib/i18n'
import { HomePanelToggle } from './HomeHeader'
afterEach(cleanup)
test('默认收起，点击打开/收起，切换会话时不继承其他会话的开关', async () => {
  await setAppLanguage('en')
  const store = createStore()
  store.set(currentAgentSessionIdAtom, 'a')
  render(<Provider store={store}><HomePanelToggle /></Provider>)
  expect(store.get(currentSessionSidePanelOpenAtom)).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Open document panel' }))
  expect(store.get(currentSessionSidePanelOpenAtom)).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Close document panel' }))
  expect(store.get(currentSessionSidePanelOpenAtom)).toBe(false)
  act(() => store.set(currentAgentSessionIdAtom, 'b'))
  expect(store.get(currentSessionSidePanelOpenAtom)).toBe(false)
})
test('兼容入口打开文件时同步展开面板', () => {
  const store = createStore()
  store.set(currentAgentSessionIdAtom, 'a')
  store.set(currentPreviewAtom, { kind: 'file', path: '/project/draft.md', ext: 'md', size: 0 })
  expect(store.get(currentSessionSidePanelOpenAtom)).toBe(true)
})
