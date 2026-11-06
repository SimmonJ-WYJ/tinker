/**
 * DoiChip — 文献 DOI 可点击芯片（spec: docs/specs/doi-paper-jump-spec.md §5.6）
 *
 * 对话流 markdown / 检索报告 HTML 中识别到 DOI 时渲染为可点击芯片，
 * 点击经 useOpenDoiInRightPanel 三层兜底跳转右栏文献详情。
 *
 * 视觉复用 FilePathChip 配方（紧凑标签字号 + 14px 图标）——应用既有心智模型
 * 「染色 + 带图标的 chip = 可以点」；图标用 BookOpen（文献语义），避开文件
 * chip 在用的 FileText，防止用户误以为点开是文件预览。
 */

import * as React from 'react'
import { BookOpen, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useOpenDoiInRightPanel } from '@/hooks/useOpenDoiInRightPanel.ts'
import { useT } from '@/hooks/useT'
import {
  INLINE_CHIP_STYLE,
  INLINE_CHIP_TEXT_STYLE,
  INLINE_ICON_LABEL_CLASS,
  INLINE_LABEL_INTERACTIVE_CLASS,
} from './inline-label-style.ts'

interface DoiChipProps {
  /** DOI 原文（剥前缀后；归一化由点击链路负责） */
  doi: string
  /** 展示文本；缺省显示 doi 原文（doi.org 链接的 linkText 可能是论文标题） */
  label?: string
  className?: string
}

/** 文献 DOI 芯片 — 点击跳右栏详情（命中本次检索 / crossref 即时查询 / 外链兜底） */
export function DoiChip({ doi, label, className }: DoiChipProps): React.ReactElement {
  const openDoi = useOpenDoiInRightPanel()
  const { t } = useT('conversation')
  const [pending, setPending] = React.useState(false)
  // 用 ref 做进行中守卫：state 闭包在同帧连点时仍是旧值，ref 能挡住真正的并发触发
  const inFlightRef = React.useRef(false)

  const handleClick = React.useCallback(() => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    setPending(true)
    openDoi(doi)
      .catch((err: unknown) => {
        // hook 内部已分层兜底，理论不可达；保底不吞错
        console.error('[DoiChip] DOI 跳转失败:', err)
      })
      .finally(() => {
        inFlightRef.current = false
        setPending(false)
      })
  }, [openDoi, doi])

  return (
    <button
      type="button"
      onClick={handleClick}
      title={t('doiChip.tooltip')}
      style={INLINE_CHIP_STYLE}
      className={cn(
        INLINE_ICON_LABEL_CLASS,
        INLINE_LABEL_INTERACTIVE_CLASS,
        'appearance-none justify-start border-0 outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        className
      )}
    >
      {pending
        ? <Loader2 className="!size-[13px] shrink-0 animate-spin" />
        : <BookOpen className="!size-[13px] shrink-0" />}
      <span className="asci-inline-chip-text truncate max-w-[280px]" style={INLINE_CHIP_TEXT_STYLE}>
        {label ?? doi}
      </span>
    </button>
  )
}
