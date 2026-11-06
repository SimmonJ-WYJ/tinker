/** 首屏建议只填入提示词，不直接发起模型调用。 */
import { afterEach, expect, mock, test } from 'bun:test'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { setAppLanguage } from '@/lib/i18n'
import { HomeWelcome, HomeSuggestions } from './HomeWelcome'
afterEach(cleanup)
test('首屏展示确认标题和正式 SVG 标志', async () => {
  await setAppLanguage('en')
  const { container } = render(<HomeWelcome />)
  expect(screen.getByRole('heading', { name: 'What will you create today?' })).toBeInTheDocument()
  expect(container.querySelector('svg')).not.toBeNull()
  expect(container.querySelector('img')).toBeNull()
})
test('点击建议只回填可编辑文本，中文同步可用', async () => {
  await setAppLanguage('en')
  const select = mock((_prompt: string) => undefined)
  const view = render(<HomeSuggestions onSelect={select} />)
  fireEvent.click(screen.getByRole('button', { name: 'Build with AI' }))
  expect(select).toHaveBeenCalledTimes(1)
  expect(select.mock.calls[0]?.[0]).toContain('build')
  view.unmount()
  await setAppLanguage('zh')
  render(<HomeSuggestions onSelect={select} />)
  expect(screen.getByRole('button', { name: '与 AI 一起编程' })).toBeInTheDocument()
  await act(async () => { await setAppLanguage('en') })
})

test('Search 首屏不显示三个快捷建议', () => {
 const { container } = render(<HomeSuggestions mode="search" onSelect={() => {}} />)
 expect(container.querySelector('button')).toBeNull()
})
