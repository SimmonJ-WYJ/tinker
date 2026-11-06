import { describe, expect, it } from 'bun:test'
import { dialogContentClassNames, dialogOverlayClassNames } from './dialog.tsx'
import { alertDialogContentClassNames, alertDialogOverlayClassNames } from './alert-dialog.tsx'

describe('dialog overlay class names', () => {
  it('普通 Dialog 遮罩使用半透明黑色且不做背景模糊', () => {
    const cls = dialogOverlayClassNames()

    expect(cls).toContain('bg-black/30')
    expect(cls).not.toContain('backdrop-blur')
    expect(cls).not.toContain('supports-[backdrop-filter]')
  })

  it('AlertDialog 遮罩与普通 Dialog 保持一致', () => {
    const cls = alertDialogOverlayClassNames()

    expect(cls).toContain('bg-black/30')
    expect(cls).not.toContain('backdrop-blur')
    expect(cls).not.toContain('supports-[backdrop-filter]')
  })

  it('普通 Dialog 内容面板是不透明白底，不继承毛玻璃透明浮层', () => {
    const cls = dialogContentClassNames()

    expect(cls).toContain('bg-popover')
    expect(cls).not.toContain('bg-popover/92')
    expect(cls).not.toContain('backdrop-blur')
    expect(cls).not.toContain('supports-[backdrop-filter]')
  })

  it('AlertDialog 内容面板是不透明白底，不继承毛玻璃透明浮层', () => {
    const cls = alertDialogContentClassNames()

    expect(cls).toContain('bg-popover')
    expect(cls).not.toContain('bg-popover/92')
    expect(cls).not.toContain('backdrop-blur')
    expect(cls).not.toContain('supports-[backdrop-filter]')
  })
})
