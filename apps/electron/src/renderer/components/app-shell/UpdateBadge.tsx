/**
 * UpdateBadge - 版本更新提示徽章
 *
 * 自取数据：内部读 updateStatusAtom，未检测到更新（status !== 'available'）时返回 null。
 * 两种形态：
 *   - dot:  折叠 sidebar 用，蓝色脉冲小点（带 animate-ping 散开光晕）
 *   - pill: 展开 sidebar 用，蓝紫渐变胶囊，文本 "v{version} 可更新"
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { cn } from '@/lib/utils'
import { updateStatusAtom } from '@/atoms/updater'
import { useT } from '@/hooks/useT'

export interface UpdateBadgeProps {
  /** 折叠 sidebar 用 dot；展开 sidebar 用 pill */
  variant: 'dot' | 'pill'
  className?: string
}

export function UpdateBadge({ variant, className }: UpdateBadgeProps): React.ReactElement | null {
  const { status, version } = useAtomValue(updateStatusAtom)
  const { t } = useT('nav')
  if (status !== 'available') return null

  if (variant === 'dot') {
    return (
      <span
        className={cn(
          'relative inline-flex w-2.5 h-2.5 rounded-full bg-info ring-2 ring-background',
          className,
        )}
      >
        <span className="absolute inset-0 rounded-full bg-info animate-ping opacity-60" />
      </span>
    )
  }

  // titlebar 用：紧凑的"更新"按钮，版本号挪到 tooltip
  return (
    <span
      title={version ? t('updateBadge.tooltip', { version }) : t('updateBadge.generic')}
      className={cn(
        'inline-flex items-center flex-shrink-0 h-5 px-2 rounded-full text-badge font-normal text-info-foreground whitespace-nowrap leading-none',
        'bg-info hover:bg-info/90 shadow-sm transition-colors',
        className,
      )}
    >
      {t('updateBadge.short')}
    </span>
  )
}
