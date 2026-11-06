/**
 * AtMentionPanel — @ 触发的层级导航下拉面板（面包屑 + 单列表）
 *
 * 职责：纯渲染 + 键位分发，所有数据（items / 面包屑 / status）由 suggestion 层传入。
 * 键位：↑↓ 移动高亮；→ 触发 onDrill（父决定插入还是下钻）；← 返回上级（根层关闭）；
 *      Enter 触发 onEnter（父决定）；Esc 关闭。
 * Zotero 三态占位仅在 level.kind === 'library-root' 时展示。
 */

import * as React from 'react'
import { AlertCircle, BookOpen, ChevronLeft, ChevronRight, FileText, Folder, Layers, Play, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useT } from '@/hooks/useT'
import type { FileIndexEntry, EvidenceSetSummary } from '@asci/shared'
import type { ItemSummary } from '@asci/core/zotero'
import type { CollectionWithPath, AtMentionLevel } from './at-mention-helpers.ts'
import { toDrillTarget } from './at-mention-helpers.ts'
import { KeyboardHintFooter, type KeyboardHint } from './choice/KeyboardHintFooter.tsx'

export type AtMentionItem =
  // sourcePath：用于 UI 展示文件来源的绝对路径（工作区文件由 wsPath 拼出，附加目录文件本就是绝对路径）；
  // entry.path 保持相对，仍作为 mention 的 id 注入，二者职责分离。
  | { kind: 'file'; entry: FileIndexEntry; sourcePath?: string }
  | { kind: 'zotero-col'; col: CollectionWithPath }
  | { kind: 'zotero-item'; item: ItemSummary }
  | {
      kind: 'category'
      target: 'project-files' | 'library-root' | 'evidence-set-list'
      labelKey: string
      icon?: 'folder' | 'book' | 'layers'
    }
  | { kind: 'library-all-items'; labelKey: string }
  | { kind: 'evidence-set'; set: EvidenceSetSummary }

/** 面包屑节点：i18n key 走 t() 解析，literal（如 collection 路径）原样显示 */
export type AtMentionBreadcrumbItem =
  | { kind: 'i18n'; key: string }
  | { kind: 'literal'; text: string }

/** 根层条目描述行的语义化描述，由 panel 用 i18n 解析。 */
export type AtMentionRootHint =
  | { kind: 'i18n'; key: string; vars?: Record<string, string | number> }
  | { kind: 'i18nCount'; key: string; count: number; vars?: Record<string, string | number> }
  | { kind: 'literal'; text: string }

export interface AtMentionStatus {
  zoteroEnabled: boolean
  zoteroRunning: boolean
  /** 非空时在对应层级 body 显示（已是带前缀的本地化字符串） */
  zoteroError?: string
}

export interface AtMentionPanelProps {
  level: AtMentionLevel
  items: AtMentionItem[]
  /**
   * 当前查询串（用户在 @ 后输入的文本）。TipTap 在编辑器内捕获击键，
   * 此处仅回显到搜索栏让它读起来像搜索框（非真实 input，避免抢焦点破坏键位）。
   */
  query: string
  /** 面包屑标签列表（根 → 当前层），i18n key 或字面量混合 */
  breadcrumb: AtMentionBreadcrumbItem[]
  status: AtMentionStatus
  /**
   * library-root 在用户无自建 collection 时直接渲染顶层条目（跳过"全部条目"中转）。
   * 此标志用于切换搜索框/键位提示文案，使其与实际语义一致。
   */
  libraryRootInlineItems?: boolean
  /** 根层（level.kind === 'root'）下各条目的描述行文案；非根层忽略。 */
  rootHints?: { projectFiles: AtMentionRootHint; library: AtMentionRootHint; evidenceSet: AtMentionRootHint }
  /** Enter / 鼠标点击：父按 item.kind 决定插入还是下钻 */
  onEnter: (item: AtMentionItem) => void
  /** → 键：叶子视为 insert、分支视为下钻（父决定） */
  onDrill: (item: AtMentionItem) => void
  /** ← 键；根层由父转为 onClose */
  onBack: () => void
  /** Esc */
  onClose: () => void
  /** 点击中间面包屑跳跃到对应层（index = 栈下标） */
  onBreadcrumbJump?: (levelIndex: number) => void
  onLaunchZotero?: () => void
  /** 高亮 index 变化时回调，让 suggestion 把它写回 lastNavState 以便层间持久化。 */
  onIndexChange?: (idx: number) => void
}

