/** 主题容器的既有对象引用选择器；保留综述与对话，退役 paper 新入库分支。 */
import * as React from 'react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useT } from '@/hooks/useT'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { ArrowLeft, Check, ChevronRight, Eye, MessageSquare, Plus } from 'lucide-react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { Popover, PopoverTrigger } from '@/components/ui/popover'
import { MessageResponse } from '@/components/ai-elements/message'
import { humanizeMentions } from '@/components/agent/at-mention-parse'
import { useFormatRelativeTime } from '@/utils/format-relative-time'
import type {
  AgentSessionMeta,
  ConversationTurnCandidate,
  ObjectId,
  ReviewSummary,
} from '@asci/shared'

type Segment = 'review' | 'conversation'

/** 对话证据「已在本集」判定键：sessionId + messageUuid */
export function conversationKey(sessionId: string, messageUuid: string): string {
  return `${sessionId}::${messageUuid}`
}

export interface AddEvidenceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  setId: ObjectId
  workspaceId: string
  /** 已在本集的论文 zoteroKey 集合（用于行内显示「已添加」并禁止重复点击） */
  addedZoteroKeys: ReadonlySet<string>
  /** 已在本集的综述 id 集合 */
  addedReviewIds: ReadonlySet<string>
  /** 已在本集的对话回合键集合（conversationKey(sessionId, messageUuid)） */
  addedConversationKeys: ReadonlySet<string>
  /** 成功加入后回调（刷新 detail / 列表计数） */
  onAdded: () => void
}

