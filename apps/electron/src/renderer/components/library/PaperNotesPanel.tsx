/**
 * PaperNotesPanel — 论文详情页底部的笔记面板（C-1 V4/V5 P1 协议落地）
 *
 * 交互形态（划词驱动）：
 * 1. 用户在 paper 内容区（标 `[data-note-source]` 的摘要正文 或 PDF `.textLayer`）划词
 * 2. 选区附近浮出「添加笔记」胶囊按钮（portal 渲染到 document.body）
 * 3. 点击 → 弹出输入面板（quote 预览 + textarea + kind 切换 + 保存/取消）
 * 4. 保存 → 通过 usePaperNotes hook 走 IPC 落 SQLite（懒物化 Paper + appendNote）
 * 5. 列表按 createdAt DESC 展示当前 Paper 全部 Note，按 P1 协议追加不覆盖
 *
 * 数据流：
 * - 由 [`paperNotesAtom`](apps/electron/src/renderer/atoms/notes-atoms.ts) 持有 view 列表
 * - 由 [`usePaperNotes`](apps/electron/src/renderer/hooks/usePaperNotes.ts) 监听 selectedKey
 *   变化并触发 IPC listByPaper
 * - quote 通过 Markdown blockquote 段编码到 Note.body，view 层在 noteToRuntime 中切回
 *
 * 设计约束：
 * - 视觉对齐 design-system.md（中性色 + 半透明覆盖 + hairline border）
 * - 状态色仅用 info（蓝）/ destructive（红）/ muted;不引入 success / warning token
 */

import * as React from 'react'
import { createPortal } from 'react-dom'
import { atom, useAtomValue } from 'jotai'
import { HelpCircle } from 'lucide-react'
import { nowMs } from '@asci/shared'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useT } from '@/hooks/useT'
import { paperNotesAtom } from '@/atoms/notes-atoms'
import { usePaperNotes } from '@/hooks/usePaperNotes'
import { useConceptSpotlight } from '@/hooks/useConceptSpotlight'
import { spotlightActiveAtom } from '@/atoms/onboarding-spotlight-atoms'

/**
 * View 层 Note（B4 后单一形态，移除 kind / hypothesisStatus）。
 * `id` 是后端 ObjectId（branded string，运行时即 string）；
 * `createdAtMsAgo` 仅作为类型兼容字段保留，实际渲染统一走 `createdAt`（epoch ms）。
 * `quote` 来自 EvidenceRef.anchor.snapshotText（B3 起；详见 notes-atoms.ts）。
 */
export interface RuntimeNote {
  id: string
  content: string
  quote?: string
  /** PDF 锚点页码(1-based,issue #452);来自 NoteWithQuote.page,供 PdfRenderer 文本 miss 时回退翻页 */
  page?: number
  createdAtMsAgo: number
  createdAt: number
}

/**
 * @deprecated Session-only stub kept for review-demo prototype（P4 评审视图的 AddNoteDialog 仍
 *   写到这里，但该路径未接入 C-1 的 IPC 持久化）。文献库 paper 详情走 `paperNotesAtom`（真实数据，
 *   见 [`notes-atoms`](apps/electron/src/renderer/atoms/notes-atoms.ts)）。
 */
export const sessionPaperNotesAtom = atom<RuntimeNote[]>([])

export interface SelectionAnchor {
  quote: string
  rect: DOMRect
  /** 选区是否落在 PDF "展开态" 浮层内([data-pdf-expanded]);用于切换编辑器为宽尺寸/居中样式 */
  insidePdfExpanded: boolean
  /**
   * 选区所在 PDF 页码(1-based,issue #452);仅 PDF textLayer 划词有值,摘要正文划词为 undefined。
   * 沿 anchor.locationData 落库,文本匹配 miss 时供 PdfRenderer 回退翻页。
   */
  pdfPage?: number
}

/**
 * 监听 window 选区变化,过滤到允许的"笔记原文区域"内的有效选区。
 *
 * 允许区域:
 *   - `[data-note-source]`: 摘要正文(显式标记)
 *   - `.textLayer`: PdfRenderer 的 PDF 文本层
 *
 * 标题/作者/徽章/操作按钮区不在允许区域内,避免选这些非正文内容触发"记笔记"流。
 * 上提到 ItemDetailPanel 顶层调用,与 PaperNotesPanel 是否挂载无关。配合
 * `FloatingNoteButton` + `PendingNoteEditor`(portal 模式)实现"划词建注"流。
 */
