import { cn } from '@/lib/utils'

export interface SessionPapersToolbarIconButtonClassOptions {
  active?: boolean
  className?: string
  shape?: 'icon' | 'label'
  variant?: 'outlined' | 'plain'
}

export function sessionPapersToolbarIconButtonClassNames({
  active = false,
  className,
  shape = 'icon',
  variant = 'outlined',
}: SessionPapersToolbarIconButtonClassOptions = {}): string {
  return cn(
    'relative inline-flex h-[28px] shrink-0 items-center justify-center rounded-xl',
    shape === 'icon' && 'w-[28px] p-0',
    shape === 'label' && 'w-auto gap-1.5 px-2 py-0 text-xs font-medium',
    'text-foreground/70 !shadow-none transition-colors',
    variant === 'outlined' && 'border border-border/60 bg-background',
    variant === 'plain' && 'border-0 bg-transparent',
    'hover:bg-foreground/[0.08] hover:text-foreground',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
    '[&_svg]:size-3.5',
    active && 'bg-foreground/[0.08] text-foreground',
    className,
  )
}
