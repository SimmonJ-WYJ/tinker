/**
 * Choice UI 共享设计 token — 边框 / 危险态 / 焦点 / footer。
 * C/D 不复用 ChoiceCardShell，仅引用本文件的 token，实现"非 Shell 但同源"。
 */

import type { DangerLevel } from '@asci/shared'

export const choiceTokens = {
  shellClass: 'rounded-[17px] border-[0.5px] bg-card shadow-sm mx-2.5 mb-2.5 md:mx-[18px] md:mb-[18px]',
  danger: {
    safe: {
      border: 'border-choice-safe-border',
      titleClass: 'text-foreground',
    },
    normal: {
      border: 'border-border',
      titleClass: 'text-foreground',
    },
    dangerous: {
      border: 'border-choice-dangerous-border',
      titleClass: 'text-choice-dangerous-fg',
    },
  },
  focusRow: 'bg-accent',
  triggerHover: 'hover:bg-accent',
  focusPrefixDangerous: 'before:absolute before:left-0 before:top-1 before:bottom-1 before:w-0.5 before:bg-choice-dangerous-prefix',
  footerClass: 'text-xs text-muted-foreground border-t pl-5 pr-3 py-2 flex items-center gap-3',
  footerLayoutClass: 'flex-1 flex items-center gap-3 flex-wrap',
  // 多行变体：当列表中有 description 时使用 — items-start 把序号锚定到 label 第一行
  optionRow: 'flex items-start gap-2 min-h-9 px-3 py-2 my-1 rounded-lg cursor-pointer transition-colors',
  optionPrefix: 'inline-flex items-center text-sm text-muted-foreground w-7 shrink-0 mt-0.5',
  // 紧凑变体：当列表中所有选项均为单行 label 时使用 — items-center 让内容在固定 h-9 行内垂直居中
  optionRowCompact: 'flex items-center gap-2 h-9 px-3 my-1 rounded-lg cursor-pointer transition-colors',
  optionPrefixCompact: 'inline-flex items-center text-sm text-muted-foreground w-7 shrink-0',
  optionLabel: 'text-sm flex-1',
  optionDescription: 'text-xs text-muted-foreground line-clamp-2',
  confirmButtonClass: 'inline-flex items-center gap-1.5 h-8 px-4 rounded-xl text-sm font-medium bg-foreground text-background hover:bg-foreground/90 max-w-[200px] truncate',
  confirmButtonDangerClass: 'inline-flex items-center gap-1.5 h-8 px-4 rounded-xl text-sm font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 max-w-[200px] truncate',
} as const

export type ChoiceDangerLevel = DangerLevel

export const getDangerTokens = (level: ChoiceDangerLevel | undefined) =>
  choiceTokens.danger[level ?? 'normal']