export function useDetailSelection(): { anchor: SelectionAnchor | null; clear: () => void } {
  const [anchor, setAnchor] = React.useState<SelectionAnchor | null>(null)

  React.useEffect(() => {
    const evaluateSelection = (): void => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setAnchor(null)
        return
      }
      const text = sel.toString().trim()
      if (!text) {
        setAnchor(null)
        return
      }
      const range = sel.getRangeAt(0)
      const node = range.commonAncestorContainer
      const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
      // 仅在显式标记 [data-note-source] 的区域内才弹浮按钮。
      // 老版本用宽口径 [data-paper-detail-root] 覆盖整个详情主体,会让选标题/作者/徽章
      // 等元信息也触发"记笔记"(语义上不构成笔记原文)。改成白名单:
      //   - PDF textLayer (PdfRenderer 渲染的 .textLayer)
      //   - 摘要正文 div
      // commonAncestorContainer 在跨多 textLayer span 的选区里会上提到整个 textLayer,
      // 命中 .textLayer 即可。
      if (!el || (!el.closest('[data-note-source]') && !el.closest('.textLayer'))) {
        setAnchor(null)
        return
      }
      const insidePdfExpanded = el.closest('[data-pdf-expanded]') !== null
      // 选区落在 PDF textLayer 时,从页 slot 的 [data-page-num] 取页码(issue #452):划词那一刻
      // 渲染端就知道选区在哪一页,捕获下来供 anchor 兜底定位。摘要正文(无 data-page-num)→ undefined。
      const pageNum = Number(el.closest<HTMLElement>('[data-page-num]')?.dataset.pageNum)
      setAnchor({
        quote: text,
        rect: range.getBoundingClientRect(),
        insidePdfExpanded,
        pdfPage: Number.isFinite(pageNum) ? pageNum : undefined,
      })
    }
    // 浮按钮以外的任意 pointerdown / scroll / resize 都视为用户放弃记笔记 → 清 anchor。
    // 仅靠 selectionchange 兜底不住:PDF 缩放按钮 click 不会 collapse 选区(选区还在 textLayer
    // 旧节点上,直到 replaceChildren 同步移除节点 → 那一帧浏览器才补发 selectionchange,期间
    // 浮按钮仍挂在旧 rect 上)。改用"非按钮操作 = 放弃"语义,行为也更接近用户直觉。
    const dismissOnPointerDown = (e: PointerEvent): void => {
      const target = e.target as Element | null
      if (target?.closest('[data-floating-note-button]')) return
      setAnchor(null)
    }
    const dismiss = (): void => setAnchor(null)
    document.addEventListener('selectionchange', evaluateSelection)
    document.addEventListener('pointerdown', dismissOnPointerDown, true)
    document.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => {
      document.removeEventListener('selectionchange', evaluateSelection)
      document.removeEventListener('pointerdown', dismissOnPointerDown, true)
      document.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [])

  const clear = React.useCallback((): void => {
    setAnchor(null)
    window.getSelection()?.removeAllRanges()
  }, [])

  return { anchor, clear }
}

export interface PendingDraft {
  quote: string            // 空串 = 无引用原文(空白笔记)
  rect: DOMRect | null     // null = inline 显示(非选区驱动),由父组件控制位置
  content: string
  /** 选区在 PDF 展开态浮层内:portal 模式渲染为宽尺寸 / 居中 */
  insidePdfExpanded?: boolean
  /** 选区所在 PDF 页码(1-based,issue #452);仅 PDF textLayer 划词有值,随 anchor 落库 */
  pdfPage?: number
}

export interface PaperNotesPanelProps {
  /** 同步当前 pending 的 quote 到父组件(用于摘要原文"编辑期"实时高亮);空 quote / 无 pending 时为 null */
  onPendingQuoteChange?: (quote: string | null) => void
  /** 打开 NoteDetailDialog(由父组件持有,统一从 ItemDetailPanel 渲染),用于点高亮 & 点 NoteCard */
  onOpenNote: (note: RuntimeNote) => void
  /** 划词笔记保存成功后通知父组件(用于自动切到 notes tab) */
  onNoteSaved?: () => void
}

