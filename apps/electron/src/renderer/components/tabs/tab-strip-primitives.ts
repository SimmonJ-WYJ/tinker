import { cn } from '@/lib/utils'

export type TabStripSize = 'main' | 'compact'

export interface TabStripChipClassOptions {
  active: boolean
  size: TabStripSize
  className?: string
}

export function tabStripRootClassNames(className?: string): string {
  return cn(
    'flex items-center gap-1 bg-content-area titlebar-drag-region',
    className,
  )
}

export function tabStripChipClassNames({
  active,
  size,
  className,
}: TabStripChipClassOptions): string {
  return cn(
    'group relative flex items-center min-w-0 cursor-pointer select-none titlebar-no-drag',
    'rounded-xl transition-colors',
    size === 'main'
      ? 'h-[38px] gap-1.5 px-3 text-xs'
      : 'h-[30px] gap-2 px-2 text-sm',
    active
      ? 'bg-foreground/[0.08] text-foreground'
      : 'text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground',
    className,
  )
}

export function tabStripIconClassNames(size: TabStripSize, className?: string): string {
  return cn(size === 'main' ? '!size-3' : '!size-3.5', 'shrink-0', className)
}

export function tabStripLabelClassNames(active: boolean, className?: string): string {
  return cn('min-w-0 flex-1 truncate text-left', active && 'font-medium', className)
}

export function currentConversationStripClassNames(className?: string): string {
  return cn(
    'group relative inline-flex h-10 min-w-0 cursor-pointer select-none items-center gap-2 px-3 text-sm text-foreground titlebar-no-drag',
    className,
  )
}

export function currentConversationLabelClassNames(className?: string): string {
  return cn('min-w-0 truncate text-left font-medium', className)
}

export function currentConversationMenuContentClassNames(className?: string): string {
  return cn(
    'min-w-52 border-border/60 p-1.5',
    className,
  )
}

export function currentConversationMenuItemClassNames(className?: string): string {
  return cn(
    'h-8 cursor-default gap-3 rounded-lg px-2.5 text-sm font-medium text-foreground focus:bg-muted/70 focus:text-foreground',
    className,
  )
}

export function currentConversationMenuIconClassNames(className?: string): string {
  return cn('!size-4 shrink-0 text-muted-foreground', className)
}

export function tabStripCloseClassNames({
  active,
  size,
  className,
}: TabStripChipClassOptions): string {
  return cn(
    'shrink-0 rounded-sm flex items-center justify-center hover:bg-muted-foreground/20',
    size === 'main' ? 'size-4 [&_svg]:!size-2.5' : 'size-5 [&_svg]:!size-2.5',
    active ? 'opacity-70 hover:opacity-100' : 'opacity-0 group-hover:opacity-70 group-hover:hover:opacity-100',
    className,
  )
}

export function tabStripScrollButtonClassNames(className?: string): string {
  return cn('flex-shrink-0 self-center text-muted-foreground hover:bg-muted titlebar-no-drag', className)
}
