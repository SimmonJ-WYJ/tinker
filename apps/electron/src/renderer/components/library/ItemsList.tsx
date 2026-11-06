/**
 * ItemsList - 文献库中栏
 *
 * 顶部搜索框（debounced）+ 下方 items 列表 + 底部"加载更多"按钮。
 * query 非空时走 searchItems（忽略当前选中 collection），
 * query 空时走 getCollectionItems（按当前选中 collection）。
 */

import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { Search, Loader2, Inbox, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  librarySearchQueryAtom,
  librarySelectedCollectionKeyAtom,
  librarySelectedItemKeyAtom,
  libraryItemsAtom,
  libraryItemsHasMoreAtom,
  libraryItemsLoadedCountAtom,
  libraryLoadingItemsAtom,
} from '@/atoms/library-atoms'
import { shouldIgnoreKeyboardEvent } from '@/components/preview/preview-sibling-helpers'
import { useT } from '@/hooks/useT'
import { sanitizeText } from '@asci/shared'
import type { ItemSummary } from '@asci/core/zotero'

const PAGE_SIZE = 100
const DEBOUNCE_MS = 300

export function ItemsList(): React.ReactElement {
  const { t } = useT('library')
  const [query, setQuery] = useAtom(librarySearchQueryAtom)
  const selectedCollectionKey = useAtomValue(librarySelectedCollectionKeyAtom)
  const [selectedItemKey, setSelectedItemKey] = useAtom(librarySelectedItemKeyAtom)
  const [items, setItems] = useAtom(libraryItemsAtom)
  const [hasMore, setHasMore] = useAtom(libraryItemsHasMoreAtom)
  const [loadedCount, setLoadedCount] = useAtom(libraryItemsLoadedCountAtom)
  const [loading, setLoading] = useAtom(libraryLoadingItemsAtom)
  const [inputValue, setInputValue] = React.useState(query)

  /** debounce input → query */
  React.useEffect(() => {
    const timer = setTimeout(() => { setQuery(inputValue) }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [inputValue, setQuery])

  /**
   * 保留 selectedItemKey 的最新值给加载 effect 用 —— 不进 effect 的依赖（否则
   * 每次切选会重拉列表）。下面的键盘导航 effect 也复用同一份 ref（见后面 selectedRef）。
   */
  const selectedItemKeyForLoadRef = React.useRef(selectedItemKey)
  React.useEffect(() => { selectedItemKeyForLoadRef.current = selectedItemKey }, [selectedItemKey])

  /** 加载第一页（query 或 selectedCollectionKey 变化时） */
  React.useEffect(() => {
    let cancelled = false
    const loadFirstPage = async (): Promise<void> => {
      setLoading(true)
      // 注意：不在这里 setSelectedItemKey(null) —— 否则跨视图跳转（NotesView "Open in library"）
      // 设的 key 会被冲掉。先 load 完，再按"目标 item 是否在新列表里"决定是否清。
      try {
        const result = query.trim().length > 0
          ? await window.electronAPI.zotero.library.searchItems({ query, limit: PAGE_SIZE, offset: 0 })
          : await window.electronAPI.zotero.library.getCollectionItems({ collectionKey: selectedCollectionKey, limit: PAGE_SIZE, offset: 0 })
        if (cancelled) return
        setItems(result)
        setLoadedCount(result.length)
        setHasMore(result.length === PAGE_SIZE)
        // 切 collection / 搜索后，若原选中 item 不在新列表里则清空；保留跨视图跳转设的 key
        // （那种情况下 key 一般刚刚通过外部 setSelectedItemKey 写入，且对应 item 通常会出现在 result 里）
        const currentKey = selectedItemKeyForLoadRef.current
        if (currentKey && !result.some((it) => it.key === currentKey)) {
          setSelectedItemKey(null)
        }
      } catch (err) {
        if (cancelled) return
        console.error('[文献库] 加载 items 失败:', err)
        setItems([])
        setHasMore(false)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadFirstPage()
    return () => { cancelled = true }
  }, [query, selectedCollectionKey, setItems, setHasMore, setLoadedCount, setLoading, setSelectedItemKey])

  /**
   * 键盘 ↑/↓ 在已加载条目间切换选中（无 UI；与 InlinePreview sibling 导航同款守卫）。
   * 输入控件聚焦 → 跳过；越界 preventDefault 静默不动。
   * 用 ref 保最新值，避免每次 items/selectedItemKey 变化都重挂 listener。
   */
  const itemsRef = React.useRef(items)
  const selectedRef = React.useRef(selectedItemKey)
  React.useEffect(() => { itemsRef.current = items }, [items])
  React.useEffect(() => { selectedRef.current = selectedItemKey }, [selectedItemKey])
  React.useEffect(() => {
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
      const list = itemsRef.current
      if (!list || list.length === 0) return
      if (shouldIgnoreKeyboardEvent(e.target)) return
      const currentKey = selectedRef.current
      const currentIdx = currentKey ? list.findIndex((it) => it.key === currentKey) : -1
      const delta = e.key === 'ArrowUp' ? -1 : 1
      const nextIdx = currentIdx < 0
        ? (delta === 1 ? 0 : list.length - 1)
        : currentIdx + delta
      if (nextIdx < 0 || nextIdx >= list.length) {
        e.preventDefault()
        return
      }
      e.preventDefault()
      const target = list[nextIdx]
      if (!target) return
      setSelectedItemKey(target.key)
      requestAnimationFrame(() => {
        document
          .querySelector(`[data-item-key="${target.key}"]`)
          ?.scrollIntoView({ block: 'nearest' })
      })
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [setSelectedItemKey])

  /** 加载更多 */
  const handleLoadMore = async (): Promise<void> => {
    if (!items || loading || !hasMore) return
    setLoading(true)
    try {
      const result = query.trim().length > 0
        ? await window.electronAPI.zotero.library.searchItems({ query, limit: PAGE_SIZE, offset: loadedCount })
        : await window.electronAPI.zotero.library.getCollectionItems({ collectionKey: selectedCollectionKey, limit: PAGE_SIZE, offset: loadedCount })
      setItems([...items, ...result])
      setLoadedCount(loadedCount + result.length)
      setHasMore(result.length === PAGE_SIZE)
    } catch (err) {
      console.error('[文献库] 加载更多失败:', err)
      setHasMore(false)
    } finally {
      setLoading(false)
    }
  }

  const hasItems = items !== null && items.length > 0
  const isSearching = query.trim().length > 0

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 顶部搜索栏 */}
      <div className="sticky top-0 z-10 px-3 pt-4 pb-3 bg-background/95 backdrop-blur-sm border-b border-border/40 titlebar-drag-region">
        <div className="relative titlebar-no-drag">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder={t('search.placeholder')}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            className="pl-9 h-9 text-sm bg-muted/30 border-transparent focus-visible:bg-background focus-visible:border-border"
          />
        </div>
        {hasItems && (
          <div className="mt-2.5 px-1 text-sm text-muted-foreground/80">
            {isSearching ? t('list.searchResults') : t('list.currentCollection')}
            {t('list.countSuffix', { count: items.length, plus: hasMore ? '+' : '' })}
          </div>
        )}
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-auto scrollbar-thin">
        {items === null ? (
          <ListLoader />
        ) : items.length === 0 ? (
          <EmptyList query={query} />
        ) : (
          <>
            <ul className="px-2 py-1.5 space-y-px">
              {items.map((item) => (
                <ItemRow
                  key={item.key}
                  item={item}
                  selected={selectedItemKey === item.key}
                  onClick={() => setSelectedItemKey(item.key)}
                />
              ))}
            </ul>
            {hasMore && (
              <div className="px-3 py-3 flex justify-center">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleLoadMore}
                  disabled={loading}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {loading ? <Loader2 size={13} className="animate-spin" /> : <ChevronDown size={13} />}
                  <span>{t('list.loadMore')}</span>
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

interface ItemRowProps {
  item: ItemSummary
  selected: boolean
  onClick: () => void
}

function ItemRow({ item, selected, onClick }: ItemRowProps): React.ReactElement {
  const { t } = useT('library')
  const firstCreator = item.creators[0] ?? ''
  const extraCreators = item.creators.length > 1
    ? t('list.creatorsExtra', { count: item.creators.length })
    : ''
  const creatorText = firstCreator
    ? extraCreators ? `${firstCreator} ${extraCreators}` : firstCreator
    : ''
  const year = item.date?.match(/\d{4}/)?.[0] ?? ''
  const sub = [creatorText, year].filter(Boolean).join(' · ')

  return (
    <li
      data-item-key={item.key}
      className={cn(
        'px-3 py-2.5 rounded-md cursor-pointer transition-colors group',
        selected ? 'bg-primary/10' : 'hover:bg-muted/40',
      )}
      onClick={onClick}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-asci-zotero-item', JSON.stringify({
          itemKey: item.key,
          title: sanitizeText(item.title),
          creators: item.creators,
          date: item.date,
        }))
        e.dataTransfer.effectAllowed = 'copy'
      }}
    >
      <div className={cn(
        'text-sm leading-snug line-clamp-2',
        selected ? 'text-primary font-medium' : 'text-foreground',
      )}>
        {sanitizeText(item.title)}
      </div>
      {sub && (
        <div className="text-xs text-muted-foreground mt-1 truncate">{sub}</div>
      )}
      {item.tags.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {item.tags.slice(0, 3).map((t) => (
            <span
              key={t}
              className="inline-block text-sm px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground"
            >
              {t}
            </span>
          ))}
          {item.tags.length > 3 && (
            <span className="text-sm text-muted-foreground/70 self-center">
              +{item.tags.length - 3}
            </span>
          )}
        </div>
      )}
    </li>
  )
}

function ListLoader(): React.ReactElement {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="animate-spin text-muted-foreground" size={20} />
    </div>
  )
}

function EmptyList({ query }: { query: string }): React.ReactElement {
  const { t } = useT('library')
  return (
    <div className="flex flex-col items-center text-center gap-3 px-8 py-16 text-muted-foreground">
      <Inbox size={36} strokeWidth={1.5} className="text-muted-foreground/40" />
      <p className="text-sm">
        {query.trim().length > 0 ? t('list.emptySearch') : t('list.emptyCollection')}
      </p>
    </div>
  )
}
