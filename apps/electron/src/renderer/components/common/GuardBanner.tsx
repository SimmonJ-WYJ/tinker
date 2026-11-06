/**
 * GuardBanner — 状态门控引导卡片（文献库 / 加入 Zotero 弹窗共用）
 *
 * 琥珀（warning）/ 红（error）色调的圆角卡片：警告图标 + 标题 + 描述 + 可选动作按钮。
 * 只渲染卡片本身，不含外层定位；调用方按需包裹（如全屏居中 / 弹窗内联）。
 */
import * as React from 'react'
import { AlertCircle } from 'lucide-react'

import { cn } from '@/lib/utils'

export interface GuardBannerProps {
  tone: 'warning' | 'error'
  title: string
  description: string
  action?: React.ReactNode
  /** 额外样式（如宽度约束 max-w-md w-full） */
  className?: string
}

export function GuardBanner({ tone, title, description, action, className }: GuardBannerProps): React.ReactElement {
  const toneClasses = tone === 'warning'
    ? 'bg-warning/10 text-warning border-warning/30'
    : 'bg-destructive/10 text-destructive border-destructive/30'
  return (
    <div className={cn('rounded-2xl border p-8 flex flex-col items-center text-center gap-3', toneClasses, className)}>
      <AlertCircle size={28} />
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm opacity-90 leading-relaxed">{description}</p>
      {action}
    </div>
  )
}
