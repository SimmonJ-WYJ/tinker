/** 引用跳转独立于“回到最新消息”，保存阅读锚点，避免流式吸底覆盖用户位置。 */
import * as React from 'react'
import { ArrowDownLeft } from 'lucide-react'
import { useStickToBottomContext } from 'use-stick-to-bottom'
import { Button } from '@/components/ui/button'
import { useT } from '@/hooks/useT'

interface Navigation {
  jump: (id: string, trigger?: HTMLElement) => boolean
  hasSource: (id: string) => boolean
}
export interface ReferenceNavigationTarget { groupId: string; sourceIds: string[] }
interface ReadingPosition { top: number; anchorId?: string; offset: number; trigger?: HTMLElement }
const NavigationContext = React.createContext<Navigation | null>(null)
export function useMessageReferenceNavigation(): Navigation | null { return React.useContext(NavigationContext) }

export function MessageReferenceNavigation({ children, sessionId, targets }: {
  children: React.ReactNode; sessionId: string; targets: ReferenceNavigationTarget[]
}): React.ReactElement {
  const { t } = useT('common')
  const { scrollRef, stopScroll } = useStickToBottomContext()
  const positions = React.useRef<ReadingPosition[]>([])
  const highlighted = React.useRef<HTMLElement | null>(null)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const [depth, setDepth] = React.useState(0)
  const [located, setLocated] = React.useState(false)
  const sources = React.useMemo(() => {
    const map = new Map<string, string | undefined>()
    for (const target of targets) for (const id of new Set(target.sourceIds)) {
      map.set(id, map.has(id) && map.get(id) !== target.groupId ? undefined : target.groupId)
    }
    return map
  }, [targets])

  const clearHighlight = React.useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    highlighted.current?.removeAttribute('data-reference-highlighted')
    highlighted.current = null
  }, [])

  React.useEffect(() => {
    positions.current = []; setDepth(0); setLocated(false); clearHighlight()
    return clearHighlight
  }, [sessionId, clearHighlight])

  React.useEffect(() => {
    const root = scrollRef.current
    if (!root) return
    const interrupt = (): void => { clearHighlight(); setLocated(false) }
    const keyboard = (event: KeyboardEvent): void => {
      const element = event.target as HTMLElement | null
      if (element?.closest('input,textarea,[contenteditable=true]')) return
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) interrupt()
    }
    root.addEventListener('wheel', interrupt, { passive: true }); root.addEventListener('touchmove', interrupt, { passive: true }); root.addEventListener('keydown', keyboard)
    return () => { root.removeEventListener('wheel', interrupt); root.removeEventListener('touchmove', interrupt); root.removeEventListener('keydown', keyboard) }
  }, [sessionId, scrollRef, clearHighlight])

  const find = React.useCallback((id: string): HTMLElement | undefined => {
    return Array.from(scrollRef.current?.querySelectorAll<HTMLElement>('[data-message-id]') ?? []).find(element => element.dataset.messageId === id)
  }, [scrollRef])
  const move = React.useCallback((top: number) => {
    const root = scrollRef.current
    if (!root) return
    stopScroll()
    const bounded = Math.max(0, Math.min(top, root.scrollHeight - root.clientHeight))
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true
    if (typeof root.scrollTo === 'function') root.scrollTo({ top: bounded, behavior: reduced ? 'instant' : 'smooth' })
    else root.scrollTop = bounded
  }, [scrollRef, stopScroll])

  const jump = React.useCallback((id: string, trigger?: HTMLElement): boolean => {
    const groupId = sources.get(id)
    const root = scrollRef.current
    const target = groupId ? find(groupId) : undefined
    if (!root || !target) return false
    const viewport = root.getBoundingClientRect()
    const destination = root.scrollTop + target.getBoundingClientRect().top - viewport.top - 24
    // 连点当前来源只刷新高亮，不叠加“返回”层；离开来源后可再次记录新阅读位置。
    const boundedDestination = Math.max(0, Math.min(destination, root.scrollHeight - root.clientHeight))
    if (highlighted.current !== target && (positions.current.length === 0 || Math.abs(root.scrollTop - boundedDestination) > 2)) {
      const anchor = Array.from(root.querySelectorAll<HTMLElement>('[data-message-id]')).find(element => element.getBoundingClientRect().bottom > viewport.top)
      positions.current.push({ top: root.scrollTop, anchorId: anchor?.dataset.messageId, offset: anchor ? anchor.getBoundingClientRect().top - viewport.top : 0, trigger })
      setDepth(positions.current.length)
    }
    clearHighlight()
    target.setAttribute('data-reference-highlighted', 'true'); highlighted.current = target
    timer.current = setTimeout(() => { clearHighlight(); setLocated(false) }, 1800)
    setLocated(true); move(destination); target.focus({ preventScroll: true })
    return true
  }, [sources, scrollRef, find, clearHighlight, move])

  const back = React.useCallback(() => {
    const previous = positions.current.pop()
    const root = scrollRef.current
    if (!previous || !root) return
    clearHighlight(); setLocated(false)
    const anchor = previous.anchorId ? find(previous.anchorId) : undefined
    const top = anchor ? root.scrollTop + anchor.getBoundingClientRect().top - root.getBoundingClientRect().top - previous.offset : previous.top
    move(top); setDepth(positions.current.length)
    if (previous.trigger?.isConnected) previous.trigger.focus({ preventScroll: true })
  }, [scrollRef, clearHighlight, find, move])

  const navigation = React.useMemo<Navigation>(() => ({ jump, hasSource: id => sources.get(id) !== undefined }), [jump, sources])
  return <NavigationContext.Provider value={navigation}>
    {children}
    <span role="status" aria-live="polite" className="sr-only">{located ? t('imageReference.located') : ''}</span>
    {depth > 0 && <Button type="button" variant="outline" className="conversation-reference-return" onClick={back} aria-label={t('imageReference.returnReading')}><ArrowDownLeft aria-hidden="true" />{t('imageReference.returnReading')}</Button>}
  </NavigationContext.Provider>
}
