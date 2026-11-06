import { describe, expect, it } from 'bun:test'
// @ts-expect-error tailwind 配置为无类型 JS 默认导出
import config from './tailwind.config.js'

describe('tailwind fontSize 14px 下限', () => {
  it('text-xs 被钳到 14px（0.875rem）', () => {
    const xs = config.theme.extend.fontSize?.xs
    expect(Array.isArray(xs) ? xs[0] : xs).toBe('0.875rem')
  })

  it('text-badge 作为标签专用字号保持 12px（0.75rem）', () => {
    const badge = config.theme.extend.fontSize?.badge
    expect(Array.isArray(badge) ? badge[0] : badge).toBe('0.75rem')
  })
})
