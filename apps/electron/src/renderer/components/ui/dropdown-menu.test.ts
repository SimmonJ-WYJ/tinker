import { describe, expect, it } from 'bun:test'
import {
  dropdownMenuContentClassNames,
  dropdownMenuCheckboxItemClassNames,
  dropdownMenuItemClassNames,
  dropdownMenuRadioItemClassNames,
  dropdownMenuSubContentClassNames,
  dropdownMenuSubTriggerClassNames,
} from './dropdown-menu.tsx'

describe('dropdown menu item class names', () => {
  it('菜单项 hover/focus 使用轻量浮层高亮，不使用整块 accent 色', () => {
    const classes = [
      dropdownMenuSubTriggerClassNames(),
      dropdownMenuItemClassNames(),
      dropdownMenuCheckboxItemClassNames(),
      dropdownMenuRadioItemClassNames(),
    ]

    for (const cls of classes) {
      const tokens = cls.split(/\s+/)
      expect(tokens).toContain('rounded-lg')
      expect(tokens).toContain('bg-none')
      expect(tokens).toContain('focus:bg-muted')
      expect(tokens).toContain('focus:text-foreground')
      expect(tokens).toContain('data-[highlighted]:bg-muted')
      expect(tokens).toContain('data-[highlighted]:text-foreground')
      expect(tokens).not.toContain('transition-colors')
      expect(cls).not.toContain('focus:bg-accent')
      expect(cls).not.toContain('focus:text-accent-foreground')
    }
  })

  it('菜单浮层使用实色背景，不透出底层内容形成渐变感', () => {
    const classes = [
      dropdownMenuContentClassNames(),
      dropdownMenuSubContentClassNames(),
    ]

    for (const cls of classes) {
      const tokens = cls.split(/\s+/)
      expect(tokens).toContain('bg-popover')
      expect(tokens).toContain('supports-[backdrop-filter]:bg-popover')
      expect(tokens).not.toContain('bg-popover/92')
      expect(tokens).not.toContain('supports-[backdrop-filter]:bg-popover/88')
      expect(cls).not.toContain('backdrop-blur')
    }
  })
})
