/**
 * ChoiceCard — Layer 2 单选 + 键盘交互。
 *
 * 在 ChoiceCardShell 之上挂键盘 handler、选项 list、danger 二次确认。
 * options ≤ 9 个享有数字键直选；超出仍渲染但仅前 9 个绑定数字键。
 */

import * as React from 'react'
import { ChoiceCardShell } from './ChoiceCardShell.tsx'
import { ConfirmDangerousModal } from './ConfirmDangerousModal.tsx'
import { choiceTokens, type ChoiceDangerLevel } from './choice-tokens.ts'
import type { KeyboardHint } from './KeyboardHintFooter.tsx'

export interface ChoiceOption {
  id: string
  label: string
  description?: string
  icon?: React.ReactNode
  hint?: string
  danger?: boolean
  disabled?: boolean
}

interface ChoiceCardProps {
  title: React.ReactNode
  subtitle?: string
  dangerLevel?: ChoiceDangerLevel
  counter?: { current: number; total: number }
  footerHints?: KeyboardHint[]
  onDismiss?: () => void
  body?: React.ReactNode
  options: ChoiceOption[]
  defaultFocusedId?: string
  bodyExtra?: React.ReactNode
  onSelect: (optionId: string) => void
}

// 沿数组方向找下一个未 disabled 项；若全部 disabled，返回 from。
function findNextEnabled(opts: ChoiceOption[], from: number, dir: 1 | -1): number {
  const n = opts.length
  for (let i = 1; i <= n; i++) {
    const idx = ((from + dir * i) % n + n) % n
    if (!opts[idx]?.disabled) return idx
  }
  return from
}

export function ChoiceCard({
  title,
  subtitle,
  dangerLevel,
  counter,
  footerHints,
  onDismiss,
  body,
  options,
  defaultFocusedId,
  bodyExtra,
  onSelect,
}: ChoiceCardProps): React.ReactElement {
  // 初始焦点：优先取 defaultFocusedId，否则首个未 disabled 项；若全 disabled fallback 0。
  const initialIdx = React.useMemo(() => {
    if (defaultFocusedId == null) return options.findIndex((o) => !o.disabled)
    const idx = options.findIndex((o) => o.id === defaultFocusedId)
    return idx >= 0 ? idx : options.findIndex((o) => !o.disabled)
  }, [defaultFocusedId, options])

  const [focusedIdx, setFocusedIdx] = React.useState<number>(Math.max(initialIdx, 0))
  const [pendingDangerId, setPendingDangerId] = React.useState<string | null>(null)
  const focusedIdxRef = React.useRef(focusedIdx)
  focusedIdxRef.current = focusedIdx
  const optionsRef = React.useRef(options)
  optionsRef.current = options

  const triggerSelect = React.useCallback((optionId: string) => {
    const opt = optionsRef.current.find((o) => o.id === optionId)
    if (!opt || opt.disabled) return
    if (opt.danger) {
      setPendingDangerId(optionId)
      return
    }
    onSelect(optionId)
  }, [onSelect])

  const focused = options[focusedIdx]
  const confirmLabel = focused && !focused.disabled ? focused.label : undefined
  const confirmDanger = (focused?.danger ?? false) && dangerLevel === 'dangerous'

  // 紧凑/多行布局切换：列表中只要有任一选项带 description，整列就用多行变体（items-start）；
  // 全部单行时用紧凑变体（items-center + h-9）让内容真正垂直居中。
  const anyHasDescription = options.some((o) => o.description != null && o.description !== '')
  const rowClass = anyHasDescription ? choiceTokens.optionRow : choiceTokens.optionRowCompact
  const prefixClass = anyHasDescription ? choiceTokens.optionPrefix : choiceTokens.optionPrefixCompact

  const handleConfirm = React.useCallback(() => {
    const opt = optionsRef.current[focusedIdxRef.current]
    if (opt && !opt.disabled) triggerSelect(opt.id)
  }, [triggerSelect])

  React.useEffect(() => {
    if (pendingDangerId != null) return  // modal 打开期间暂停键盘 handler，避免与 modal 自身 keys 抢
    const handler = (e: KeyboardEvent): void => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) return

      const opts = optionsRef.current
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusedIdx((i) => findNextEnabled(opts, i, 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusedIdx((i) => findNextEnabled(opts, i, -1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const opt = opts[focusedIdxRef.current]
        if (opt && !opt.disabled) triggerSelect(opt.id)
      } else if (/^[1-9]$/.test(e.key)) {
        const idx = Number(e.key) - 1
        const opt = opts[idx]
        if (opt && !opt.disabled) {
          e.preventDefault()
          triggerSelect(opt.id)
        }
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [pendingDangerId, triggerSelect])

  return (
    <>
      <ChoiceCardShell
        title={title}
        subtitle={subtitle}
        dangerLevel={dangerLevel}
        counter={counter}
        confirmLabel={confirmLabel}
        confirmDanger={confirmDanger}
        onConfirm={handleConfirm}
        confirmDisabled={focused?.disabled ?? false}
        footerHints={footerHints}
        onDismiss={onDismiss}
      >
        {body}
        <ul role="listbox" className="mt-1 max-h-[60vh] overflow-y-auto py-0.5 scrollbar-thin">
          {options.map((opt, idx) => {
            const isFocused = idx === focusedIdx
            const danger = opt.danger ?? false
            return (
              <li
                key={opt.id}
                role="option"
                aria-selected={isFocused}
                aria-disabled={opt.disabled}
                className={[
                  rowClass,
                  isFocused ? choiceTokens.focusRow : '',
                  opt.disabled ? 'opacity-50 pointer-events-none' : '',
                  danger && isFocused ? 'relative ' + choiceTokens.focusPrefixDangerous : '',
                ].filter(Boolean).join(' ')}
                onClick={() => !opt.disabled && triggerSelect(opt.id)}
              >
                <span className={prefixClass}>
                  <span aria-hidden="true" className="inline-block w-3">{isFocused ? '›' : ' '}</span>
                  <span>{idx < 9 ? `${idx + 1}.` : '·'}</span>
                </span>
                {opt.icon}
                <div className="flex-1 min-w-0">
                  <div className={choiceTokens.optionLabel}>{opt.label}</div>
                  {opt.description && <div className={choiceTokens.optionDescription}>{opt.description}</div>}
                </div>
                {opt.hint && <span className="text-sm text-muted-foreground">{opt.hint}</span>}
              </li>
            )
          })}
        </ul>
        {bodyExtra}
      </ChoiceCardShell>
      <ConfirmDangerousModal
        open={pendingDangerId != null}
        toolName={subtitle ?? ''}
        onConfirm={() => {
          const id = pendingDangerId
          setPendingDangerId(null)
          if (id != null) onSelect(id)
        }}
        onCancel={() => setPendingDangerId(null)}
      />
    </>
  )
}