export function PaperNotesPanel({
  onPendingQuoteChange,
  onOpenNote,
  onNoteSaved,
}: PaperNotesPanelProps): React.ReactElement {
  const { t } = useT('library')
  const { t: tOn } = useT('onboarding')
  const notes = useAtomValue(paperNotesAtom)
  const { createNote } = usePaperNotes()
  const { anchor, clear } = useDetailSelection()
  const [pending, setPending] = React.useState<PendingDraft | null>(null)
  // 概念引导 tour（paperNotes）：mount + 空笔记时自动 start；? 按钮重看
  const {
    tourState: paperNotesTourState,
    restart: restartPaperNotesTour,
    start: startPaperNotesTour,
  } = useConceptSpotlight('paperNotes')
  // V2 spotlight 互斥：V2 在跑时不抢占
  const spotlightActive = useAtomValue(spotlightActiveAtom)

  // 数据 settle 后判定一次：列表空 + V2 spotlight 未运行 + tour 未启过 → auto-start
  // 用 ref 守"只 fire 一次"，避免数据后续变化（用户建了笔记）触发回弹。
  // usePaperNotes 的拉取是异步的，用 200ms 延迟等首次 fetch settle，
  // 避免 mount 瞬间 notes=[] 被误当"空"。
  const autoStartedRef = React.useRef(false)
  React.useEffect(() => {
    if (autoStartedRef.current) return
    if (paperNotesTourState != null) return
    if (spotlightActive) return
    if (notes.length > 0) return
    const timer = window.setTimeout(() => {
      if (autoStartedRef.current) return
      if (paperNotesTourState != null) return
      if (spotlightActive) return
      if (notes.length > 0) return
      autoStartedRef.current = true
      void startPaperNotesTour()
    }, 200)
    return () => window.clearTimeout(timer)
  }, [paperNotesTourState, spotlightActive, notes.length, startPaperNotesTour])

  // 同步 pending.quote 到父组件,用于摘要原文实时高亮(编辑期);空 quote / 无 pending 视为 null
  React.useEffect(() => {
    onPendingQuoteChange?.(pending?.quote ? pending.quote : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending])

  const startNote = (): void => {
    if (!anchor) return
    setPending({
      quote: anchor.quote,
      rect: anchor.rect,
      content: '',
      insidePdfExpanded: anchor.insidePdfExpanded,
    })
    clear()
  }

  const cancelPending = (): void => {
    setPending(null)
  }

  const savePending = (): void => {
    if (!pending) return
    const content = pending.content.trim()
    if (!content) return
    // 通过 hook 走 IPC 持久化；本地列表由 hook 内部 setNotesAtom 同步追加
    void createNote({
      content,
      quote: pending.quote || undefined,
    })
    setPending(null)
    onNoteSaved?.()
  }

  // 浮按钮在 pending 存在时隐藏（避免与编辑面板叠加）
  const showFloatingButton = anchor !== null && pending === null

  return (
    <div data-concept-spotlight-target="paper-notes-panel" className="mt-4 pt-4 border-t border-border space-y-3">
      {/* 段标题（C-1 已落真实持久化，移除原型徽标） */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-muted-foreground tracking-wider uppercase">
          {t('notes.heading')}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={tOn('conceptSpotlight.replayTooltip')}
              onClick={() => { void restartPaperNotesTour() }}
              className="ml-auto text-muted-foreground/60 hover:text-foreground transition-colors"
            >
              <HelpCircle className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{tOn('conceptSpotlight.replayTooltip')}</TooltipContent>
        </Tooltip>
      </div>

      {/* 提示行 */}
      <div className="text-sm text-muted-foreground/70 leading-relaxed">
        {t('notes.hint')}
      </div>

      {notes.length === 0 ? (
        <div className="text-xs text-muted-foreground/60">
          {t('notes.list.empty')}
        </div>
      ) : (
        <ul className="space-y-2">
          {notes.map((note) => (
            <li key={note.id}>
              <NoteCard note={note} onOpen={() => onOpenNote(note)} />
            </li>
          ))}
        </ul>
      )}

      {/* NoteDetailDialog 已上提到 ItemDetailPanel 渲染(摘要高亮也要打开同一 dialog) */}

      {/* 浮按钮 — 仅在有效选区且未进入编辑态时显示 */}
      {showFloatingButton && anchor && (
        <FloatingNoteButton rect={anchor.rect} onClick={startNote} label={t('notes.selection.button')} />
      )}

      {/* 编辑面板 */}
      {pending && (
        <PendingNoteEditor
          draft={pending}
          onChange={setPending}
          onSave={savePending}
          onCancel={cancelPending}
        />
      )}
    </div>
  )
}

// ===== 浮按钮（portal） =====

export interface FloatingNoteButtonProps {
  rect: DOMRect
  onClick: () => void
  label: string
}

export function FloatingNoteButton({ rect, onClick, label }: FloatingNoteButtonProps): React.ReactPortal {
  // AppShell 三槽卡片 z-[60],PdfReaderDialog 内容层 z-[100];浮按钮需要更高
  const style: React.CSSProperties = {
    position: 'fixed',
    top: rect.bottom + 6,
    left: rect.left + rect.width / 2,
    transform: 'translateX(-50%)',
    zIndex: 120,
  }
  return createPortal(
    <Button
      type="button"
      // data-floating-note-button:useDetailSelection 的 pointerdown 兜底监听靠它识别,点自己不清 anchor
      data-floating-note-button
      // mousedown 而非 onClick:onClick 触发前浏览器先清掉选区(失去 anchor),来不及读 quote
      onMouseDown={(e) => {
        e.preventDefault()
        onClick()
      }}
      style={style}
      // 浮按钮始终漂浮在白色 PDF 页面之上,主题色 token (foreground) 在 dark 主题下
      // 解析成近白会贴底融化看不见 → 这里固定一对中性黑/灰,palette 例外
      // eslint-disable-next-line asci/no-tailwind-palette -- 浮 pill 需固定深灰,跨主题在白色 PDF 上保证可见
      className="h-auto gap-1 px-2.5 py-1 rounded-full bg-zinc-800 text-zinc-50 text-sm font-medium shadow-lg shadow-black/30 hover:bg-zinc-900 [&_svg]:size-[11px]"
    >
      <PencilIcon />
      {label}
    </Button>,
    document.body
  )
}

function PencilIcon(): React.ReactElement {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

// ===== 编辑面板（portal / inline 双模式） =====

export interface PendingNoteEditorProps {
  draft: PendingDraft
  onChange: (next: PendingDraft) => void
  onSave: () => void
  onCancel: () => void
  /** portal(默认):浮层 portal 到 body,锚定选区下方(划词流);inline:渲染在父容器内,铺满宽度(空白笔记快捷流) */
  mode?: 'portal' | 'inline'
}

export function PendingNoteEditor({ draft, onChange, onSave, onCancel, mode = 'portal' }: PendingNoteEditorProps): React.ReactNode {
  const { t } = useT('library')
  const canSave = draft.content.trim().length > 0
  const portalContainerRef = React.useRef<HTMLDivElement | null>(null)

  // Portal 模式(划词流):点 editor 之外的任何地方都视为取消,避免编辑器与其他
  // dialog / 卡片叠加且无法关闭。inline 模式不挂这个监听 — inline 编辑器是卡片
  // 自然布局的一部分,点周边内容继续浏览很自然,只能通过显式取消按钮关闭。
  //
  // 用 ref 兜住 onCancel 而不放进 useEffect 依赖:onCancel 由父组件每次 render
  // 生成新引用,如果作为依赖会触发监听器拆装,在某些时序下会把"打开本编辑器
  // 的那个 mousedown"也捕到,立刻又把自己关掉。
  const onCancelRef = React.useRef(onCancel)
  React.useEffect(() => { onCancelRef.current = onCancel }, [onCancel])

  React.useEffect(() => {
    if (mode !== 'portal') return
    const handle = (e: MouseEvent): void => {
      const target = e.target as Node | null
      const root = portalContainerRef.current
      if (target && root && !root.contains(target)) {
        onCancelRef.current()
      }
    }
    // setTimeout 0 把监听器挂载推到下一个 tick,确保"打开本编辑器的那次 mousedown"
    // 已经完整冒泡结束,避免本编辑器一打开就被自己关掉
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handle)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handle)
    }
  }, [mode])

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      if (canSave) onSave()
    }
  }

  const wide = draft.insidePdfExpanded === true && mode === 'portal'
  const content = (
    <>
      {/* 原文 quote 预览 — 空白笔记快捷流无 quote,跳过此块 */}
      {draft.quote !== '' && (
        <div
          className={cn(
            'rounded-r-md leading-relaxed text-foreground/70 border-l-2 border-foreground/30 bg-muted/30',
            wide
              ? 'px-4 pt-4 pb-3 mx-4 mt-4 mb-3 text-sm'
              : 'px-3 pt-3 pb-2 mx-3 mt-3 mb-2 text-sm',
          )}
        >
          {truncate(draft.quote, wide ? 360 : 180)}
        </div>
      )}
      {/* 输入 */}
      <textarea
        autoFocus
        value={draft.content}
        onChange={(e) => onChange({ ...draft, content: e.target.value })}
        onKeyDown={handleKey}
        placeholder={t('notes.selection.placeholder')}
        rows={wide ? 5 : 3}
        className={cn(
          'w-full bg-transparent placeholder:text-muted-foreground/60 focus:outline-none resize-y',
          wide ? 'px-4 py-3 text-sm leading-relaxed' : 'px-3 py-2 text-xs leading-relaxed',
        )}
      />
      {/* 操作行 —— 本期不暴露 hypothesis 创建入口，固定 kind='note'；存量 hypothesis 笔记仍按原徽标 / 状态行展示 */}
      <div
        className={cn(
          'flex items-center justify-end gap-1 border-t border-border/60 bg-muted/30',
          wide ? 'px-3 py-2' : 'px-2 py-1.5',
        )}
      >
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancel}
          className={wide ? 'h-8 text-xs px-3' : 'h-7 text-sm px-2'}
        >
          {t('notes.selection.cancel')}
        </Button>
        <Button
          size="sm"
          variant="default"
          disabled={!canSave}
          onClick={onSave}
          className={wide ? 'h-8 text-xs px-4' : 'h-7 text-sm px-3'}
        >
          {t('notes.selection.save')}
        </Button>
      </div>
    </>
  )

  if (mode === 'inline') {
    // 嵌入父容器,铺满宽度;无 backdrop / shadow,与卡片其他段视觉一致
    return (
      <div className="rounded-lg border-[0.5px] border-border bg-card overflow-hidden">
        {content}
      </div>
    )
  }

  // portal 模式:浮层,锚定选区下沿(划词流);rect===null 时退化为居中(兼容性兜底,本流程不走此路径)
  // PDF 展开态浮层内的选区使用更宽的尺寸 + 水平居中(对应屏幕较宽,阅读流不希望编辑器贴在选区窄一列上)
  const isWide = draft.insidePdfExpanded === true
  const width = isWide ? Math.min(720, Math.round(window.innerWidth * 0.6)) : 360
  const margin = 12
  let style: React.CSSProperties
  if (draft.rect === null) {
    style = {
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width,
      zIndex: 130,
    }
  } else if (isWide) {
    // 水平居中于视口;垂直锚定选区下沿,溢出底部时回弹到上沿
    const left = Math.round((window.innerWidth - width) / 2)
    const estimatedHeight = 320
    let top = draft.rect.bottom + 12
    if (top + estimatedHeight > window.innerHeight - margin) {
      top = Math.max(margin, draft.rect.top - estimatedHeight - 12)
    }
    style = {
      position: 'fixed',
      top,
      left,
      width,
      zIndex: 130,
    }
  } else {
    const top = draft.rect.bottom + 8
    let left = draft.rect.left
    if (left + width > window.innerWidth - margin) {
      left = window.innerWidth - width - margin
    }
    if (left < margin) left = margin
    style = {
      position: 'fixed',
      top,
      left,
      width,
      zIndex: 130,
    }
  }

  return createPortal(
    <div
      ref={portalContainerRef}
      style={style}
      className="rounded-lg border-[0.5px] border-border bg-card/95 backdrop-blur-xl shadow-xl shadow-foreground/10 overflow-hidden"
    >
      {content}
    </div>,
    document.body
  )
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max).trimEnd() + '…'
}

