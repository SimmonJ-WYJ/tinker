import { afterEach, expect, test } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { setAppLanguage } from '@/lib/i18n'
import {
  capabilityPackDetailHeaderClassName,
  capabilityPackDetailSummaryClassName,
  capabilityPackDetailTitleClassName,
  capabilityPackDetailTitleRowClassName,
  capabilityPackDetailVersionClassName,
  capabilityPackIncludeHeaderClassName,
  capabilityPackIncludeListClassName,
  capabilityPackIncludeNameClassName,
  capabilityPackIncludeRowClassName,
  capabilityPackIncludeRowSurfaceClassName,
  capabilityPackIncludeTypeClassName,
} from './CapabilityPackPanel.tsx'
import {
  configContentContainerClassName,
  ConfigTabs,
  shouldShowConfigTitle,
  type ConfigTab,
} from './ConfigView.tsx'

afterEach(async () => {
  cleanup()
  await setAppLanguage('en')
})

test('ConfigView: 左上导航对齐 Codex compact chip 交互', async () => {
  await setAppLanguage('en')
  const tabChanges: ConfigTab[] = []

  render(
    <ConfigTabs
      activeTab="capabilityPacks"
      onChange={(next) => { tabChanges.push(next) }}
    />,
  )

  const shell = document.querySelector('[data-config-tabs-shell]')
  expect(shell?.className).toContain('p-2.5')

  const navigation = screen.getByRole('navigation', { name: 'Configuration' })
  const navigationClasses = navigation.className.split(/\s+/)
  expect(navigation.className).toContain('h-[30px]')
  expect(navigationClasses).not.toContain('p-1')
  expect(navigationClasses).not.toContain('px-2.5')
  expect(navigationClasses).not.toContain('mt-1.5')
  expect(navigationClasses).not.toContain('px-6')
  expect(navigationClasses).not.toContain('pt-3')

  const capabilityPacks = screen.getByRole('button', { name: 'Capability Packs' })
  const skills = screen.getByRole('button', { name: 'Skills' })
  expect(capabilityPacks.className).toContain('h-[30px]')
  expect(capabilityPacks.className).toContain('rounded-xl')
  expect(capabilityPacks.className).toContain('bg-foreground/[0.08]')
  expect(capabilityPacks.className).toContain('text-foreground')
  expect(skills.className).toContain('h-[30px]')
  expect(skills.className).toContain('hover:bg-foreground/[0.05]')
  expect(skills.className).toContain('hover:text-foreground')

  fireEvent.click(skills)
  expect(tabChanges).toEqual(['skills'])
})

