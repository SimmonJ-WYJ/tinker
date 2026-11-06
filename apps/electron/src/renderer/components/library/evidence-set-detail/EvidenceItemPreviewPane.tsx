/**
 * EvidenceItemPreviewPane —— 证据集详情右栏的"内嵌来源预览"模式
 *
 * 用于 NotesView 右栏：用户点击 EVIDENCE ITEMS 里的 paper / review 卡片后，
 * 整块详情面板切到本组件，做最小化预览（标题 + 作者 / 副标题 + PDF / HTML 正文）。
 *
 * - paper：委托给共享 PaperPdfReader（同时承担 Library 详情面板的 PDF 子区）。
 * - review：复用 ReviewHtmlRenderer 渲染 bodyPath。
 *
 * 顶栏只剩 ← Back —— PDF 跳出 Library / review 跳右侧面板等逃生口已被 in-place 流取代。
 */
import * as React from 'react'
import { useT } from '@/hooks/useT'
import { formatDateTime } from '@/utils/dayjs'
import { PreviewErrorBoundary } from '@/components/preview/PreviewErrorBoundary'
import { ReviewHtmlRenderer } from '@/components/review-demo/ReviewHtmlRenderer'
import type { Anchor, ConversationEvidenceMember, Paper, Review } from '@asci/shared'
import { parseQaSnapshot, sanitizeText } from '@asci/shared'
import { MessageResponse } from '@/components/ai-elements/message'
import { humanizeMentions } from '@/components/agent/at-mention-parse'
import { PaperPdfReader } from '../PaperPdfReader'

export type PreviewMode =
  | {
      kind: 'paper'
      paper: Paper
      /**
       * 触发本次预览的 EvidenceRef.source.anchor.snapshotText（verbatim 引文）。
       * 透传给 PdfRenderer 做翻页 + 文本高亮 + 滚动到视口；同一 paper 不同 ref 点击时
       * traceId 变化触发新一轮定位。缺省时退化为整文打开（无滚动 / 无高亮）。
       */
      quote?: string
      /** 形如 `evidence-ref:${ref.id}`，给 PdfRenderer 的 pendingScrollNoteId 与 quoteHighlights 用同一个 key */
      traceId?: string
      /** 笔记正文：透传给 PDF 高亮 tooltip，悬停 cite 高亮时浮出。缺省则无 tooltip。 */
      noteContent?: string
    }
  | {
      kind: 'review'
      review: Review
      /**
       * 触发本次预览的 EvidenceRef.source.anchor —— member review 卡片点击时由
       * EvidenceItemsSection 从 detail.refs 中查到首条匹配 ref 后上抛。renderer 会
       * 解码 anchor.locationData 自动滚到并激活对应 EvidenceTraceCard。
       */
      anchor?: Anchor
      /**
       * 选择序号 —— 每次点击同一 review 条目时自增，强制 ReviewHtmlRenderer 重新
       * 激活 + 滚动（anchor 同引用、组件不重挂载时也生效）。
       */
      selectionNonce?: number
    }
  | {
      kind: 'conversation'
      /** 包含 ref + sessionId + sessionTitle 等元信息（v0.2.x 新增） */
      member: ConversationEvidenceMember
    }

interface EvidenceItemPreviewPaneProps {
  mode: PreviewMode
}

export function EvidenceItemPreviewPane({
  mode,
}: EvidenceItemPreviewPaneProps): React.ReactElement {
  const { t } = useT('library')

  const conversationSubtitle = React.useMemo(() => {
    if (mode.kind !== 'conversation') return null
    const loc = mode.member.ref.source.anchor.locationData
    const ts = loc?.kind === 'conversation' ? loc.messageTimestamp : undefined
    if (ts) {
      try {
        return t('notes.view.preview.conversationSubtitle', {
          time: formatDateTime(ts),
        })
      } catch {
        return ts
      }
    }
    return t('notes.view.preview.conversationSubtitleNoTime')
  }, [mode, t])

  const title =
    mode.kind === 'paper'
      ? sanitizeText(mode.paper.title)
      : mode.kind === 'review'
        ? mode.review.title
        : (mode.member.sessionTitle ?? t('notes.view.preview.conversationDeletedSession'))
  const subtitle =
    mode.kind === 'paper'
      ? mode.paper.authors.join(', ')
      : mode.kind === 'review'
        ? (mode.review.topic ?? mode.review.intent)
        : conversationSubtitle

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 标题 + 作者 / 副标题 */}
      <div className="px-3 pt-4 pb-3 space-y-1 border-b border-border/60">
        <h2 className="text-base font-semibold text-foreground leading-snug" title={title}>
          {title}
        </h2>
        {subtitle ? (
          <p className="text-xs text-muted-foreground leading-snug line-clamp-2" title={subtitle}>
            {subtitle}
          </p>
        ) : null}
      </div>

      {/* 正文 —— paper / review / conversation 分支 */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {mode.kind === 'paper' ? (
          // 共享 PaperPdfReader 已承担 PDF 渲染 + 滚动 + 高亮接入。证据集场景把
          // anchor.snapshotText（quote）+ traceId 折成 pendingScroll：组件会把它合并
          // 进 highlights 列表并触发 PdfRenderer 翻页/滚动；点击不同 ref（traceId 变化）
          // 会让 pendingScroll 引用变 → memo 重算 → PdfRenderer 重新定位。
          <PaperPdfReader
            zoteroKey={mode.paper.zoteroKey ?? null}
            enableExpand
            inlineHeight="100%"
            pendingScroll={
              mode.quote && mode.traceId
                ? { id: `evidence:${mode.traceId}`, quote: mode.quote, content: mode.noteContent }
                : null
            }
          />
        ) : mode.kind === 'review' ? (
          <ReviewBody
            review={mode.review}
            anchor={mode.anchor}
            selectionNonce={mode.selectionNonce}
          />
        ) : (
          <ConversationBody member={mode.member} />
        )}
      </div>
    </div>
  )
}

