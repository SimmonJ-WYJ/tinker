/**
 * SettingsSectionHeader - 设置区块头部
 *
 * 统一设置页大区块的标题、描述和右侧操作区样式。
 */

import * as React from 'react'
import { cn } from '@/lib/utils'
import { SECTION_TITLE_CLASS, SECTION_DESCRIPTION_CLASS } from './SettingsUIConstants'

interface SettingsSectionHeaderProps {
  /** 区块标题 */
  title: React.ReactNode
  /** 区块描述（可选） */
  description?: React.ReactNode
  /** 右侧操作插槽（可选） */
  action?: React.ReactNode
  /** 根节点额外 className */
  className?: string
  /** 标题/描述容器额外 className */
  contentClassName?: string
  /** 操作区额外 className */
  actionClassName?: string
  /** 描述是否单行截断 */
  descriptionTruncate?: boolean
}

export function SettingsSectionHeader({
  title,
  description,
  action,
  className,
  contentClassName,
  actionClassName,
  descriptionTruncate = false,
}: SettingsSectionHeaderProps): React.ReactElement {
  return (
    <div className={cn('flex items-start justify-between', className)}>
      <div className={cn('min-w-0', contentClassName)}>
        <h4 className={SECTION_TITLE_CLASS}>{title}</h4>
        {description && (
          <p className={cn(SECTION_DESCRIPTION_CLASS, descriptionTruncate && 'truncate')}>
            {description}
          </p>
        )}
      </div>
      {action && <div className={cn('flex-shrink-0 ml-4', actionClassName)}>{action}</div>}
    </div>
  )
}
