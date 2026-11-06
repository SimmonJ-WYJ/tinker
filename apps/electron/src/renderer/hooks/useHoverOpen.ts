/**
 * useHoverOpen — hover 触发 Popover/DropdownMenu 开关 + 关闭宽限期
 *
 * 鼠标从 trigger 越过空隙抵达 content 的瞬间会触发 trigger 的 mouseleave，
 * 没有宽限期 (delay) 会导致菜单刚浮出就被关掉。
 */
import * as React from 'react'

const DEFAULT_CLOSE_DELAY_MS = 150

interface HoverHandlers {
  onMouseEnter: () => void
  onMouseLeave: () => void
}

export interface UseHoverOpenResult {
  open: boolean
  setOpen: React.Dispatch<React.SetStateAction<boolean>>
  triggerHandlers: HoverHandlers
  contentHandlers: HoverHandlers
}

export function useHoverOpen(closeDelayMs: number = DEFAULT_CLOSE_DELAY_MS): UseHoverOpenResult {
  const [open, setOpen] = React.useState(false)
  const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelClose = React.useCallback((): void => {
    if (closeTimerRef.current != null) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }, [])

  const scheduleClose = React.useCallback((): void => {
    cancelClose()
    closeTimerRef.current = setTimeout(() => setOpen(false), closeDelayMs)
  }, [cancelClose, closeDelayMs])

  React.useEffect(() => cancelClose, [cancelClose])

  const triggerHandlers = React.useMemo<HoverHandlers>(
    () => ({
      onMouseEnter: () => {
        cancelClose()
        setOpen(true)
      },
      onMouseLeave: scheduleClose,
    }),
    [cancelClose, scheduleClose],
  )

  const contentHandlers = React.useMemo<HoverHandlers>(
    () => ({
      onMouseEnter: cancelClose,
      onMouseLeave: scheduleClose,
    }),
    [cancelClose, scheduleClose],
  )

  return { open, setOpen, triggerHandlers, contentHandlers }
}
