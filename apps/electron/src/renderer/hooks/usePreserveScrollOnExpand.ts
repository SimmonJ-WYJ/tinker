/**
 * 展开/折叠 conversation 内嵌块时锁定 scrollTop，避免 use-stick-to-bottom
 * 检测到内容高度增加后把视口动画到新底部、覆盖用户原本看的位置。
 *
 * 使用方式：
 *   const [expanded, setExpanded] = React.useState(false)
 *   const { snapshot } = usePreserveScrollOnExpand(expanded)
 *   <button onClick={() => { snapshot(); setExpanded(v => !v) }}>...</button>
 *
 * 仅可在 <Conversation> (StickToBottom) 子树内调用；树外会抛错。
 */
import * as React from 'react'
import { useStickToBottomContext } from 'use-stick-to-bottom'

interface PreserveScrollHandle {
  /** 在 onClick 触发 setExpanded 之前同步调用一次，抓取当前 scrollTop。 */
  snapshot: () => void
}

export function usePreserveScrollOnExpand(expanded: boolean): PreserveScrollHandle {
  const { scrollRef, stopScroll } = useStickToBottomContext()
  const snapshotRef = React.useRef<number | null>(null)
  const prevExpandedRef = React.useRef(expanded)

  const snapshot = React.useCallback(() => {
    const el = scrollRef.current
    if (el) snapshotRef.current = el.scrollTop
  }, [scrollRef])

  React.useLayoutEffect(() => {
    if (prevExpandedRef.current === expanded) return
    prevExpandedRef.current = expanded
    const snap = snapshotRef.current
    const el = scrollRef.current
    if (snap === null || !el) return
    // 取消 lib 已排程的 spring 滚动，否则下帧仍会被 spring tick 推走
    stopScroll()
    el.scrollTop = snap
    // ResizeObserver 在下一帧通过 scrollToBottom rAF chain 再次追底；
    // 排程一次复检写回以覆盖该二次追底
    const raf = requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = snap
      snapshotRef.current = null
    })
    return () => cancelAnimationFrame(raf)
  }, [expanded, scrollRef, stopScroll])

  return { snapshot }
}
