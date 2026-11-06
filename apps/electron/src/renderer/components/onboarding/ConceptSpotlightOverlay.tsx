/**
 * ConceptSpotlightOverlay — 证据集 / 论文 notes 概念引导 overlay
 *
 * 镜像 SpotlightOverlay V2 的 mask/cutout/tooltip 视觉，但驱动数据是
 * conceptSpotlightAtom（每 tour 独立）。
 *
 * 状态机：
 *   - evidenceSet: 3 substage（evidence-set-nav / library-nav / centered）
 *   - paperNotes:  2 substage（paper-notes-panel / centered）
 *
 * 显示守卫：仅 activeView==='library' || 'notes' 时显示。末 substage 用居中布局，
 * 无需 DOM 锚点；有 target 但 DOM 未挂载时短延迟重试。
 */
import * as React from 'react'
import { useAtomValue } from 'jotai'
import { conceptSpotlightAtom } from '@/atoms/concept-spotlight-atoms'
import { spotlightActiveAtom } from '@/atoms/onboarding-spotlight-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { ConceptSpotlightTooltip } from './ConceptSpotlightTooltip'
import type { ConceptTourKey } from '../../../types/concept-spotlight'

const RECT_PADDING = 4
const RECT_RADIUS = 8

interface ActiveSubStage {
  tour: ConceptTourKey
  subStage: number
  /** DOM target attr 值；无 target 时为 null（centered） */
  targetAttr: string | null
  /** 是否末 substage（主按钮显示"完成"） */
  isLast: boolean
}

interface TourTableEntry {
  targetAttr: string | null
}

const TOUR_TABLE: Record<ConceptTourKey, ReadonlyArray<TourTableEntry>> = {
  evidenceSet: [
    { targetAttr: 'evidence-set-nav' },
    { targetAttr: 'library-nav' },
    { targetAttr: 'new-task-nav' }, // 指向左栏「新建任务」按钮
  ],
  paperNotes: [
    { targetAttr: 'paper-notes-panel' },
    { targetAttr: null }, // 居中
  ],
}

