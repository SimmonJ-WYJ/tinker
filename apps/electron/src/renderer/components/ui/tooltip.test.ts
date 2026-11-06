import { describe, expect, it } from 'bun:test'
import { tooltipContentClassNames } from './tooltip.tsx'

describe('tooltipContentClassNames', () => {
  it('Tooltip 复用全局轻量毛玻璃浮层，而不是深色厚重面板', () => {
    const cls = tooltipContentClassNames()

    expect(cls).toContain('bg-popover/92')
    expect(cls).toContain('rounded-lg')
    expect(cls).toContain('supports-[backdrop-filter]:bg-popover/88')
    expect(cls).toContain('text-popover-foreground')
    expect(cls).toContain('backdrop-blur-2xl')
    expect(cls).toContain('shadow-sm')
    expect(cls).not.toContain('bg-tooltip')
    expect(cls).not.toContain('text-tooltip-foreground')
    expect(cls).not.toContain('rounded-2xl')
    expect(cls).not.toContain('shadow-lg')
  })

  it('允许业务 tooltip 覆盖尺寸和内距', () => {
    const cls = tooltipContentClassNames('max-w-[220px] p-0')

    expect(cls).toContain('max-w-[220px]')
    expect(cls).toContain('p-0')
  })
})

it("悬浮提示使用独立的紧凑辅助字阶", () => {
  const cls = tooltipContentClassNames()
  // eslint-disable-next-line asci/min-font-size -- 验证已确认的辅助提示字阶
  expect(cls).toContain("text-[12px]")
  expect(cls).toContain("font-normal")
  expect(cls).toContain("shadow-sm")
  expect(cls).not.toContain("text-xs")
})