export interface AtMentionPanelRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

/** 类目图标 key → lucide 组件（root 入口 + 子层标题共用）。 */
function categoryIcon(icon?: 'folder' | 'book' | 'layers'): typeof Folder {
  if (icon === 'book') return BookOpen
  if (icon === 'layers') return Layers
  return Folder
}

export const AtMentionPanel = React.forwardRef<AtMentionPanelRef, AtMentionPanelProps>(
  function AtMentionPanel(
    {
      level,
      items,
      query,
      breadcrumb,
      status,
      onEnter,
      onDrill,
      onBack,
      onClose,
      onBreadcrumbJump,
      onLaunchZotero,
      libraryRootInlineItems = false,
      rootHints,
      onIndexChange,
    },
    ref,
  ) {
    const { t } = useT('conversation')
    // 动态 key 包装：descriptor 携带的 key 是运行时拼出的字符串，typed t() 仅接受字面量联合，
    // 这里用单点 cast 旁路类型层（key 由本组件控制，运行期一定命中已声明 key）。
    const tDyn = t as unknown as (key: string, options?: Record<string, string | number>) => string
    const [localIndex, setLocalIndex] = React.useState(level.index ?? 0)
    const [pdfItemKeys, setPdfItemKeys] = React.useState<ReadonlySet<string>>(() => new Set())
    const containerRef = React.useRef<HTMLDivElement>(null)

    const renderHint = React.useCallback((hint: AtMentionRootHint | undefined): string | undefined => {
      if (!hint) return undefined
      if (hint.kind === 'literal') return hint.text
      if (hint.kind === 'i18nCount') return tDyn(hint.key, { count: hint.count, ...(hint.vars ?? {}) })
      return tDyn(hint.key, hint.vars)
    }, [tDyn])

    const renderBreadcrumbLabel = React.useCallback(
      (item: AtMentionBreadcrumbItem): string => (item.kind === 'literal' ? item.text : tDyn(item.key)),
      [tDyn],
    )

    // 层级切换时从 level.index 恢复（这样 ← 返回会保留之前的高亮位置）；
    // 同层内 items 变化（如搜索过滤）则重置到 0，避免高亮指向已不存在的下标。
    const levelKey = `${level.kind}:${level.collectionKey ?? ''}`
    const lastLevelKeyRef = React.useRef<string | null>(null)
    React.useEffect(() => {
      if (lastLevelKeyRef.current !== levelKey) {
        lastLevelKeyRef.current = levelKey
        setLocalIndex(level.index ?? 0)
        return
      }
      setLocalIndex(0)
      // level.index 仅在层级切换时使用，故有意不放进 deps
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [items, levelKey])

    // 把 localIndex 写回 suggestion 层（仅 ↑↓ 改变后才生效，初次为 noop）
    React.useEffect(() => {
      onIndexChange?.(localIndex)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [localIndex])

    React.useEffect(() => {
      const el = containerRef.current?.children[localIndex] as HTMLElement | undefined
      el?.scrollIntoView({ block: 'nearest' })
    }, [localIndex])

    React.useEffect(() => {
      const zoteroItems = items.filter((item) => item.kind === 'zotero-item')
      if (zoteroItems.length === 0) {
        setPdfItemKeys(new Set())
        return
      }

      let cancelled = false
      void (async () => {
        const found = new Set<string>()
        await Promise.all(zoteroItems.map(async (item) => {
          try {
            const result = await window.electronAPI.zotero.library.getAttachmentPath({ itemKey: item.item.key })
            if (result.found) found.add(item.item.key)
          } catch {
            // 弹窗里的 PDF 标记是辅助信息，失败时保持无标记。
          }
        }))
        if (!cancelled) setPdfItemKeys(found)
      })()

      return () => { cancelled = true }
    }, [items])

    React.useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === 'ArrowUp') {
          setLocalIndex((p) => (p <= 0 ? Math.max(items.length - 1, 0) : p - 1))
          return true
        }
        if (event.key === 'ArrowDown') {
          setLocalIndex((p) => (p >= items.length - 1 ? 0 : p + 1))
          return true
        }
        if (event.key === 'ArrowRight') {
          if (items.length === 0) return false
          const it = items[localIndex]
          if (it) onDrill(it)
          event.preventDefault()
          return true
        }
        if (event.key === 'ArrowLeft') {
          onBack()
          event.preventDefault()
          return true
        }
        if (event.key === 'Enter') {
          if (items.length === 0) return false
          const it = items[localIndex]
          if (it) onEnter(it)
          return true
        }
        if (event.key === 'Escape') {
          onClose()
          return true
        }
        return false
      },
    }))

    const renderRow = (item: AtMentionItem, idx: number): React.ReactNode => {
      const base = cn(
        'text-xs',
        idx === localIndex
          ? 'bg-accent text-accent-foreground'
          : 'hover:bg-accent/40 hover:text-foreground',
      )
      // 可下钻项统一末尾挂 ChevronRight（叶子不挂）。
      const chevron =
        toDrillTarget(item) !== null ? (
          <ChevronRight className="size-3 text-muted-foreground/50 flex-shrink-0" />
        ) : null

      if (item.kind === 'file') {
        // 项目文件递归扫描会同时返回目录（如 lit-search 产出的 searches/）；
        // 目录用文件夹图标区分，引用语义见 referenced-directory-block.ts。
        const FileIcon = item.entry.type === 'dir' ? Folder : FileText
        return (
          <Button
            key={`f:${item.entry.path}`}
            type="button"
            variant="list"
            size="row"
            className={base}
            onClick={() => onEnter(item)}
          >
            <FileIcon className={cn('size-4 flex-shrink-0', item.entry.type === 'dir' ? 'text-warning' : 'text-muted-foreground')} />
            <span className="truncate flex-1 text-sm">{item.entry.name}</span>
            {item.sourcePath && item.sourcePath !== item.entry.name && (
              <span
                className="text-sm text-muted-foreground/60 truncate max-w-[180px]"
                title={item.sourcePath}
              >
                {item.sourcePath}
              </span>
            )}
          </Button>
        )
      }
      if (item.kind === 'zotero-col') {
        // 树形缩进：depth 决定左缩进，省去父路径副标题（层级由缩进表达）。
        // 缩进 spacer 与 ZoteroCollectionTree 同源（每层 0.875rem）。
        return (
          <Button
            key={`c:${item.col.key}`}
            type="button"
            variant="list"
            size="row"
            className={base}
            onClick={() => onEnter(item)}
            title={item.col.path}
          >
            {item.col.depth > 0 && (
              <span className="shrink-0" style={{ width: `${item.col.depth * 0.875}rem` }} aria-hidden />
            )}
            <Folder className="size-4 text-warning flex-shrink-0" />
            <span className="truncate flex-1 text-sm">{item.col.name}</span>
            {chevron}
          </Button>
        )
      }
      if (item.kind === 'zotero-item') {
        const year = item.item.date?.match(/\d{4}/)?.[0]
        const creatorCount = item.item.creators.length
        const firstCreator = item.item.creators[0]
        const creatorText = firstCreator
          ? creatorCount > 1
            ? t('atMention.creators.andOthers', { first: firstCreator, count: creatorCount })
            : firstCreator
          : ''
        const byline = [creatorText, year].filter(Boolean).join(' · ')
        const hasPdf = pdfItemKeys.has(item.item.key)
        return (
          <Button
            key={`i:${item.item.key}`}
            type="button"
            variant="list"
            size="row"
            className={cn(base, 'whitespace-normal')}
            onClick={() => onEnter(item)}
          >
            <BookOpen className="size-4 text-primary flex-shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 text-sm leading-snug">{item.item.title}</span>
              {byline && (
                <span className="mt-0.5 block truncate text-sm text-muted-foreground/70">
                  {byline}
                </span>
              )}
            </span>
            {(hasPdf || byline) && (
              <span className={cn(
                'hidden md:inline-flex shrink-0 rounded px-1.5 py-0.5 text-sm',
                hasPdf
                  ? 'bg-success/10 text-success'
                  : 'bg-muted/60 text-muted-foreground',
              )}>
                {hasPdf ? 'PDF' : 'Zotero'}
              </span>
            )}
          </Button>
        )
      }
      if (item.kind === 'evidence-set') {
        const subtitle = item.set.notePreview?.trim()
          ? item.set.notePreview
          : t('atMention.evidenceSet.paperCount', { count: item.set.paperCount })
        return (
          <Button
            key={`es:${item.set.id}`}
            type="button"
            variant="list"
            size="row"
            className={base}
            onClick={() => onEnter(item)}
          >
            <Layers className="size-4 text-primary flex-shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {item.set.name ?? t('atMention.evidenceSet.untitled')}
              </span>
              <span className="block truncate text-sm text-muted-foreground/65">
                {subtitle}
              </span>
            </span>
          </Button>
        )
      }
      if (item.kind === 'category') {
        const Icon = categoryIcon(item.icon)
        return (
          <Button
            key={`cat:${item.target}`}
            type="button"
            variant="list"
            size="row"
            className={base}
            onClick={() => onEnter(item)}
          >
            <Icon className="size-4 text-primary flex-shrink-0" />
            <span className="truncate flex-1 text-sm">{tDyn(item.labelKey)}</span>
            {chevron}
          </Button>
        )
      }
      // library-all-items
      return (
        <Button
          key="lib-all"
          type="button"
          variant="list"
          size="row"
          className={base}
          onClick={() => onEnter(item)}
        >
          <BookOpen className="size-4 text-primary flex-shrink-0" />
          <span className="truncate flex-1 text-sm">{tDyn(item.labelKey)}</span>
          {chevron}
        </Button>
      )
    }

    const renderBreadcrumb = (): React.ReactNode => {
      if (breadcrumb.length === 0) return null
      return (
        <div className="flex items-center gap-1 px-3 py-2 border-b text-sm text-muted-foreground">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="-ml-1 flex-shrink-0 rounded hover:text-foreground"
            onClick={onBack}
            aria-label={t('atMention.breadcrumb.back')}
          >
            <ChevronLeft className="!size-3.5" />
          </Button>
          {breadcrumb.map((crumb, i) => {
            const isLast = i === breadcrumb.length - 1
            const label = renderBreadcrumbLabel(crumb)
            const reactKey = `${i}:${crumb.kind === 'literal' ? crumb.text : crumb.key}`
            return (
              <React.Fragment key={reactKey}>
                {i > 0 && <ChevronRight className="size-2.5 opacity-50" />}
                {isLast ? (
                  <span className="text-foreground font-medium truncate max-w-[280px]">
                    {label}
                  </span>
                ) : (
                  <Button
                    type="button"
                    variant="subtle"
                    size="inline"
                    className="truncate max-w-[160px]"
                    onClick={() => onBreadcrumbJump?.(i)}
                  >
                    {label}
                  </Button>
                )}
              </React.Fragment>
            )
          })}
        </div>
      )
    }

    const renderBody = (): React.ReactNode => {
      if (level.kind === 'root') {
        return (
          <>
            <div className="px-3 pb-1.5 pt-2.5 text-sm font-medium uppercase tracking-wider text-muted-foreground/70">
              {t('atMention.header')}
            </div>
            <div ref={containerRef}>
              {items.map((item, idx) => {
                if (item.kind !== 'category') return null
                const Icon = categoryIcon(item.icon)
                const description =
                  item.target === 'project-files'
                    ? renderHint(rootHints?.projectFiles)
                    : item.target === 'evidence-set-list'
                      ? renderHint(rootHints?.evidenceSet)
                      : renderHint(rootHints?.library)
                return (
                  <RootCategoryRow
                    key={`root-cat:${item.target}`}
                    icon={<Icon className="size-5 text-primary" />}
                    label={tDyn(item.labelKey)}
                    description={description}
                    selected={idx === localIndex}
                    onClick={() => onEnter(item)}
                  />
                )
              })}
            </div>
          </>
        )
      }

      // Zotero 三态占位仅在 library-root 层展示
      if (level.kind === 'library-root') {
        if (!status.zoteroEnabled) {
          return (
            <ZoteroStateCard
              title={t('atMention.zotero.disabled.title')}
              description={t('atMention.zotero.disabled.description')}
            />
          )
        }
        if (!status.zoteroRunning) {
          return (
            <ZoteroStateCard
              title={t('atMention.zotero.notRunning.title')}
              description={t('atMention.zotero.notRunning.description')}
              action={onLaunchZotero ? {
                label: t('atMention.zotero.notRunning.action'),
                onClick: onLaunchZotero,
                icon: <Play className="size-3" />,
              } : undefined}
            />
          )
        }
        if (status.zoteroError) {
          return (
            <ZoteroStateCard
              title={t('atMention.zotero.error.title')}
              description={status.zoteroError}
              tone="error"
            />
          )
        }
      }

      if (items.length === 0) {
        const emptyText =
          level.kind === 'project-files'
            ? t('atMention.empty.files')
            : level.kind === 'evidence-set-list'
              ? t('atMention.empty.evidenceSets')
              : level.kind === 'library-collection' || level.kind === 'library-all-items'
                ? t('atMention.empty.entries')
                : level.kind === 'library-root'
                  ? libraryRootInlineItems ? t('atMention.empty.entries') : t('atMention.empty.categories')
                  : t('atMention.empty.generic')
        return <div className="p-3 text-sm text-muted-foreground">{emptyText}</div>
      }

      return (
        <div ref={containerRef} className="overflow-y-auto max-h-[460px] scrollbar-thin">
          {items.map(renderRow)}
        </div>
      )
    }

    // 证据集列表是叶子层（无下钻），与 library 一样展示搜索框 + 键位提示。
    const isEvidenceSetList = level.kind === 'evidence-set-list'
    const showSearchBar = level.kind.startsWith('library') || isEvidenceSetList
    // 与 banner / ChoiceCardShell 同源：KeyboardHintFooter 用 choice-tokens footerClass。
    // libraryRootInlineItems = true 时根层直出条目（无 collection 层级可下钻），证据集列表同理
    // （叶子层，无文件夹可进）—— 两者都隐藏 → 提示。
    const showEnterFolderHint = !libraryRootInlineItems && !isEvidenceSetList
    // 搜索栏占位文案（query 为空时显示）；按层级取对应 i18n key。
    const searchPlaceholder = isEvidenceSetList
      ? t('atMention.search.evidenceSets')
      : level.kind === 'library-root'
        ? libraryRootInlineItems
          ? t('atMention.search.libraryRootInline')
          : t('atMention.search.libraryRootCollections')
        : level.kind === 'library-all-items'
          ? t('atMention.search.libraryAllItems')
          : t('atMention.search.libraryCollection')
    const footerHints: KeyboardHint[] = showSearchBar
      ? [
          { key: '↑↓', label: t('choiceCard.keyboardHint.navigate') },
          ...(showEnterFolderHint
            ? [{ key: '→', label: t('atMention.hintEnterFolder') }]
            : []),
          { key: '↵', label: t('choiceCard.keyboardHint.confirm') },
          { key: '←', label: t('atMention.hintBack') },
          { key: 'esc', label: t('choiceCard.keyboardHint.dismiss') },
        ]
      : []

    return (
      <div
        className="rounded-xl border bg-popover shadow-xl w-[680px] overflow-hidden"
        // 阻止 popup 内任意 mousedown 触发的"焦点转移到按钮"默认行为：
        // 编辑器一旦失焦，TipTap suggestion plugin 不再接收 keydown，← Esc 等键位失效。
        // 这是 popup 挂在 document.body（脱离编辑器 DOM）的标准修法。
        onMouseDown={(e) => e.preventDefault()}
      >
        {renderBreadcrumb()}
        {showSearchBar && (
          <div className="flex items-center gap-2 border-b bg-muted/20 px-3 py-2 text-sm">
            <Search className="size-3 text-muted-foreground" />
            {/* 用户击键由编辑器（TipTap）捕获，此处仅回显 query 让搜索栏读起来像输入框；
                空 query 时显示占位文案。非真实 input，避免抢焦点破坏面板键位。 */}
            {query ? (
              <span className="truncate text-foreground">{query}</span>
            ) : (
              <span className="truncate text-muted-foreground">{searchPlaceholder}</span>
            )}
            {/* 闪烁文本光标，强化"正在输入"的视觉 */}
            <span className="inline-block h-3.5 w-px animate-pulse bg-foreground/60" aria-hidden />
          </div>
        )}
        {renderBody()}
        {footerHints.length > 0 && <KeyboardHintFooter hints={footerHints} />}
      </div>
    )
  },
)

