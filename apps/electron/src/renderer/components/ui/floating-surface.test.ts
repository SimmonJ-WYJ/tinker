import { describe, expect, it } from 'bun:test'
import { floatingSurfaceClassNames } from './floating-surface.ts'

describe('floatingSurfaceClassNames', () => {
  it('全局浮层使用 Codex 风格的清爽圆角、半透明背景和柔和投影', () => {
    const cls = floatingSurfaceClassNames()
    expect(cls).toContain('rounded-lg')
    expect(cls).toContain('border-border/45')
    expect(cls).toContain('bg-popover/92')
    expect(cls).toContain('text-popover-foreground')
    expect(cls).toContain('backdrop-blur-2xl')
    expect(cls).toContain('supports-[backdrop-filter]:bg-popover/88')
    expect(cls).toContain('shadow-[0_24px_80px_rgba(15,23,42,0.16)]')
    expect(cls).not.toContain('shadow-md')
    expect(cls).not.toContain('shadow-lg')
  })

  it('允许调用方覆盖间距等局部尺寸', () => {
    const cls = floatingSurfaceClassNames({ className: 'p-1.5' })
    expect(cls).toContain('p-1.5')
  })
})
