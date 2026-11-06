/**
 * ChoiceCardShell — Layer 1 视觉外壳。
 *
 * 负责：Codex 风格边框（dangerLevel 决定颜色）、标题、1/N 计数角标、
 * KeyboardHintFooter、确定按钮、ARIA 包装、Esc → onDismiss。不处理选项语义。
 */

import * as React from 'react'
import { choiceTokens, getDangerTokens, type ChoiceDangerLevel } from './choice-tokens.ts'
import { KeyboardHintFooter, type KeyboardHint } from './KeyboardHintFooter.tsx'
import { useT } from '@/hooks/useT'

interface ChoiceCardShellProps {
  /** 接受 ReactNode 以便 PermissionBanner 在 title 旁加 ⓘ Tooltip（Task 5） */
  title: React.ReactNode
  subtitle?: string
  dangerLevel?: ChoiceDangerLevel
  counter?: { current: number; total: number }
  footerHints?: KeyboardHint[]
  /** 右下确定按钮显示文字；不传则不渲染按钮 */
  confirmLabel?: string
  /** 危险态：按钮变红 */
  confirmDanger?: boolean
  /** 点击按钮触发；通常 = ChoiceCard 中 focused option 的 select */
  onConfirm?: () => void
  /** 按钮 disabled（如 responding 中） */
  confirmDisabled?: boolean
  onDismiss?: () => void
  children: React.ReactNode
}

export function ChoiceCardShell({
  title,
  subtitle,
  dangerLevel,
  counter,
  footerHints = [],
  confirmLabel,
  confirmDanger = false,
  onConfirm,
  confirmDisabled = false,
  onDismiss,
  children,
}: ChoiceCardShellProps): React.ReactElement {
  const { t } = useT('conversation')
  const danger = getDangerTokens(dangerLevel)
  const titleId = React.useId()
  const onDismissRef = React.useRef(onDismiss)
  onDismissRef.current = onDismiss

  React.useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) return
      const cb = onDismissRef.current
      if (!cb) return
      e.preventDefault()
      cb()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  const showFooter = footerHints.length > 0 || confirmLabel != null
  const buttonClass = confirmDanger ? choiceTokens.confirmButtonDangerClass : choiceTokens.confirmButtonClass

  return (
    <div role="dialog" aria-labelledby={titleId} className={`${choiceTokens.shellClass} ${danger.border}`}>
      <div className="flex items-center justify-between px-5 pt-3.5 pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span id={titleId} className={`text-base font-semibold ${danger.titleClass}`}>{title}</span>
          {subtitle != null && <span className="text-sm text-muted-foreground truncate">{subtitle}</span>}
        </div>
        {counter && counter.total > 1 && (
          <span className="text-badge text-muted-foreground px-1.5 py-0.5 rounded-md bg-muted/60">
            {t('choiceCard.counter', { current: counter.current, total: counter.total })}
          </span>
        )}
      </div>
      <div className="px-5 pb-3">{children}</div>
      {showFooter && (
        <div className={choiceTokens.footerClass} role="note">
          <div className={choiceTokens.footerLayoutClass}>
            <KeyboardHintFooter hints={footerHints} inline />
          </div>
          {confirmLabel != null && (
            <button
              type="button"
              className={buttonClass}
              onClick={onConfirm}
              disabled={confirmDisabled}
            >
              <span className="truncate">{confirmLabel}</span>
              <kbd className="px-1 py-px rounded bg-background/15 text-sm">↵</kbd>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