// ===== Review HTML 子区 =====

const REVIEW_MAX_BYTES = 2 * 1024 * 1024

/**
 * 直接用 ReviewHtmlRenderer 渲染综述正文（不复用注册器里的 ReviewHtmlPreviewRenderer，
 * 因为 PreviewRendererProps 受 preview-registry 严格约束，没法塞 initialActiveAnchor）。
 *
 * 读文件走 previewReadText，与 ReviewHtmlPreviewRenderer 行为对齐；reviewId 直接用
 * Review 对象自带的 id，省一次 reviews.resolveByBodyPath 反查。
 */
function ReviewBody({
  review,
  anchor,
  selectionNonce,
}: {
  review: Review
  anchor?: Anchor
  selectionNonce?: number
}): React.ReactElement {
  const { t } = useT('library')
  const [content, setContent] = React.useState<string | null>(null)
  const [truncated, setTruncated] = React.useState(false)
  const path = review.bodyPath

  React.useEffect(() => {
    setContent(null)
    setTruncated(false)
    if (!path) return
    let cancelled = false
    window.electronAPI
      .previewReadText(path, REVIEW_MAX_BYTES)
      .then((res) => {
        if (cancelled) return
        setContent(res.content)
        setTruncated(res.truncated)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        console.error('[evidence-preview review] previewReadText failed:', err)
        setContent('')
      })
    return () => {
      cancelled = true
    }
  }, [path])

  if (!path) {
    return (
      <div className="px-6 py-8 text-xs text-muted-foreground/70">
        {t('notes.view.preview.noReviewBody')}
      </div>
    )
  }
  if (content === null) {
    return (
      <div className="px-6 py-8 text-xs text-muted-foreground">
        {t('detail.pdf.loading')}
      </div>
    )
  }
  return (
    <PreviewErrorBoundary filePath={path}>
      <div
        data-asci-citations-root
        className="h-full overflow-auto prose prose-sm dark:prose-invert max-w-none p-4 scrollbar-thin"
      >
        {truncated && (
          <div className="not-prose px-3 py-1 mb-3 text-sm text-warning bg-warning/10 border border-warning/30 rounded">
            {t('markdown.truncated', { defaultValue: 'Content truncated' })}
          </div>
        )}
        <ReviewHtmlRenderer
          html={content}
          reviewId={review.id}
          initialActiveAnchor={anchor}
          activeAnchorNonce={selectionNonce}
        />
      </div>
    </PreviewErrorBoundary>
  )
}

// ===== Conversation Q&A 子区 =====

/**
 * 渲染 conversation 类证据条目的 snapshotText：拆 `Q: ...\n\nA: ...` 两段分别加卡片。
 *
 * 若 snapshotText 不符合 Q/A 标记（例如老数据），整体作为"片段"渲染。
 * 不去 session JSONL 拉新内容——快照已写死，离线也可读。
 */
function ConversationBody({
  member,
}: {
  member: ConversationEvidenceMember
}): React.ReactElement {
  const { t } = useT('library')
  const snapshot = member.ref.source.anchor.snapshotText
  const parsed = React.useMemo(() => parseQaSnapshot(snapshot), [snapshot])
  return (
    <div className="h-full overflow-auto p-5 space-y-4 scrollbar-thin">
      {member.sessionTitle === null && (
        <div className="px-3 py-2 text-sm text-muted-foreground bg-muted/40 border border-border/60 rounded">
          {t('notes.view.preview.conversationSessionMissing')}
        </div>
      )}
      {parsed.question !== null && (
        <section className="space-y-1.5">
          <h4 className="text-sm font-semibold tracking-wider uppercase text-muted-foreground">
            {t('notes.view.preview.conversationQuestion')}
          </h4>
          <div className="rounded-md border border-border bg-card px-4 py-3 text-sm whitespace-pre-wrap text-foreground">
            {humanizeMentions(parsed.question)}
          </div>
        </section>
      )}
      <section className="space-y-1.5">
        <h4 className="text-sm font-semibold tracking-wider uppercase text-muted-foreground">
          {t('notes.view.preview.conversationAnswer')}
        </h4>
        <div className="rounded-md border border-border bg-card px-4 py-3">
          <MessageResponse>{parsed.answer}</MessageResponse>
        </div>
      </section>
    </div>
  )
}