export function AddEvidenceDialog({
  open,
  onOpenChange,
  setId,
  workspaceId,
  addedReviewIds,
  addedConversationKeys,
  onAdded,
}: AddEvidenceDialogProps): React.ReactElement {
  const { t } = useT('library')
  const { t: tCommon } = useT('common')
  const formatRelative = useFormatRelativeTime()
  const [seg, setSeg] = React.useState<Segment>('review')
  const [reviews, setReviews] = React.useState<ReviewSummary[]>([])
  const [query, setQuery] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  // ── 历史对话两级下钻 ──
  const [sessions, setSessions] = React.useState<AgentSessionMeta[]>([])
  const [sessionsLoaded, setSessionsLoaded] = React.useState(false)
  const [selectedSession, setSelectedSession] = React.useState<AgentSessionMeta | null>(null)
  const [turns, setTurns] = React.useState<ConversationTurnCandidate[]>([])
  const [turnsLoading, setTurnsLoading] = React.useState(false)

  // 打开时只拉已有综述候选；对话仍按需读取。
  React.useEffect(() => {
    if (!open) return
    setSeg('review')
    setQuery('')
    setSessions([])
    setSessionsLoaded(false)
    setSelectedSession(null)
    setTurns([])
    let cancelled = false
    void window.electronAPI.reviews
      .list()
      .then((rows) => { if (!cancelled) setReviews(rows) })
      .catch(() => { if (!cancelled) setReviews([]) })
    return () => { cancelled = true }
  }, [open, workspaceId])

  /** 切段：清空搜索 + 回到会话列表层级；首次切到对话段时懒加载本工作区会话 */
  const changeSeg = (s: Segment): void => {
    setSeg(s)
    setQuery('')
    setSelectedSession(null)
    if (s === 'conversation' && !sessionsLoaded) {
      void window.electronAPI
        .listAgentSessions()
        .then((rows) => {
          // 仅本工作区（证据集 scope 到 workspace）；listAgentSessions 已按 updatedAt 倒序
          setSessions(rows.filter((r) => r.workspaceId === workspaceId))
          setSessionsLoaded(true)
        })
        .catch(() => {
          setSessions([])
          setSessionsLoaded(true)
        })
    }
  }

  /** 进入某会话：懒加载其 Q&A 回合候选 */
  const openSession = (session: AgentSessionMeta): void => {
    setSelectedSession(session)
    setQuery('')
    setTurns([])
    setTurnsLoading(true)
    void window.electronAPI.evidenceSets
      .listConversationTurns({ sessionId: session.id })
      .then((rows) => {
        setTurns(rows)
        setTurnsLoading(false)
      })
      .catch(() => {
        setTurns([])
        setTurnsLoading(false)
      })
  }

  const backToSessions = (): void => {
    setSelectedSession(null)
    setQuery('')
    setTurns([])
  }

  const citeReview = async (review: ReviewSummary): Promise<void> => {
    if (busy) return
    if (addedReviewIds.has(review.id)) return
    setBusy(true)
    try {
      // 对象级（C1）：不传 snapshotText → 空引文，卡片只显标题
      await window.electronAPI.evidenceSets.addEvidence({ setId, sourceKind: 'review', sourceId: review.id })
      toast.success(t('evidenceSetDetail.addEvidenceDialog.added'))
      // 不关弹窗：父级 refetch → addedReviewIds 更新 → 该行翻转为「已添加」
      onAdded()
    } catch (err) {
      console.error('[AddEvidenceDialog] addEvidence(review) failed:', err)
      toast.error(t('evidenceSetDetail.addEvidenceDialog.addFailed'))
    } finally {
      setBusy(false)
    }
  }

  const citeTurn = async (sessionId: string, turn: ConversationTurnCandidate): Promise<void> => {
    if (busy) return
    if (addedConversationKeys.has(conversationKey(sessionId, turn.messageUuid))) return
    setBusy(true)
    try {
      // message 级 conversation ref。picker 不判定综述 turn → includeReviewCitations 缺省 false
      const res = await window.electronAPI.evidenceSets.addConversationMessage({
        setId,
        sessionId,
        messageUuid: turn.messageUuid,
        userMessageUuid: turn.userMessageUuid,
        messageTimestamp: turn.messageTimestamp,
        snapshotText: turn.snapshotText,
      })
      toast.success(t(res.created ? 'evidenceSetDetail.addEvidenceDialog.added' : 'evidenceSetDetail.addEvidenceDialog.alreadyIn'))
      onAdded()
    } catch (err) {
      console.error('[AddEvidenceDialog] addConversationMessage failed:', err)
      toast.error(t('evidenceSetDetail.addEvidenceDialog.addFailed'))
    } finally {
      setBusy(false)
    }
  }

  const q = query.trim().toLowerCase()
  const filteredReviews = q ? reviews.filter((r) => r.title.toLowerCase().includes(q)) : reviews
  const filteredSessions = q ? sessions.filter((s) => s.title.toLowerCase().includes(q)) : sessions
  const filteredTurns = q
    ? turns.filter((tn) => `${tn.questionPreview}\n${tn.answerPreview}`.toLowerCase().includes(q))
    : turns

  const searchPlaceholder =
    seg === 'conversation' && selectedSession == null
      ? t('evidenceSetDetail.addEvidenceDialog.searchSessionsPlaceholder')
      : seg === 'conversation'
        ? t('evidenceSetDetail.addEvidenceDialog.searchTurnsPlaceholder')
        : t('evidenceSetDetail.addEvidenceDialog.searchPlaceholder')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('evidenceSetDetail.addEvidenceDialog.title')}</DialogTitle>
          <DialogDescription>{t('evidenceSetDetail.addEvidenceDialog.subtitle')}</DialogDescription>
        </DialogHeader>

        {/* 仅引用已经保存的综述或对话 */}
        <div className="flex gap-1">
          {(['review', 'conversation'] as const).map((s) => {
            const label = t(
              s === 'review'
                ? 'evidenceSetDetail.addEvidenceDialog.segReview'
                : 'evidenceSetDetail.addEvidenceDialog.segConversation',
            )
            return (
              <button
                key={s}
                type="button"
                onClick={() => changeSeg(s)}
                className={cn(
                  'flex-1 h-8 rounded-md border text-xs transition-colors',
                  seg === s
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background text-muted-foreground hover:bg-accent',
                )}
              >
                {label}
              </button>
            )
          })}
        </div>

        {/* 会话内回合层级：返回会话列表 */}
        {seg === 'conversation' && selectedSession != null && (
          <button
            type="button"
            onClick={backToSessions}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors -mb-1"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            <span className="truncate">{selectedSession.title}</span>
          </button>
        )}

        {/* 搜索 */}
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-full px-2.5 py-1.5 text-xs rounded-md border border-border bg-muted/30 focus:outline-none focus:bg-background"
        />

        {/* 候选列表 */}
        <div className="max-h-[46vh] overflow-auto -mx-1 px-1 space-y-1">
          {seg === 'review' ? (
            filteredReviews.length === 0 ? (
              <Empty text={t('evidenceSetDetail.addEvidenceDialog.emptyReviews')} />
            ) : (
              filteredReviews.map((r) => (
                <CandidateRow
                  key={r.id}
                  title={r.title}
                  busy={busy}
                  added={addedReviewIds.has(r.id)}
                  cite={t('evidenceSetDetail.addEvidenceDialog.cite')}
                  inSet={t('evidenceSetDetail.addEvidenceDialog.inSet')}
                  onCite={() => citeReview(r)}
                />
              ))
            )
          ) : selectedSession == null ? (
            // ── 对话 Level 1：会话列表 ──
            !sessionsLoaded ? (
              <Empty text={tCommon('loading')} />
            ) : filteredSessions.length === 0 ? (
              <Empty text={t('evidenceSetDetail.addEvidenceDialog.emptySessions')} />
            ) : (
              filteredSessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => openSession(s)}
                  className="w-full flex items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-accent"
                >
                  <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{s.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatRelative(s.updatedAt)}</span>
                  <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
                </button>
              ))
            )
          ) : (
            // ── 对话 Level 2：所选会话的 Q&A 回合 ──
            turnsLoading ? (
              <Empty text={tCommon('loading')} />
            ) : filteredTurns.length === 0 ? (
              <Empty text={t('evidenceSetDetail.addEvidenceDialog.emptyTurns')} />
            ) : (
              filteredTurns.map((tn) => (
                <CandidateRow
                  key={tn.messageUuid}
                  title={humanizeMentions(tn.questionPreview || tn.answerPreview)}
                  meta={tn.questionPreview ? humanizeMentions(tn.answerPreview) : undefined}
                  multiline
                  busy={busy}
                  added={addedConversationKeys.has(conversationKey(selectedSession.id, tn.messageUuid))}
                  cite={t('evidenceSetDetail.addEvidenceDialog.cite')}
                  inSet={t('evidenceSetDetail.addEvidenceDialog.inSet')}
                  previewMarkdown={humanizeMentions(tn.snapshotText)}
                  viewLabel={t('evidenceSetDetail.addEvidenceDialog.viewConversation')}
                  onCite={() => citeTurn(selectedSession.id, tn)}
                />
              ))
            )
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Empty({ text }: { text: string }): React.ReactElement {
  return <p className="px-2 py-6 text-center text-xs text-muted-foreground">{text}</p>
}

function CandidateRow({
  title,
  meta,
  pdfBadge,
  multiline,
  busy,
  added,
  cite,
  inSet,
  previewMarkdown,
  viewLabel,
  onCite,
}: {
  title: string
  meta?: string
  /** PDF 标记：has=true 已下载 PDF；false 无 */
  pdfBadge?: { label: string; has: boolean }
  /** 标题/副文允许多行（对话回合 Q&A 预览用，不截断为单行） */
  multiline?: boolean
  busy: boolean
  /** 已在本集：行尾显示「已添加」而非「引用」，并禁止点击 */
  added: boolean
  cite: string
  inSet: string
  /** 有值则在行尾加「查看」按钮，点开右侧 popover 用 markdown 展示完整内容（对话回合用） */
  previewMarkdown?: string
  viewLabel?: string
  onCite: () => void
}): React.ReactElement {
  return (
    <div className="flex items-start gap-2 rounded-md px-2 py-2 hover:bg-accent">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              'min-w-0 text-sm font-medium text-foreground leading-snug',
              multiline ? 'line-clamp-2' : 'truncate',
            )}
          >
            {title}
          </span>
          {pdfBadge && (
            <span
              className={cn(
                'shrink-0 rounded px-1.5 py-0.5 text-badge leading-none',
                pdfBadge.has
                  ? 'bg-success/15 text-success'
                  : 'bg-muted text-muted-foreground/70',
              )}
            >
              {pdfBadge.label}
            </span>
          )}
        </div>
        {meta && (
          <div className={cn('text-xs text-muted-foreground mt-0.5', multiline ? 'line-clamp-2' : '')}>
            {meta}
          </div>
        )}
      </div>
      {previewMarkdown != null && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              title={viewLabel}
              aria-label={viewLabel}
              className="shrink-0 inline-flex items-center justify-center rounded-md size-7 text-foreground/50 hover:text-foreground hover:bg-background"
            >
              <Eye className="size-3.5" aria-hidden />
            </button>
          </PopoverTrigger>
          {/*
            不走 Portal：Radix Dialog 用 react-remove-scroll 锁滚动，它按 DOM 归属放行滚轮；
            portal 到 body 的 popover 在滚动 shard 之外 → wheel 被吞。直接渲染在 Dialog 子树内
            （仍 fixed 定位，不被列表 overflow 裁切）即可正常滚动。
          */}
          <PopoverPrimitive.Content
            side="right"
            align="start"
            sideOffset={12}
            collisionPadding={16}
            className={cn(
              'z-[100] w-[440px] max-w-[60vw] rounded-md border bg-popover text-popover-foreground shadow-md outline-none scrollbar-thin',
              'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[side=right]:slide-in-from-left-2',
            )}
            style={{ maxHeight: '70vh', overflowY: 'auto', overscrollBehavior: 'contain' }}
          >
            <div className="p-4">
              <MessageResponse>{previewMarkdown}</MessageResponse>
            </div>
          </PopoverPrimitive.Content>
        </Popover>
      )}
      {added ? (
        <span className="shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-success">
          <Check className="size-3" aria-hidden />
          {inSet}
        </span>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={onCite}
          className="shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-foreground/60 hover:text-foreground hover:bg-background disabled:opacity-50"
        >
          <Plus className="size-3" aria-hidden />
          {cite}
        </button>
      )}
    </div>
  )
}
