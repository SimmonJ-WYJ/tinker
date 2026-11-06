/**
 * Splitter — 极简拖拽分割线
 *
 * 使用 Pointer Events；onDrag 传回当前指针的 client 坐标（client X 或 Y）。
 * 调用方负责把坐标换算成"比例"并 setState。
 *
 * 支持两个方向：
 * - orientation="vertical"   → 垂直线（左右拖拽，ew-resize）
 * - orientation="horizontal" → 水平线（上下拖拽，ns-resize）
 *
 * 拖拽结束统一收敛到幂等的 endDrag()：pointerup / pointercancel /
 * lostpointercapture / window blur / 组件卸载都走同一出口，保证
 * body 上的 cursor/userSelect 一定被还原、拖拽态一定被复位
 * （否则 capture 卡死后，所有 mousemove 都会被当成拖拽 —— 见 #592）。
 *
 * 纯点击（位移 ≤ 阈值）不触发 onDrag，onDragEnd 收到 null（#600）。
 */
import * as React from 'react'
import { cn } from '@/lib/utils'

export interface SplitterProps {
  orientation: 'vertical' | 'horizontal'
  onDrag: (clientCoord: number) => void
  onDragStart?: () => void
  /** 拖拽结束；clientCoord 为 null 表示指针未实际移动（纯点击），调用方不应据此改尺寸（#600） */
  onDragEnd?: (clientCoord: number | null) => void
  className?: string
  title?: string
}

/** 按下后位移超过该阈值（px）才视为拖拽，否则按纯点击处理（吸收点击时的 1-2px 抖动） */
const CLICK_MOVE_THRESHOLD_PX = 2

export function Splitter({
  orientation,
  onDrag,
  onDragStart,
  onDragEnd,
  className,
  title,
}: SplitterProps): React.ReactElement {
  const elementRef = React.useRef<HTMLDivElement | null>(null)
  const draggingRef = React.useRef(false)
  const pointerIdRef = React.useRef<number | null>(null)
  /** 最近一次指针坐标 —— blur / lostpointercapture 等无坐标的结束路径用它兜底 */
  const lastCoordRef = React.useRef<number | null>(null)
  /** 按下时的起始坐标，用于区分纯点击与拖拽 */
  const startCoordRef = React.useRef<number | null>(null)
  /** 本次手势是否产生过有效位移（超过阈值） */
  const movedRef = React.useRef(false)
  const frameRef = React.useRef<number | null>(null)
  const pendingCoordRef = React.useRef<number | null>(null)

  const flushPending = React.useCallback(() => {
    if (pendingCoordRef.current == null) return
    onDrag(pendingCoordRef.current)
    pendingCoordRef.current = null
  }, [onDrag])

  const scheduleDrag = React.useCallback((clientCoord: number) => {
    pendingCoordRef.current = clientCoord
    if (frameRef.current != null) return
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      flushPending()
    })
  }, [flushPending])

  /**
   * 拖拽结束的唯一出口（幂等）。
   * 顺序约束：先复位拖拽态 / 还原 body 样式，**最后**才释放 pointer capture ——
   * releasePointerCapture 在 capture 已失效时可能抛错，不能让它中断前面的清理。
   */
  const endDrag = React.useCallback((clientCoord: number | null): void => {
    if (!draggingRef.current) return
    draggingRef.current = false
    if (frameRef.current != null) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    const finalCoord = clientCoord ?? lastCoordRef.current
    pendingCoordRef.current = null
    // commitCoord 为 null 即纯点击（未越过位移阈值）：不提交坐标，
    // 避免调用方按点击坐标回算尺寸造成意外位移（#600）
    const commitCoord = movedRef.current && finalCoord != null ? finalCoord : null
    if (commitCoord != null) {
      onDrag(commitCoord)
    }
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    const el = elementRef.current
    const pointerId = pointerIdRef.current
    pointerIdRef.current = null
    if (el && pointerId != null) {
      try {
        if (el.hasPointerCapture(pointerId)) {
          el.releasePointerCapture(pointerId)
        }
      } catch {
        // capture 已被 UA 收回（如 pointercancel 之后），忽略
      }
    }
    onDragEnd?.(commitCoord)
  }, [onDrag, onDragEnd])

  // window blur / 卸载兜底走 ref，避免 blur 监听随 endDrag 重建反复增删
  const endDragRef = React.useRef(endDrag)
  React.useEffect(() => {
    endDragRef.current = endDrag
  }, [endDrag])

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    pointerIdRef.current = e.pointerId
    const coord = orientation === 'vertical' ? e.clientX : e.clientY
    lastCoordRef.current = coord
    startCoordRef.current = coord
    movedRef.current = false
    draggingRef.current = true
    onDragStart?.()
    document.body.style.userSelect = 'none'
    document.body.style.cursor = orientation === 'vertical' ? 'ew-resize' : 'ns-resize'
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!draggingRef.current) return
    const coord = orientation === 'vertical' ? e.clientX : e.clientY
    lastCoordRef.current = coord
    if (!movedRef.current) {
      const start = startCoordRef.current
      if (start == null || Math.abs(coord - start) <= CLICK_MOVE_THRESHOLD_PX) return
      movedRef.current = true
    }
    scheduleDrag(coord)
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    endDrag(orientation === 'vertical' ? e.clientX : e.clientY)
  }

  // mid-drag 失焦（cmd-tab / 原生窗口拖拽介入）时 Chromium 可能不再派发任何
  // pointer 事件，这里兜底结束拖拽；卸载时同样兜底清理
  React.useEffect(() => {
    const handleBlur = (): void => {
      endDragRef.current(null)
    }
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('blur', handleBlur)
      endDragRef.current(null)
    }
  }, [])

  return (
    <div
      ref={elementRef}
      role="separator"
      aria-orientation={orientation === 'vertical' ? 'vertical' : 'horizontal'}
      title={title}
      className={cn(
        'flex-shrink-0 bg-transparent hover:bg-primary/40 transition-colors',
        orientation === 'vertical'
          ? 'w-1 cursor-ew-resize h-full'
          : 'h-1 cursor-ns-resize w-full',
        className,
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onLostPointerCapture={() => endDrag(null)}
    />
  )
}
