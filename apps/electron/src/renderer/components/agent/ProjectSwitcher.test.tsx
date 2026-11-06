import { afterEach, expect, test } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import { setAppLanguage } from '@/lib/i18n'
import { ProjectSwitcher } from './ProjectSwitcher.tsx'

afterEach(async () => {
  cleanup()
  await setAppLanguage('en')
})

test('ProjectSwitcher: 展开态按钮内距与侧栏菜单项保持一致', async () => {
  await setAppLanguage('en')

  render(<ProjectSwitcher variant="button" />)

  const button = screen.getByRole('button', { name: 'No project selected' })
  const tokens = button.className.split(/\s+/)
  expect(tokens).toContain('h-8')
  expect(tokens).toContain('p-2')
  expect(tokens).toContain('leading-4')
  expect(tokens).not.toContain('px-3')
  expect(tokens).not.toContain('py-1.5')
})
