import { cn } from '@/lib/utils'

export interface FloatingSurfaceClassOptions {
  className?: string
}

export function floatingSurfaceClassNames(options: FloatingSurfaceClassOptions = {}): string {
  return cn(
    'rounded-lg border border-border/45 bg-popover/92 text-popover-foreground shadow-[0_24px_80px_rgba(15,23,42,0.16)] backdrop-blur-2xl supports-[backdrop-filter]:bg-popover/88',
    options.className,
  )
}
