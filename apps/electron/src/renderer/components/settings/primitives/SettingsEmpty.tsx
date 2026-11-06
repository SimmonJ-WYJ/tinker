/**
 * SettingsEmpty - 设置区块空状态
 *
 * 统一弹窗内列表/区块的空状态样式：图标锚点 + 提示文案 + 可选 CTA。
 * 替代以前各处零散的 `text-sm text-muted-foreground py-{8|10|12} text-center`。
 */

import * as React from 'react'

interface SettingsEmptyProps {
  /** 主提示文字 */
  children: React.ReactNode
  /** 可选 lucide 图标（推荐 size 28、strokeWidth 1.5），作为视觉锚点 */
  icon?: React.ReactNode
  /** 可选 CTA — 仅在 section header 没有同类主按钮时使用 */
  cta?: React.ReactNode
}

export function SettingsEmpty({ children, icon, cta }: SettingsEmptyProps): React.ReactElement {
  return (
    <div className="flex flex-col items-center gap-2.5 px-4 py-7 text-center">
      {icon && <div className="text-muted-foreground/60">{icon}</div>}
      <div className="text-sm text-muted-foreground">{children}</div>
      {cta}
    </div>
  )
}
