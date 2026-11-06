import { describe, expect, it } from 'bun:test'
import { sessionPapersToolbarIconButtonClassNames } from './session-papers-toolbar-primitives.ts'

describe('sessionPapersToolbarIconButtonClassNames', () => {
  it('检索结果工具条使用 Codex 式纯图标按钮尺寸与 hover', () => {
    const cls = sessionPapersToolbarIconButtonClassNames()
    expect(cls).toContain('h-[28px]')
    expect(cls).toContain('w-[28px]')
    expect(cls).toContain('rounded-xl')
    expect(cls).toContain('p-0')
    expect(cls).toContain('border')
    expect(cls).toContain('border-border/60')
    expect(cls).toContain('bg-background')
    expect(cls).toContain('!shadow-none')
    expect(cls).toContain('hover:bg-foreground/[0.08]')
    expect(cls).toContain('[&_svg]:size-3.5')
    expect(cls).not.toContain('gap-')
  })

  it('label 形态用于左侧带文字的选择按钮', () => {
    const cls = sessionPapersToolbarIconButtonClassNames({ shape: 'label' })
    expect(cls).toContain('h-[28px]')
    expect(cls).toContain('w-auto')
    expect(cls).toContain('gap-1.5')
    expect(cls).toContain('px-2')
    expect(cls).toContain('text-xs')
    expect(cls).toContain('border-border/60')
    expect(cls).toContain('!shadow-none')
  })

  it('plain 变体用于左侧选择按钮：无边框无阴影但保留 hover 灰底', () => {
    const cls = sessionPapersToolbarIconButtonClassNames({ variant: 'plain' })
    expect(cls).toContain('h-[28px]')
    expect(cls).toContain('w-[28px]')
    expect(cls).toContain('rounded-xl')
    expect(cls).toContain('bg-transparent')
    expect(cls).toContain('hover:bg-foreground/[0.08]')
    expect(cls).toContain('border-0')
    expect(cls).not.toContain('border-border/60')
    expect(cls).toContain('!shadow-none')
  })

  it('active 状态沿用同一选中背景', () => {
    const cls = sessionPapersToolbarIconButtonClassNames({ active: true })
    expect(cls).toContain('bg-foreground/[0.08]')
    expect(cls).toContain('text-foreground')
  })
})
