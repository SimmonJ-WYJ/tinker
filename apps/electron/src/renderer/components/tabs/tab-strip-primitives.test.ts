import { describe, expect, it } from 'bun:test'
import {
  currentConversationMenuContentClassNames,
  currentConversationMenuIconClassNames,
  currentConversationMenuItemClassNames,
  currentConversationStripClassNames,
  tabStripChipClassNames,
  tabStripIconClassNames,
  tabStripRootClassNames,
} from './tab-strip-primitives.ts'

describe('tabStripRootClassNames', () => {
  it('默认不绘制底部分割线，由调用方按场景决定', () => {
    const cls = tabStripRootClassNames()
    expect(cls).not.toContain('border-b')
    expect(cls).not.toContain('border-border')
  })
})

describe('tabStripChipClassNames', () => {
  it('右侧栏 active chip 使用 Codex 式胶囊激活态', () => {
    const cls = tabStripChipClassNames({ active: true, size: 'compact' })
    expect(cls).toContain('h-[30px]')
    expect(cls).toContain('px-2')
    expect(cls).not.toContain('px-2.5')
    expect(cls).not.toContain('px-3')
    expect(cls).toContain('bg-foreground/[0.08]')
    expect(cls).not.toContain('bg-muted/70')
    expect(cls).toContain('text-foreground')
    expect(cls).toContain('rounded-xl')
    expect(cls).not.toContain('rounded-t-xl')
    expect(cls).not.toContain('shadow-[')
  })

  it('右侧栏 inactive chip 是扁平文字入口', () => {
    const cls = tabStripChipClassNames({ active: false, size: 'compact' })
    expect(cls).toContain('h-[30px]')
    expect(cls).toContain('px-2')
    expect(cls).not.toContain('px-2.5')
    expect(cls).not.toContain('px-3')
    expect(cls).toContain('text-muted-foreground')
    expect(cls).toContain('hover:bg-foreground/[0.05]')
    expect(cls).not.toContain('hover:bg-transparent')
    expect(cls).toContain('hover:text-foreground')
    expect(cls).toContain('rounded-xl')
    expect(cls).not.toContain('rounded-t-xl')
  })
})

describe('tabStripIconClassNames', () => {
  it('右侧栏 tab 图标与搜索/放大按钮图标同尺寸', () => {
    const cls = tabStripIconClassNames('compact')
    expect(cls).toContain('!size-3.5')
    expect(cls).not.toContain('!size-4')
  })
})

describe('currentConversationStripClassNames', () => {
  it('主对话顶部使用 Codex 式单行标题入口而不是 tab chip', () => {
    const cls = currentConversationStripClassNames()
    expect(cls).toContain('text-foreground')
    expect(cls).toContain('inline-flex')
    expect(cls).toContain('h-10')
    expect(cls).not.toContain('h-12')
    expect(cls).not.toContain('bg-content-area')
    expect(cls).not.toContain('flex-1')
    expect(cls).not.toContain('rounded-t-xl')
  })
})

describe('currentConversation menu primitives', () => {
  it('主对话更多菜单使用 Codex 式紧凑内容层', () => {
    const cls = currentConversationMenuContentClassNames()
    expect(cls).toContain('min-w-52')
    expect(cls).toContain('p-1.5')
    expect(cls).toContain('border-border/60')
    expect(cls).not.toContain('rounded-')
    expect(cls).not.toContain('bg-popover')
    expect(cls).not.toContain('backdrop-blur')
    expect(cls).not.toContain('shadow-lg')
  })

  it('主对话更多菜单 item 使用紧凑行高和小图标', () => {
    const itemCls = currentConversationMenuItemClassNames()
    const iconCls = currentConversationMenuIconClassNames()
    expect(itemCls).toContain('h-8')
    expect(itemCls).toContain('gap-3')
    expect(itemCls).toContain('text-sm')
    expect(iconCls).toContain('!size-4')
  })
})
