/**
 * EvidenceSetIntro — 证据集教学卡主示意
 *
 * 视觉：三张论文卡（顶部） → 汇线 → 一个聚合容器（证据集），内含两条 evidence bar。
 * 配色全部跟随 currentColor / 语义 token，亮暗主题自动适配。
 */
import type { ReactElement } from 'react'

export function EvidenceSetIntro(): ReactElement {
  return (
    <svg
      viewBox="0 0 120 120"
      className="h-[120px] w-[120px]"
      aria-hidden
      focusable="false"
    >
      {/* 三张论文卡（顶部 y=8） */}
      {[8, 44, 80].map((x) => (
        <g key={x}>
          <rect
            x={x}
            y={8}
            width={28}
            height={32}
            rx={3}
            className="fill-current text-card stroke-current"
            style={{ strokeWidth: 1.25 }}
          />
          {/* 内部 3 条横线 */}
          {[16, 22, 28].map((dy) => (
            <line
              key={dy}
              x1={x + 4}
              x2={x + 24}
              y1={dy + 0}
              y2={dy + 0}
              className="stroke-current text-muted-foreground/50"
              style={{ strokeWidth: 1 }}
            />
          ))}
          {/* 卡描边覆盖填色 */}
          <rect
            x={x}
            y={8}
            width={28}
            height={32}
            rx={3}
            className="stroke-current text-muted-foreground/60"
            style={{ strokeWidth: 1.25, fill: 'none' }}
          />
        </g>
      ))}

      {/* 三条汇线：每张卡底中点 → 中间 y=58 */}
      {[22, 58, 94].map((x) => (
        <line
          key={x}
          x1={x}
          x2={60}
          y1={40}
          y2={58}
          className="stroke-current text-muted-foreground/50"
          style={{ strokeWidth: 1, strokeLinecap: 'round' }}
        />
      ))}

      {/* 证据集容器（底部 y=58-112） — stack 阴影 */}
      <rect
        x={24}
        y={64}
        width={72}
        height={44}
        rx={5}
        className="fill-current stroke-current text-muted-foreground/30"
        style={{ strokeWidth: 1, fillOpacity: 0.5 }}
      />
      <rect
        x={20}
        y={60}
        width={72}
        height={44}
        rx={5}
        className="stroke-current text-foreground/80"
        style={{ strokeWidth: 1.5, fill: 'currentColor', fillOpacity: 0.04 }}
      />

      {/* 内部 2 条 evidence bar */}
      <rect
        x={28}
        y={70}
        width={56}
        height={6}
        rx={1.5}
        className="fill-current text-foreground/40"
      />
      <rect
        x={28}
        y={82}
        width={42}
        height={6}
        rx={1.5}
        className="fill-current text-foreground/30"
      />
    </svg>
  )
}
