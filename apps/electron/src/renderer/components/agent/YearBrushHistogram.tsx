/**
 * YearBrushHistogram — 带「刷选(brush selection)」交互的年份分布柱状图
 *
 * 交互（Pointer Events + setPointerCapture）：
 * - pointerdown：以指针所在年份为锚点，立即单选该年
 * - 按住横向拖动：选区从锚点实时扩展到当前年份（可左可右），高亮即时更新
 * - pointerup：完成选择，触发一次 onChange；按下未移动直接松开 = 单选锚点年
 * - 拖出图表边界：选区钳制在首 / 尾年份（setPointerCapture 保证拖出元素仍可跟踪）
 * - 容器 touch-action:none，避免移动端与页面滚动冲突
 *
 * 受控组件：value({start,end}|null) + onChange（pointerup 触发一次）；
 * 拖动过程的实时回调走 onBrushing。视觉高亮在拖动中即时更新（用内部 draft，
 * 不等 onChange 回流），未拖动时回落到受控 value。
 *
 * 自包含：不依赖图表库，原生 div 实现；文件末尾附 1945–2026 模拟数据 + 演示组件。
 */

import * as React from 'react'

export interface YearCount {
  year: number
  count: number
}

export interface YearRange {
  /** 起始年（含），始终 ≤ end */
  start: number
  /** 结束年（含） */
  end: number
}

interface YearBrushHistogramProps {
  /** 年份连续的分布数据，按年份升序 */
  data: YearCount[]
  /** 受控选区；null = 无选择 */
  value: YearRange | null
  /** 拖动结束（pointerup）时触发一次；清除选择时传 null */
  onChange: (next: YearRange | null) => void
  /** 拖动过程中的实时回调（可选） */
  onBrushing?: (range: YearRange) => void
  /** 柱状图高度（px），默认 128 */
  height?: number
  className?: string
  /**
   * 自定义顶部信息文案（用于 i18n 注入）。不传则用内置中文默认。
   * selection 为当前生效选区（拖动中=draft，否则=value）；count=区间内 count 求和；span=年跨度。
   */
  renderSummary?: (info: { selection: YearRange | null; count: number; span: number }) => React.ReactNode
  /** 「清除选择」按钮文案，默认中文 */
  clearLabel?: string
}

/** 强调色 / 灰色，按规格固定 */
const SELECTED_COLOR = '#378ADD'
const UNSELECTED_COLOR = '#888780'
/** 最小可视柱高（百分比） */
const MIN_BAR_HEIGHT_PCT = 5

