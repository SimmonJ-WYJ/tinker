import { afterEach, expect, test } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { setAppLanguage } from '@/lib/i18n'
import {
  leftSidebarBottomClassName,
  leftSidebarHeaderGridClassName,
  leftSidebarMenuClassName,
  leftSidebarSessionListInnerClassName,
  leftSidebarSessionListClassName,
  leftSidebarWorkspaceLabelClassName,
  SidebarMenuItem,
  ZoteroConnectBadge,
} from './LeftSidebar.tsx'
import { ReviewSidebarItem } from './ReviewSidebarItem.tsx'
import { sidebarProjectFilesHeaderClassName } from './SidebarProjectFilesSection.tsx'
import { accountMenuTriggerClassName } from '../auth/AccountMenu.tsx'

afterEach(async () => {
  cleanup()
  await setAppLanguage('en')
})

test('LeftSidebar: Zotero 连接提示复用统一 Badge 标签样式', async () => {
  await setAppLanguage('en')
  let clicked = false

  render(<ZoteroConnectBadge onClick={() => { clicked = true }} />)

  const badge = screen.getByText('Connect Zotero')
  expect(badge.className).toContain('rounded-md')
  expect(badge.className).toContain('text-badge')
  expect(badge.className).toContain('bg-info/10')
  expect(badge.className).toContain('text-info')
  expect(badge.className.split(/\s+/)).toContain('p-1')
  expect(badge.className.split(/\s+/)).not.toContain('px-2.5')
  expect(badge.className.split(/\s+/)).not.toContain('py-0.5')
  expect(badge.className).not.toContain('bg-primary/10')
  expect(badge.className).not.toContain('text-primary')
  expect(badge.className).not.toContain('rounded-full')
  expect(badge.className).not.toContain('text-sm')

  fireEvent.click(badge)
  expect(clicked).toBe(true)
})

test('LeftSidebar: 顶部菜单 trailing 标签靠右且右距与上下距一致', () => {
  render(
    <SidebarMenuItem
      icon={<span data-testid="icon" />}
      label="Library"
      trailing={<span>Connect Zotero</span>}
    />,
  )

  const trailing = screen.getByText('Connect Zotero').parentElement
  expect(trailing).toBeTruthy()
  expect(trailing?.className).toContain('ml-auto')
  expect(trailing?.className).toContain('-mr-1')
  expect(trailing?.className).not.toContain('-mr-2')
  expect(trailing?.className).not.toContain('pr-1')
})

test('LeftSidebar: 顶部菜单选中态不加阴影', () => {
  render(
    <SidebarMenuItem
      icon={<span data-testid="icon" />}
      label="Configure"
      active
    />,
  )

  const item = screen.getByRole('button', { name: 'Configure' })
  expect(item.className).toContain('bg-primary/10')
  expect(item.className).toContain('hover:bg-primary/10')
  expect(item.className).toContain('hover:text-foreground')
  expect(item.className).not.toContain('hover:bg-accent')
  expect(item.className).not.toContain('hover:text-accent-foreground')
  expect(item.className).not.toContain('shadow-')
})

test('LeftSidebar: 顶部菜单灰色选中框内部 padding 与会话项保持一致', () => {
  render(
    <SidebarMenuItem
      icon={<span data-testid="icon" />}
      label="Configure"
      active
    />,
  )

  const item = screen.getByRole('button', { name: 'Configure' })
  const iconBox = screen.getByTestId('icon').parentElement
  expect(item.className.split(/\s+/)).toContain('p-2')
  expect(item.className.split(/\s+/)).toContain('h-8')
  expect(item.className.split(/\s+/)).toContain('leading-4')
  expect(item.className.split(/\s+/)).not.toContain('p-1')
  expect(item.className.split(/\s+/)).not.toContain('h-auto')
  expect(item.className.split(/\s+/)).not.toContain('px-1')
  expect(item.className.split(/\s+/)).not.toContain('py-1')
  expect(item.className.split(/\s+/)).not.toContain('px-3')
  expect(iconBox?.className.split(/\s+/)).toContain('w-4')
  expect(iconBox?.className.split(/\s+/)).toContain('h-4')
  expect(iconBox?.className).not.toContain('w-[18px]')
  expect(iconBox?.className).not.toContain('h-[18px]')
})

test('LeftSidebar: review 会话灰色选中框内部 padding 与普通会话项保持一致', () => {
  render(<ReviewSidebarItem title="Review session" active onSelect={() => {}} />)

  const item = screen.getByRole('button', { name: 'Review session' })
  expect(item.className.split(/\s+/)).toContain('p-2')
  expect(item.className.split(/\s+/)).not.toContain('p-1')
  expect(item.className.split(/\s+/)).not.toContain('px-2')
  expect(item.className.split(/\s+/)).not.toContain('py-1.5')
})

test('LeftSidebar: 展开态外侧容器仍保持 8px 页边距', () => {
  expect(leftSidebarMenuClassName()).toContain('px-2')
  expect(leftSidebarSessionListClassName()).toContain('px-2')
  expect(leftSidebarHeaderGridClassName()).toContain('px-2')
  expect(leftSidebarBottomClassName()).toContain('px-2')
})

test('LeftSidebar: 工作区标题左边界对齐会话灰色框内部文字', () => {
  const tokens = leftSidebarWorkspaceLabelClassName().split(/\s+/)
  expect(tokens).toContain('px-4')
  expect(tokens).not.toContain('px-2')
})

test('LeftSidebar: 底部 Project files 与账户入口对齐上方菜单基线', () => {
  const projectFilesTokens = sidebarProjectFilesHeaderClassName().split(/\s+/)
  const accountTokens = accountMenuTriggerClassName().split(/\s+/)

  expect(projectFilesTokens).toContain('mx-2')
  expect(projectFilesTokens).toContain('h-8')
  expect(projectFilesTokens).toContain('p-2')
  expect(projectFilesTokens).not.toContain('mx-3')
  expect(projectFilesTokens).not.toContain('pl-3')
  expect(projectFilesTokens).not.toContain('pr-[9px]')

  expect(accountTokens).toContain('sidebar-account-trigger')
  expect(accountTokens).toContain('w-full')
  expect(accountTokens).not.toContain('px-3')
  expect(accountTokens).not.toContain('py-1.5')
})

test('LeftSidebar: 会话灰色框之间使用更紧凑间距', () => {
  const tokens = leftSidebarSessionListInnerClassName().split(/\s+/)
  expect(tokens).toContain('gap-0.5')
  expect(tokens).not.toContain('gap-1')
})

test('LeftSidebar: 顶部菜单项之间的间距与会话列表一致', () => {
  const tokens = leftSidebarMenuClassName().split(/\s+/)
  expect(tokens).toContain('gap-0.5')
  expect(tokens).not.toContain('gap-1')
})