// ===== 子组件 =====

interface NoteCardProps {
  note: RuntimeNote
  onOpen: () => void
}

function NoteCard({ note, onOpen }: NoteCardProps): React.ReactElement {
  const { t } = useT('library')
  return (
    <Button
      type="button"
      variant="ghost"
      size="row"
      onClick={onOpen}
      title={t('notes.list.clickHint')}
      className="flex-col items-stretch gap-0 rounded-lg border-[0.5px] border-border bg-card/95 backdrop-blur-xl shadow-sm p-3 space-y-2 hover:bg-accent/40 hover:border-foreground/20 focus:outline-none"
    >
      {/* 时间 */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground tabular-nums">
          {formatRelativeTime(note.createdAt, t)}
        </span>
      </div>
      {/* 原文 quote（如有） */}
      {note.quote && (
        <div className="text-sm leading-relaxed text-foreground/65 border-l-2 border-foreground/25 pl-2">
          {note.quote}
        </div>
      )}
      {/* 正文 */}
      <div className="text-xs leading-relaxed text-foreground/90 whitespace-pre-wrap">
        {note.content}
      </div>
    </Button>
  )
}

export function formatRelativeTime(ts: number, t: ReturnType<typeof useT>['t']): string {
  const diff = Math.max(0, nowMs() - ts)
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return t('notes.time.justNow')
  if (minutes < 60) return t('notes.time.minutesAgo', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('notes.time.hoursAgo', { count: hours })
  const days = Math.floor(hours / 24)
  return t('notes.time.daysAgo', { count: days })
}
