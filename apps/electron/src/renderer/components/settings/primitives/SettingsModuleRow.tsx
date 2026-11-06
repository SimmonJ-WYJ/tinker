/**
 * SettingsModuleRow - 设置卡片内的"模块行"
 *
 * 比 SettingsRow 多两件事：title 右侧紧贴的 pill 槽 + action 槽可承载复杂控件
 * （Switch / Button / SegmentedControl / 进度条）。
 *
 * 适用场景：一个能力 / 模块（带状态 pill + 较长描述 + 复杂操作），
 * 不适合用 SettingsRow 的"左 label + 右 control"简单形态。
 *
 * 替代旧的 ZoteroModuleRow / ZoteroMediaPanel row / ZoteroArticlePanel 状态卡 row 等 5 处本地实现。
 */

import * as React from 'react'
import { cn } from '@/lib/utils'

interface SettingsModuleRowProps {
  /** 行标题 */
  title: string
  /** 标题右侧紧贴的 pill（可选） */
  pill?: React.ReactNode
  /** 描述（可选；string 或自定义节点） */
  description?: React.ReactNode
  /** 右侧 action 槽（Switch / Button / 复合控件） */
  action?: React.ReactNode
  /** 容器额外 className，可覆盖默认 padding（如收紧时传 "py-2"） */
  className?: string
}

export function SettingsModuleRow({
  title,
  pill,
  description,
  action,
  className,
}: SettingsModuleRowProps): React.ReactElement {
  return (
    <div
      className={cn(
        'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-5 py-5',
        className,
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 leading-none">
          <span className="text-sm font-medium text-foreground">{title}</span>
          {pill}
        </div>
        {description && (
          <div className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</div>
        )}
      </div>
      {action && <div className="flex justify-end">{action}</div>}
    </div>
  )
}
