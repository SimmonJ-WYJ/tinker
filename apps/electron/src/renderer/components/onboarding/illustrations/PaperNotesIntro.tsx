/**
 * PaperNotesIntro — 论文 notes 教学卡主示意
 *
 * 视觉：PDF 页面（顶部）含一段高亮 → 向下箭头 → 笔记气泡（底部）。
 */
import type { ReactElement } from 'react'

export function PaperNotesIntro(): ReactElement {
  return (
    <svg
      viewBox="0 0 120 120"
      className="h-[120px] w-[120px]"
      aria-hidden
      focusable="false"
    >
      {/* PDF 页（顶部 y=8-58） */}
      <rect
        x={18}
        y={8}
        width={84}
        height={50}
        rx={3}
        className="stroke-current text-muted-foreground/60"
        style={{ strokeWidth: 1.25, fill: 'currentColor', fillOpacity: 0.02 }}
      />

      {/* 文本行（第 1/3/4 普通；第 2 行末段被荧光高亮） */}
      <line x1={24} x2={94} y1={18} y2={18} className="stroke-current text-muted-foreground/50" style={{ strokeWidth: 1 }} />
      <line x1={24} x2={70} y1={28} y2={28} className="stroke-current text-muted-foreground/50" style={{ strokeWidth: 1 }} />
      {/* 高亮段（第 2 行末段） */}
      <rect
        x={70}
        y={24}
        width={26}
        height={8}
        rx={1}
        className="fill-current text-foreground/30"
      />
      <line x1={24} x2={92} y1={38} y2={38} className="stroke-current text-muted-foreground/50" style={{ strokeWidth: 1 }} />
      <line x1={24} x2={80} y1={48} y2={48} className="stroke-current text-muted-foreground/50" style={{ strokeWidth: 1 }} />

      {/* 向下箭头（y=62-78） */}
      <line
        x1={60}
        x2={60}
        y1={62}
        y2={78}
        className="stroke-current text-foreground/60"
        style={{ strokeWidth: 1.5, strokeLinecap: 'round' }}
      />
      <polyline
        points="55,73 60,78 65,73"
        className="stroke-current text-foreground/60"
        style={{ strokeWidth: 1.5, strokeLinejoin: 'round', strokeLinecap: 'round', fill: 'none' }}
      />

      {/* 笔记气泡（底部 y=82-112） */}
      <rect
        x={26}
        y={82}
        width={68}
        height={30}
        rx={6}
        className="stroke-current text-foreground/80"
        style={{ strokeWidth: 1.5, fill: 'currentColor', fillOpacity: 0.05 }}
      />
      {/* 气泡内 2 条文本行 */}
      <line x1={32} x2={86} y1={92} y2={92} className="stroke-current text-foreground/50" style={{ strokeWidth: 1 }} />
      <line x1={32} x2={72} y1={102} y2={102} className="stroke-current text-foreground/40" style={{ strokeWidth: 1 }} />
    </svg>
  )
}
