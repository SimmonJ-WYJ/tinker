/**
 * 对话流行内标签统一样式。
 *
 * 覆盖文件路径、DOI、普通 inline code 等“正文中的短胶囊标签”，避免不同渲染分支
 * 各自设置 padding / line-height / 背景色导致视觉忽大忽小。
 */

import type { CSSProperties } from 'react'

export const INLINE_LABEL_CLASS =
  'asci-inline-chip max-w-full items-center gap-1 rounded-md bg-muted-foreground/15 px-1.5 text-[14px] font-normal text-foreground/85 not-prose'

export const INLINE_ICON_LABEL_CLASS =
  'asci-inline-chip max-w-full items-center gap-1 rounded-md bg-muted-foreground/15 px-1.5 text-[14px] font-normal text-foreground/85 not-prose'

export const INLINE_LABEL_INTERACTIVE_CLASS =
  'cursor-pointer transition-colors duration-150 hover:bg-muted-foreground/20 hover:text-foreground'

export const INLINE_CHIP_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  boxSizing: 'border-box',
  height: 20,
  minHeight: 0,
  paddingTop: 0,
  paddingBottom: 0,
  paddingLeft: 6,
  paddingRight: 6,
  lineHeight: '20px',
  verticalAlign: '-0.16em',
  position: 'relative',
}

export const INLINE_CHIP_TEXT_STYLE: CSSProperties = {
  height: '100%',
  lineHeight: '20px',
}
