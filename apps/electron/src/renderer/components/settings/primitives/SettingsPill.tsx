/**
 * SettingsPill - 设置卡片内的状态 / 标签胶囊
 *
 * 用 tone 控制语义配色（中性 / 成功 / 警告 / 危险）。
 * 替代旧的 CapabilityPill / StatusPill / MetricPill 等 5 处本地实现。
 */

import * as React from 'react'
import { cn } from '@/lib/utils'

export type SettingsPillTone = 'neutral' | 'success' | 'warning' | 'destructive'

const TONE_CLASS: Record<SettingsPillTone, string> = {
  neutral: 'bg-muted text-muted-foreground',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  destructive: 'bg-destructive/10 text-destructive',
}

interface SettingsPillProps {
  children: React.ReactNode
  tone?: SettingsPillTone
  className?: string
}

export function SettingsPill({
  children,
  tone = 'neutral',
  className,
}: SettingsPillProps): React.ReactElement {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium leading-[1]',
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
