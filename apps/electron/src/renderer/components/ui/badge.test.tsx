import { describe, expect, it } from 'bun:test'
import { badgeVariants } from './badge.tsx'

describe('badgeVariants', () => {
  it('默认 = neutral × soft', () => {
    const cls = badgeVariants()
    expect(cls).toContain('bg-muted')
    expect(cls).toContain('text-muted-foreground')
    expect(cls).toContain('rounded-md')
    expect(cls).toContain('text-badge')
  })

  it('success × soft 用 /10 透明度', () => {
    const cls = badgeVariants({ tone: 'success', variant: 'soft' })
    expect(cls).toContain('bg-success/10')
    expect(cls).toContain('text-success')
    expect(cls).not.toContain('bg-success/15')
  })

  it('info × solid 用实色底 + 反白字', () => {
    const cls = badgeVariants({ tone: 'info', variant: 'solid' })
    expect(cls).toContain('bg-info')
    expect(cls).toContain('text-info-foreground')
  })

  it('warning × outline 用描边 + 语义字色', () => {
    const cls = badgeVariants({ tone: 'warning', variant: 'outline' })
    expect(cls).toContain('border-warning')
    expect(cls).toContain('text-warning')
  })

  it('destructive × soft 用 /10（不是 /5 也不是 /15）', () => {
    const cls = badgeVariants({ tone: 'destructive', variant: 'soft' })
    expect(cls).toContain('bg-destructive/10')
    expect(cls).not.toContain('bg-destructive/5')
    expect(cls).not.toContain('bg-destructive/15')
  })

  it('outline variant 注入 border（区别于 soft/solid）', () => {
    const cls = badgeVariants({ tone: 'neutral', variant: 'outline' })
    expect(cls).toContain('border')
    // soft 不应有 border
    expect(badgeVariants({ tone: 'neutral', variant: 'soft' })).not.toContain('border')
  })

  it('neutral soft 与 solid 的字色不同（soft=muted-foreground, solid=foreground）', () => {
    expect(badgeVariants({ tone: 'neutral', variant: 'soft' })).toContain('text-muted-foreground')
    const solid = badgeVariants({ tone: 'neutral', variant: 'solid' })
    expect(solid).toContain('text-foreground')
    expect(solid).not.toContain('text-muted-foreground')
  })
})