test('ConfigView: 能力包详情态左上显示 Codex 风格 breadcrumb 返回', async () => {
  await setAppLanguage('en')
  const tabChanges: ConfigTab[] = []
  let backCount = 0

  render(
    <ConfigTabs
      activeTab="capabilityPacks"
      detailMode="capabilityPack"
      detailLabel="lit-review"
      onBackFromCapabilityDetail={() => { backCount += 1 }}
      onChange={(next) => { tabChanges.push(next) }}
    />,
  )

  expect(screen.queryByRole('tab')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Skills' })).toBeNull()

  const backButton = screen.getByRole('button', { name: 'Back to Capability Packs' })
  expect(backButton.textContent).toBe('Capability Packs')
  expect(backButton.className).toContain('text-muted-foreground')
  expect(backButton.className).not.toContain('bg-foreground/[0.08]')
  expect(document.querySelector('.lucide-chevron-right')).not.toBeNull()
  expect(screen.getByText('lit-review').className).toContain('text-foreground')

  fireEvent.click(backButton)

  expect(backCount).toBe(1)
  expect(tabChanges).toEqual([])
})

test('ConfigView: 正文内容区域使用更窄的阅读宽度', () => {
  const className = configContentContainerClassName()

  expect(className).toContain('max-w-[720px]')
  expect(className).not.toContain('max-w-[840px]')
  expect(className).not.toContain('max-w-[1000px]')
})

test('ConfigView: 能力包详情页隐藏配置大标题', () => {
  expect(shouldShowConfigTitle('capabilityPacks', 'lit-review')).toBe(false)
  expect(shouldShowConfigTitle('capabilityPacks', null)).toBe(true)
  expect(shouldShowConfigTitle('skills', 'lit-review')).toBe(true)
})

test('CapabilityPackPanel: 详情顶部信息区使用稳定对齐布局', () => {
  const headerClassName = capabilityPackDetailHeaderClassName()
  const titleRowClassName = capabilityPackDetailTitleRowClassName()
  const titleClassName = capabilityPackDetailTitleClassName()
  const versionClassName = capabilityPackDetailVersionClassName()
  const summaryClassName = capabilityPackDetailSummaryClassName()

  expect(headerClassName).toContain('grid')
  expect(headerClassName).toContain('grid-cols-[minmax(0,1fr)_auto]')
  expect(headerClassName).toContain('items-center')
  expect(headerClassName).toContain('gap-6')
  expect(headerClassName).toContain('pt-8')
  expect(headerClassName).not.toContain('pt-4')
  expect(headerClassName).not.toContain('flex')
  expect(headerClassName).not.toContain('items-start')
  expect(titleRowClassName).toContain('items-baseline')
  expect(titleRowClassName).not.toContain('items-center')
  expect(titleClassName).toContain('leading-tight')
  expect(titleClassName).not.toContain('leading-none')
  expect(titleClassName).toContain('truncate')
  expect(versionClassName).toContain('text-base')
  expect(versionClassName).toContain('leading-tight')
  expect(versionClassName).toContain('text-muted-foreground')
  expect(versionClassName).not.toContain('text-foreground/40')
  expect(versionClassName).not.toContain('text-sm')
  expect(versionClassName).not.toContain('leading-none')
  expect(versionClassName).toContain('tabular-nums')
  expect(summaryClassName).toContain('mt-2')
  expect(summaryClassName).toContain('text-base')
  expect(summaryClassName).toContain('text-muted-foreground')
  expect(summaryClassName).not.toContain('mt-1')
  expect(summaryClassName).not.toContain('mt-3')
  expect(summaryClassName).not.toContain('text-sm')
  expect(summaryClassName).toContain('max-w-2xl')
})

test('CapabilityPackPanel: 详情包含项使用只读列表行样式', () => {
  const className = capabilityPackIncludeRowClassName()
  const surfaceClassName = capabilityPackIncludeRowSurfaceClassName()
  const headerClassName = capabilityPackIncludeHeaderClassName()
  const listClassName = capabilityPackIncludeListClassName()
  const nameClassName = capabilityPackIncludeNameClassName()
  const typeClassName = capabilityPackIncludeTypeClassName()

  expect(headerClassName).toContain('mb-2')
  expect(headerClassName).toContain('grid')
  expect(headerClassName).toContain('grid-cols-[minmax(0,16rem)_minmax(0,1fr)_2.5rem]')
  expect(headerClassName).toContain('gap-3')
  expect(headerClassName).toContain('px-2')
  expect(headerClassName).toContain('[&>h3]:col-span-2')
  expect(headerClassName).toContain('[&>span]:justify-self-center')
  expect(headerClassName).not.toContain('mb-5')
  expect(headerClassName).not.toContain('justify-between')
  expect(listClassName).not.toContain('border-b')
  expect(listClassName).not.toContain('divide-y')
  expect(listClassName).not.toContain('divide-y')
  expect(className).toContain('relative')
  expect(className).toContain('flex')
  expect(className).toContain('items-center')
  expect(className).toContain('h-11')
  expect(className).toContain('border-b')
  expect(className).toContain('border-border/35')
  expect(className).toContain('group')
  expect(className).not.toContain('hover:bg-muted')
  expect(surfaceClassName).toContain('grid')
  expect(surfaceClassName).toContain('h-full')
  expect(surfaceClassName).not.toContain('relative')
  expect(surfaceClassName).not.toContain('z-10')
  expect(surfaceClassName).not.toContain('h-10')
  expect(surfaceClassName).toContain('w-full')
  expect(className).not.toContain('min-h-[56px]')
  expect(surfaceClassName).toContain('grid-cols-[minmax(0,16rem)_minmax(0,1fr)_2.5rem]')
  expect(surfaceClassName).toContain('px-2')
  expect(surfaceClassName).not.toContain('p-2')
  expect(surfaceClassName).not.toContain('py-3')
  expect(surfaceClassName).toContain('bg-none')
  expect(surfaceClassName).toContain('transition-transform')
  expect(surfaceClassName).toContain('duration-150')
  expect(surfaceClassName).toContain('group-hover:translate-x-0.5')
  expect(surfaceClassName).not.toContain('hover:bg-muted')
  expect(className).not.toContain('after:')
  expect(className).not.toContain('before:')
  expect(className).not.toContain('border-t')
  expect(surfaceClassName).not.toContain('py-4')
  expect(surfaceClassName).not.toContain('cursor-pointer')
  expect(nameClassName).toContain('text-sm')
  expect(nameClassName).not.toContain('text-base')
  expect(typeClassName).toContain('text-sm')
  expect(typeClassName).not.toContain('text-base')
})