interface RootCategoryRowProps {
  icon: React.ReactNode
  label: string
  description?: string
  selected: boolean
  onClick: () => void
}

function RootCategoryRow({
  icon,
  label,
  description,
  selected,
  onClick,
}: RootCategoryRowProps): React.ReactElement {
  return (
    <Button
      type="button"
      variant="list"
      size="row"
      className={cn(
        'gap-3 py-3 [&_svg]:size-5',
        selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/40 hover:text-foreground',
      )}
      onClick={onClick}
    >
      <div className="flex size-9 flex-shrink-0 items-center justify-center rounded-md bg-muted/40">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{label}</div>
        {description && (
          <div className="mt-0.5 truncate text-sm text-muted-foreground/70">
            {description}
          </div>
        )}
      </div>
      <ChevronRight className="!size-3.5 flex-shrink-0 text-muted-foreground/50" />
    </Button>
  )
}

interface ZoteroStateCardProps {
  title: string
  description: string
  tone?: 'default' | 'error'
  action?: {
    label: string
    onClick: () => void
    icon?: React.ReactNode
  }
}

function ZoteroStateCard({
  title,
  description,
  tone = 'default',
  action,
}: ZoteroStateCardProps): React.ReactElement {
  return (
    <div className="p-4">
      <div className={cn(
        'rounded-lg px-4 py-3 text-sm',
        tone === 'error'
          ? 'bg-destructive/10 text-destructive'
          : 'bg-muted/40 text-muted-foreground',
      )}>
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-foreground">{title}</div>
            <div className="mt-1 text-xs leading-relaxed opacity-80">{description}</div>
            {action && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-3 h-auto gap-1.5 bg-primary/10 px-2.5 py-1 font-medium text-primary hover:bg-primary/20 [&_svg]:size-3"
                onClick={action.onClick}
              >
                {action.icon}
                {action.label}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