export function ConceptSpotlightOverlay(): React.ReactElement | null {
  const state = useAtomValue(conceptSpotlightAtom)
  const activeView = useAtomValue(activeViewAtom)
  // V2 spotlight 互斥：V2 在跑时整个 concept overlay 隐藏，避免两套 overlay 同时显示
  const spotlightActive = useAtomValue(spotlightActiveAtom)
  const [rect, setRect] = React.useState<DOMRect | null>(null)
  const [tick, setTick] = React.useState(0)

  // 找当前活跃的 tour（in-progress 的第一个）
  const active: ActiveSubStage | null = React.useMemo(() => {
    const order: ReadonlyArray<ConceptTourKey> = ['evidenceSet', 'paperNotes']
    for (const tour of order) {
      const t = state[tour]
      if (t?.status === 'in-progress' && t.currentSubStage != null) {
        const entry = TOUR_TABLE[tour][t.currentSubStage]
        if (!entry) return null
        const total = TOUR_TABLE[tour].length
        return {
          tour,
          subStage: t.currentSubStage,
          targetAttr: entry.targetAttr,
          isLast: t.currentSubStage === total - 1,
        }
      }
    }
    return null
  }, [state])

  // 显示守卫：evidenceSet tour 在 library / notes 视图都可触发（侧边栏 nav 项一直在）；
  // paperNotes tour 仅在 library 视图（PaperDetail 渲染上下文）。末 substage 居中且不依赖
  // DOM 锚点，但视图守卫仍生效以确保上下文恰当。
  const inEligibleView =
    active !== null &&
    ((active.tour === 'evidenceSet' && (activeView === 'library' || activeView === 'notes')) ||
      (active.tour === 'paperNotes' && activeView === 'library'))
  const visible = active !== null && inEligibleView && !spotlightActive

  // 计算 rect（仅当存在 target 时）
  React.useEffect(() => {
    if (!active || !visible || !active.targetAttr) {
      setRect(null)
      return
    }
    const targetAttr = active.targetAttr
    const findEl = (): Element | null =>
      document.querySelector(`[data-concept-spotlight-target="${targetAttr}"]`)
    const update = (): void => {
      const el = findEl()
      setRect(el ? el.getBoundingClientRect() : null)
    }
    update()

    let timer: number | null = null
    const onResize = (): void => {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(update, 60) as unknown as number
    }
    window.addEventListener('resize', onResize)

    const targetEl = findEl()
    let observer: ResizeObserver | null = null
    if (targetEl) {
      observer = new ResizeObserver(() => update())
      observer.observe(targetEl)
    }

    // 兜底：mount 后 600ms 内每 80ms 重测一次，处理 React rerender 替换节点
    const ticks: number[] = []
    for (let i = 1; i <= 7; i++) {
      ticks.push(window.setTimeout(update, i * 80) as unknown as number)
    }

    return () => {
      window.removeEventListener('resize', onResize)
      if (timer) window.clearTimeout(timer)
      if (observer) observer.disconnect()
      for (const tk of ticks) window.clearTimeout(tk)
    }
  }, [active, visible, tick])

  // target DOM 还没挂载时重试一次
  React.useEffect(() => {
    if (active && visible && active.targetAttr && !rect) {
      const t = window.setTimeout(() => setTick((v) => v + 1), 100)
      return () => window.clearTimeout(t)
    }
    return undefined
  }, [active, visible, rect])

  if (!active || !visible) return null

  const handlePrimary = async (): Promise<void> => {
    if (active.isLast) {
      await window.electronAPI
        .completeConceptSpotlight({ tour: active.tour })
        .catch(console.error)
    } else {
      await window.electronAPI
        .advanceConceptSpotlight({
          tour: active.tour,
          fromSubStage: active.subStage,
        })
        .catch(console.error)
    }
  }

  const handleSkipAll = async (): Promise<void> => {
    await window.electronAPI.skipConceptSpotlight({ tour: active.tour }).catch(console.error)
  }

  // 居中布局（无 target）：整屏 dim，气泡居中
  const isCentered = active.targetAttr == null
  if (isCentered) {
    return (
      <>
        <div
          className="fixed inset-0 z-[110] pointer-events-auto"
          style={{ backgroundColor: 'rgba(15, 23, 42, 0.65)' }}
          onClick={(e) => e.stopPropagation()}
        />
        <ConceptSpotlightTooltip
          tour={active.tour}
          subStage={active.subStage}
          rect={null}
          isLast={active.isLast}
          onPrimary={() => {
            void handlePrimary()
          }}
          onSkipAll={() => {
            void handleSkipAll()
          }}
        />
      </>
    )
  }

  // 有 target 但 rect 尚未算出：先等
  if (!rect) return null

  const x = rect.x - RECT_PADDING
  const y = rect.y - RECT_PADDING
  const w = rect.width + RECT_PADDING * 2
  const h = rect.height + RECT_PADDING * 2

  return (
    <>
      {/* SVG 镂空蒙版 — z-110 高于 Radix Dialog 的 z-100 */}
      <svg className="fixed inset-0 z-[110] w-full h-full pointer-events-none">
        <defs>
          <mask id="concept-spotlight-hole">
            <rect width="100%" height="100%" fill="white" />
            <rect x={x} y={y} width={w} height={h} rx={RECT_RADIUS} ry={RECT_RADIUS} fill="black" />
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(15, 23, 42, 0.65)"
          mask="url(#concept-spotlight-hole)"
        />
      </svg>

      {/* 暗区 hit-area 拦截 */}
      <div
        className="fixed inset-0 z-[110] pointer-events-auto"
        onClick={(e) => e.stopPropagation()}
      />
      {/* 镂空区 hit-area（吃 click → advance） */}
      <div
        className="fixed z-[110] cursor-pointer"
        style={{ left: x, top: y, width: w, height: h, pointerEvents: 'auto' }}
        onClick={() => {
          void handlePrimary()
        }}
      />

      <ConceptSpotlightTooltip
        tour={active.tour}
        subStage={active.subStage}
        rect={rect}
        isLast={active.isLast}
        onPrimary={() => {
          void handlePrimary()
        }}
        onSkipAll={() => {
          void handleSkipAll()
        }}
      />
    </>
  )
}