export function YearBrushHistogram({
  data,
  value,
  onChange,
  onBrushing,
  height = 128,
  className,
  renderSummary,
  clearLabel = '清除选择',
}: YearBrushHistogramProps): React.ReactElement {
  const barsRef = React.useRef<HTMLDivElement>(null)
  /** 拖动锚点年份；null = 当前未在拖动 */
  const anchorRef = React.useRef<number | null>(null)
  /** 拖动中的实时选区（视觉优先于受控 value，避免等 onChange 回流的闪烁） */
  const [draft, setDraft] = React.useState<YearRange | null>(null)

  const maxCount = React.useMemo(
    () => data.reduce((m, d) => Math.max(m, d.count), 0),
    [data],
  )
  const firstYear = data[0]?.year ?? 0
  const lastYear = data[data.length - 1]?.year ?? 0

  /** 把指针的 clientX 映射到年份：容器宽度均分 N 槽，越界钳制到首 / 尾 */
  const yearAtClientX = React.useCallback(
    (clientX: number): number => {
      const el = barsRef.current
      if (!el || data.length === 0) return firstYear
      const rect = el.getBoundingClientRect()
      if (rect.width <= 0) return firstYear
      const slot = rect.width / data.length
      let idx = Math.floor((clientX - rect.left) / slot)
      if (idx < 0) idx = 0
      if (idx > data.length - 1) idx = data.length - 1
      return data[idx]?.year ?? firstYear
    },
    [data, firstYear],
  )

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (data.length === 0 || e.button !== 0) return
    // 拖出元素后仍跟踪指针
    e.currentTarget.setPointerCapture(e.pointerId)
    const year = yearAtClientX(e.clientX)
    anchorRef.current = year
    const next: YearRange = { start: year, end: year }
    setDraft(next)
    onBrushing?.(next)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const anchor = anchorRef.current
    if (anchor === null) return
    const year = yearAtClientX(e.clientX)
    const next: YearRange = {
      start: Math.min(anchor, year),
      end: Math.max(anchor, year),
    }
    // 仅在变化时更新，减少多余渲染
    setDraft((prev) =>
      prev && prev.start === next.start && prev.end === next.end ? prev : next,
    )
    onBrushing?.(next)
  }

  const finishDrag = (e: React.PointerEvent<HTMLDivElement>, commit: boolean): void => {
    if (anchorRef.current === null) return
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* 指针可能已释放，忽略 */
    }
    const final = draft
    anchorRef.current = null
    setDraft(null)
    if (commit && final) onChange(final)
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>): void => finishDrag(e, true)
  // 手势被系统打断：回退到受控 value，不提交
  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>): void => finishDrag(e, false)

  const clear = (): void => {
    anchorRef.current = null
    setDraft(null)
    onChange(null)
  }

  // 视觉与信息展示都用「拖动中 draft 优先，否则受控 value」
  const effective = draft ?? value

  const sumInRange = (r: YearRange): number =>
    data.reduce((acc, d) => (d.year >= r.start && d.year <= r.end ? acc + d.count : acc), 0)

  const selCount = effective ? sumInRange(effective) : 0
  const selSpan = effective ? effective.end - effective.start + 1 : 0

  let label: React.ReactNode
  if (renderSummary) {
    // i18n / 自定义注入
    label = renderSummary({ selection: effective, count: selCount, span: selSpan })
  } else if (!effective) {
    label = <span className="text-muted-foreground">未选择</span>
  } else if (effective.start === effective.end) {
    label = (
      <span>
        <span className="font-medium tabular-nums" style={{ color: SELECTED_COLOR }}>
          {effective.start}
        </span>
        年 · {selCount} 条
      </span>
    )
  } else {
    label = (
      <span>
        <span className="font-medium tabular-nums" style={{ color: SELECTED_COLOR }}>
          {effective.start} – {effective.end}
        </span>
        {' · 共 '}
        {selCount}
        {' 条 · '}
        {selSpan}
        {' 年'}
      </span>
    )
  }

  return (
    <div className={className} role="group" aria-label="年份分布刷选">
      {/* 顶部信息条 + 清除按钮 */}
      <div className="mb-2 flex items-center justify-between gap-2 text-xs">
        <div className="min-w-0 truncate">{label}</div>
        <button
          type="button"
          onClick={clear}
          disabled={!effective}
          className="shrink-0 rounded px-1.5 py-0.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
        >
          {clearLabel}
        </button>
      </div>

      {/* 柱状图区：flex 等宽 + 2px 间隙，柱底对齐 */}
      <div
        ref={barsRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        className="flex select-none items-end gap-[2px] cursor-crosshair"
        style={{ height, touchAction: 'none' }}
      >
        {data.map((d) => {
          const inSel = effective != null && d.year >= effective.start && d.year <= effective.end
          const hPct =
            maxCount > 0
              ? Math.max(MIN_BAR_HEIGHT_PCT, (d.count / maxCount) * 100)
              : MIN_BAR_HEIGHT_PCT
          // 无选择：全部灰、不透明；有选择：命中强调色不透明，其余灰且 0.45
          const color = effective != null && inSel ? SELECTED_COLOR : UNSELECTED_COLOR
          const opacity = effective == null ? 1 : inSel ? 1 : 0.45
          return (
            <div
              key={d.year}
              className="flex-1 min-w-0 rounded-sm"
              style={{
                height: `${hPct}%`,
                backgroundColor: color,
                opacity,
                transition: 'opacity 80ms ease, background-color 80ms ease',
              }}
              title={`${d.year} · ${d.count} 条`}
            />
          )
        })}
      </div>

      {/* 首尾年份刻度 */}
      {data.length > 0 && (
        <div className="mt-1 flex justify-between text-sm tabular-nums text-muted-foreground">
          <span>{firstYear}</span>
          <span>{lastYear}</span>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// 演示用：1945–2026 模拟数据 + 受控包装组件（可直接挂载查看）
// ============================================================================

/** 确定性伪随机（LCG），保证每次构造的演示数据一致、不随重渲染抖动 */
export function makeDemoYearData(from = 1945, to = 2026): YearCount[] {
  const out: YearCount[] = []
  let seed = 0x2545f
  const rand = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  for (let y = from; y <= to; y++) {
    const t = (y - from) / (to - from)
    // 随年份增长的趋势 + 噪声，模拟论文逐年增多
    const base = Math.pow(t, 2.2) * 130
    const count = Math.round(base + rand() * 28 + 2)
    out.push({ year: y, count })
  }
  return out
}

/** 1945–2026 演示数据（模块级常量，引用稳定） */
export const DEMO_YEAR_DATA: YearCount[] = makeDemoYearData()

/** 受控演示包装：自管 value 状态，控制台打印实时刷选回调 */
export function YearBrushHistogramDemo(): React.ReactElement {
  const [range, setRange] = React.useState<YearRange | null>(null)
  return (
    <div className="max-w-2xl p-6">
      <YearBrushHistogram
        data={DEMO_YEAR_DATA}
        value={range}
        onChange={setRange}
        onBrushing={(r) => console.debug('[brushing]', r.start, '–', r.end)}
      />
    </div>
  )
}
