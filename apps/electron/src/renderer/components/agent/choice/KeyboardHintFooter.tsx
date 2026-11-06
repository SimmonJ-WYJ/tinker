/**
 * KeyboardHintFooter — Choice UI 卡片底部快捷键提示行。
 * inline=true 时只渲染 hint spans（不画 border + padding），由父容器统一布局；
 * inline=false（默认）渲染完整 footer 容器（兼容老用法）。
 */

import * as React from 'react'
import { choiceTokens } from './choice-tokens.ts'

export interface KeyboardHint {
  key: string
  label: string
}

interface KeyboardHintFooterProps {
  hints: KeyboardHint[]
  className?: string
  /** inline 模式：只渲染 spans，由父容器画 footer */
  inline?: boolean
}

export function KeyboardHintFooter({ hints, className, inline = false }: KeyboardHintFooterProps): React.ReactElement | null {
  if (hints.length === 0) return null
  const spans = hints.map((hint, idx) => (
    <span key={`${hint.key}-${idx}`} className="inline-flex items-center gap-1">
      <kbd className="px-1 py-px rounded bg-muted/60 text-sm">{hint.key}</kbd>
      <span>{hint.label}</span>
    </span>
  ))
  if (inline) return <>{spans}</>
  return (
    <div className={[choiceTokens.footerClass, className].filter(Boolean).join(' ')} role="note">
      {spans}
    </div>
  )
}
