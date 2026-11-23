/**
 * SearchDialog - 全局搜索 Dialog
 *
 * 浮动搜索面板，支持：
 * - 即时 Agent 会话标题匹配（纯前端过滤）
 * - 渐进式消息内容搜索（debounce 后 IPC 调用）
 * - 匹配文字高亮
 * - 键盘导航（上下箭头 + Enter + Esc）
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai'
import { Search, X, Bot, Archive, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { searchDialogOpenAtom, searchMessageTargetAtom } from '@/atoms/search-atoms'
import { agentSessionsAtom, currentAgentSessionIdAtom } from '@/atoms/agent-atoms'
import { activeViewAtom } from '@/atoms/active-view'
import { useOpenSession } from '@/hooks/useOpenSession'
import { useT } from '@/hooks/useT'
import type { AgentMessageSearchResult } from '@asci/shared'

interface TitleResult {
  id: string
  title: string
  archived?: boolean
  updatedAt: number
}

interface ContentResult {
  query: string
  messageId: string
  id: string
  title: string
  snippet: string
  matchStart: number
  matchLength: number
  archived?: boolean
}

function HighlightText({ text, query }: { text: string; query: string }): React.ReactElement {
  if (!query) return <>{text}</>

  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const parts: React.ReactNode[] = []
  let lastIndex = 0

  let idx = lowerText.indexOf(lowerQuery)
  while (idx !== -1) {
    if (idx > lastIndex) {
      parts.push(text.slice(lastIndex, idx))
    }
    parts.push(
      <mark key={idx} className="bg-primary/20 text-foreground rounded-sm px-0.5">
        {text.slice(idx, idx + query.length)}
      </mark>
    )
    lastIndex = idx + query.length
    idx = lowerText.indexOf(lowerQuery, lastIndex)
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return <>{parts}</>
}

function HighlightSnippet({ snippet, matchStart, matchLength }: {
  snippet: string
  matchStart: number
  matchLength: number
}): React.ReactElement {
  if (matchStart < 0 || matchStart >= snippet.length) return <>{snippet}</>

  const before = snippet.slice(0, matchStart)
  const match = snippet.slice(matchStart, matchStart + matchLength)
  const after = snippet.slice(matchStart + matchLength)

  return (
    <>
      {before}
      <mark className="bg-primary/20 text-foreground rounded-sm px-0.5">{match}</mark>
      {after}
    </>
  )
}

export function SearchDialog(): React.ReactElement {
  const { t } = useT('nav')
  const [open, setOpen] = useAtom(searchDialogOpenAtom)
  const agentSessions = useAtomValue(agentSessionsAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const openSession = useOpenSession()
  const store = useStore()
  React.useEffect(() => {
    if (!window.__TAURI_FORMAL__) return
    return store.sub(currentAgentSessionIdAtom, () => {
      const target = store.get(searchMessageTargetAtom)
      if (target && target.sessionId !== store.get(currentAgentSessionIdAtom)) store.set(searchMessageTargetAtom, null)
    })
  }, [store])

  const [query, setQuery] = React.useState('')
  const [searchQuery, setSearchQuery] = React.useState('')
  const [selectedIndex, setSelectedIndex] = React.useState(0)
  const [contentResults, setContentResults] = React.useState<ContentResult[]>([])
  const [contentLoading, setContentLoading] = React.useState(false)
  const [contentSearchFailed, setContentSearchFailed] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const locatingNativeResult = React.useRef(false)
  const isComposingRef = React.useRef(false)
  const commitTimerRef = React.useRef<ReturnType<typeof setTimeout>>()
  // 弹层定位：默认状态(空查询)垂直居中；一旦有结果让面板向下扩张,顶端不动。
  // open 时锁定首帧渲染后的 top 值(此时面板内仅 input + hint),后续结果增多
  // 走 height 增长而不是 translateY 重新居中。
  const [lockedTop, setLockedTop] = React.useState<number | null>(null)

  const commitSearchQuery = React.useCallback((value: string) => {
    clearTimeout(commitTimerRef.current)
    commitTimerRef.current = setTimeout(() => setSearchQuery(value), 60)
  }, [])

  const handleInputChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setQuery(value)
    if (!isComposingRef.current) {
      commitSearchQuery(value)
    }
  }, [commitSearchQuery])

  const handleCompositionStart = React.useCallback(() => {
    isComposingRef.current = true
  }, [])

  const handleCompositionEnd = React.useCallback((e: React.CompositionEvent<HTMLInputElement>) => {
    isComposingRef.current = false
    commitSearchQuery(e.currentTarget.value)
  }, [commitSearchQuery])

  const handleClearQuery = React.useCallback(() => {
    clearTimeout(commitTimerRef.current)
    setQuery('')
    setSearchQuery('')
  }, [])

  const titleResults = React.useMemo((): TitleResult[] => {
    if (!searchQuery) return []
    const q = searchQuery.toLowerCase()

    return agentSessions
      .filter((s) => s.title.toLowerCase().includes(q))
      .map((s) => ({ id: s.id, title: s.title, archived: s.archived, updatedAt: s.updatedAt }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 20)
  }, [searchQuery, agentSessions])

  React.useEffect(() => {
    setContentSearchFailed(false)
    if (!open || !searchQuery || searchQuery.length < 2) {
      setContentResults([])
      setContentLoading(false)
      return
    }

    setContentLoading(true)
    if (window.__TAURI_FORMAL__) setContentResults([])
    let cancelled = false

    const timer = setTimeout(async () => {
      try {
        const agentResults = await window.electronAPI.searchAgentSessionMessages(searchQuery)
        if (cancelled) return

        const titleIds = new Set(titleResults.map((t) => t.id))

        const agentContent: ContentResult[] = (agentResults as AgentMessageSearchResult[])
          .filter((r) => !titleIds.has(r.sessionId))
          .map((r) => ({
            id: r.sessionId,
            messageId: r.messageId,
            query: searchQuery,
            title: r.sessionTitle,
            snippet: r.snippet,
            matchStart: r.matchStart,
            matchLength: r.matchLength,
            archived: r.archived,
          }))

        setContentResults(agentContent)
      } catch (error) {
        if (cancelled) return
        console.error('[搜索] 内容搜索失败:', error)
        setContentResults([])
        setContentSearchFailed(Boolean(window.__TAURI_FORMAL__))
      } finally {
        if (!cancelled) setContentLoading(false)
      }
    }, 300)

    return () => { cancelled = true; clearTimeout(timer) }
  }, [open, searchQuery, titleResults])

  const allResults = React.useMemo(
    () => [...titleResults, ...contentResults.map((c) => ({ ...c, updatedAt: 0 }))],
    [titleResults, contentResults]
  )

  React.useEffect(() => {
    setSelectedIndex(0)
  }, [searchQuery])

  const navigateToResult = React.useCallback((result: TitleResult | ContentResult) => {
    // 输入与防抖查询之间的旧行仍可能收到 Enter 或点击。
    if (window.__TAURI_FORMAL__ && (isComposingRef.current || query !== searchQuery ||
      ('messageId' in result && result.query !== query))) return
    locatingNativeResult.current = Boolean(window.__TAURI_FORMAL__ && 'messageId' in result)
    setOpen(false)
    setActiveView('conversations')

    const session = agentSessions.find((s) => s.id === result.id)
    const title = session?.title ?? result.title
    openSession('agent', result.id, title)
    if (window.__TAURI_FORMAL__) {
      store.set(searchMessageTargetAtom, 'messageId' in result ? { sessionId: result.id, messageId: result.messageId } : null)
    }
  }, [setOpen, setActiveView, openSession, agentSessions, store, query, searchQuery])

  const handleKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    if (window.__TAURI_FORMAL__ && (isComposingRef.current || e.nativeEvent.isComposing)) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.min(prev + 1, allResults.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter' && allResults[selectedIndex]) {
      e.preventDefault()
      navigateToResult(allResults[selectedIndex]!)
    }
  }, [allResults, selectedIndex, navigateToResult])

  React.useEffect(() => {
    const list = listRef.current
    if (!list) return
    const selected = list.querySelector(`[data-index="${selectedIndex}"]`)
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  React.useEffect(() => {
    if (open) {
      if (window.__TAURI_FORMAL__) store.set(searchMessageTargetAtom, null)
      clearTimeout(commitTimerRef.current)
      setQuery('')
      setSearchQuery('')
      setContentResults([])
      setSelectedIndex(0)
      setLockedTop(null)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open, store])

  // open 后等首帧渲染（仅 input + hint 占位）完成,以"假设垂直居中"为锚算出 top 像素并锁住,
  // 后续结果增加只改面板高度,不改 top。
  //
  // 不能用 getBoundingClientRect().top:Radix 的 zoom-in-95 + slide-in-from-top-[48%]
  // 动画在首帧仍在进行中,读到的是被 transform 后的位置,会导致每次"打开 → 关闭"
  // 锁定的 top 逐次偏移(上次偏小的 top 又被作为下次居中起点,雪崩上飘)。
  // 改为数学求:(viewportHeight - panelHeight) / 2 = 真正居中的 top,完全脱离 transform。
  React.useLayoutEffect(() => {
    if (!open) return
    if (lockedTop !== null) return
    const raf = requestAnimationFrame(() => {
      const el = contentRef.current
      if (!el) return
      const h = el.offsetHeight
      if (h <= 0) return
      setLockedTop(Math.max(0, Math.round((window.innerHeight - h) / 2)))
    })
    return () => cancelAnimationFrame(raf)
  }, [open, lockedTop])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {(open || !locatingNativeResult.current) && <DialogContent
        ref={contentRef}
        onCloseAutoFocus={event => {
          // 原生正文命中将焦点交给消息，避免面板退出动画结束后又抢回侧栏。
          if (locatingNativeResult.current) event.preventDefault()
          locatingNativeResult.current = false
        }}
        hideClose
        // lockedTop 一旦读到首帧 top(此时空状态垂直居中),覆盖默认的
        // top-[50%] + translateY(-50%):translate-y-0 让面板从锁定 y 向下延伸,
        // 不再随高度变化重新居中。锁定前(open 当帧)保留 Radix 默认居中行为。
        className={cn(
          'sm:max-w-[560px] p-0 gap-0 overflow-hidden',
          lockedTop !== null && 'top-[var(--search-dialog-top)] translate-y-0',
        )}
        style={
          lockedTop !== null
            ? ({ '--search-dialog-top': `${lockedTop}px` } as React.CSSProperties)
            : undefined
        }
        onKeyDown={handleKeyDown}
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">{t('searchDialog.title')}</DialogTitle>
        <div className="flex items-center gap-2 px-4 py-3.5 border-b border-border/35">
          <Search size={16} className="text-muted-foreground flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={handleInputChange}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            placeholder={t('searchDialog.placeholder')}
            className="flex-1 bg-transparent text-[14px] text-foreground placeholder:text-muted-foreground outline-none"
          />
          {query && (
            <Button
              variant="ghost"
              onClick={handleClearQuery}
              className="h-auto p-1 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:!size-3.5"
            >
              <X size={14} />
            </Button>
          )}
          <kbd className="hidden sm:inline-flex items-center gap-0.5 px-2 py-1 rounded-md bg-muted text-sm text-muted-foreground">
            ESC
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[420px] overflow-y-auto scrollbar-thin px-2 py-1">
          {!query && (
            <div className="py-14 text-center text-sm text-muted-foreground">
              {t('searchDialog.hint')}
            </div>
          )}

          {contentSearchFailed && (
            <div role="status" className="py-4 px-2.5 text-sm text-muted-foreground">
              {t('searchDialog.contentUnavailable')}
            </div>
          )}
          {searchQuery && titleResults.length === 0 && contentResults.length === 0 && !contentLoading && !contentSearchFailed && (
            <div className="py-14 text-center text-sm text-muted-foreground">
              {t('searchDialog.noResults')}
            </div>
          )}

          {titleResults.length > 0 && (
            <div className="py-1 animate-in fade-in duration-150">
              <div className="px-2.5 pt-2 pb-1 text-sm font-medium text-muted-foreground select-none">
                {t('searchDialog.groupTitleMatch')}
              </div>
              {titleResults.map((result, idx) => (
                <Button
                  key={`title-${result.id}`}
                  variant="ghost"
                  size="row"
                  data-index={idx}
                  onClick={() => navigateToResult(result)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={cn(
                    'gap-2.5 rounded-xl px-3 font-normal',
                    selectedIndex === idx
                      ? 'bg-muted text-foreground'
                      : 'hover:bg-muted/70',
                    result.archived && 'opacity-60'
                  )}
                >
                  <Bot size={14} className="flex-shrink-0 text-muted-foreground !size-3.5" />
                  <span className="flex-1 min-w-0 truncate text-sm text-foreground/80">
                    <HighlightText text={result.title} query={searchQuery} />
                  </span>
                  {result.archived && (
                    <Archive size={12} className="flex-shrink-0 text-foreground/30 !size-3" />
                  )}
                </Button>
              ))}
            </div>
          )}

          {(contentResults.length > 0 || (contentLoading && searchQuery.length >= 2)) && (
            <div className="py-1 border-t border-border/25 animate-in fade-in duration-150">
              <div className="px-2.5 pt-2 pb-1 flex items-center gap-2 text-sm font-medium text-muted-foreground select-none">
                <span>{t('searchDialog.groupContentMatch')}</span>
                {contentLoading && <Loader2 size={12} className="animate-spin text-muted-foreground" />}
              </div>
              {contentResults.map((result, i) => {
                const globalIdx = titleResults.length + i
                return (
                  <Button
                    key={`content-${result.id}`}
                    variant="ghost"
                    size="row"
                    data-index={globalIdx}
                    onClick={() => navigateToResult(result)}
                    onMouseEnter={() => setSelectedIndex(globalIdx)}
                    className={cn(
                      'flex-col items-stretch gap-0.5 rounded-xl px-3 font-normal',
                      selectedIndex === globalIdx
                        ? 'bg-muted text-foreground'
                        : 'hover:bg-muted/70',
                      result.archived && 'opacity-60'
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      <Bot size={14} className="flex-shrink-0 text-muted-foreground !size-3.5" />
                      <span className="flex-1 min-w-0 truncate text-sm text-foreground/80">
                        {result.title}
                      </span>
                      {result.archived && (
                        <Archive size={12} className="flex-shrink-0 text-foreground/30 !size-3" />
                      )}
                    </div>
                    <div className="pl-[22px] text-sm text-foreground/50 truncate">
                      <HighlightSnippet
                        snippet={result.snippet}
                        matchStart={result.matchStart}
                        matchLength={result.matchLength}
                      />
                    </div>
                  </Button>
                )
              })}
            </div>
          )}
        </div>

        {allResults.length > 0 && (
          <div className="flex items-center gap-3 px-4 py-2.5 border-t border-border/25 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-muted">↑↓</kbd>
              <span>{t('searchDialog.footer.select')}</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-muted">↵</kbd>
              <span>{t('searchDialog.footer.open')}</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-muted">Esc</kbd>
              <span>{t('searchDialog.footer.close')}</span>
            </span>
          </div>
        )}
      </DialogContent>}
    </Dialog>
  )
}
