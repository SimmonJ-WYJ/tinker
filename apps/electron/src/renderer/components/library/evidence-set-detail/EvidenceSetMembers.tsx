/**
 * EvidenceSetMembers —— 主题容器详情的「笔记区 / 证据区」并列版面（#709）
 *
 * 替代退役的 PairedCardsList：笔记与证据是容器的并列 co-member（ADR-007），
 * 各自成区、各带计数 + "+ 补充"入口、各自增删互不影响。
 *
 * 由 EvidenceSetDetailSheet 与 NotesView 右详情共用（同一版面，避免两套渲染）。
 *
 * 数据：detail.notes（M:N join）+ detail.refs（证据条目，含 quote + 溯源 anchor）。
 * 变更（补笔记 / 删笔记 / 移除证据）走新 IPC，成功后 re-fetch getDetail 刷新 —— 保证
 * 与主进程持久态一致，不做易错的乐观拼装。
 *
 * 删除语义（EN4）：笔记 = 软删（可恢复）；证据 = 从本集移除（来源对象留库）。
 */
import * as React from 'react'
import { useAtomValue } from 'jotai'
import { ExternalLink, FileText, Plus, Quote, Trash2 } from 'lucide-react'
import { useT } from '@/hooks/useT'
import { currentAgentWorkspaceIdAtom } from '@/atoms/agent-atoms'
import type { EvidenceRefWithSource, EvidenceSetDetail, ObjectId, Review } from '@asci/shared'
import { parseQaSnapshot } from '@asci/shared'
import { Button } from '@/components/ui/button'
import { MessageResponse } from '@/components/ai-elements/message'
import { humanizeMentions } from '@/components/agent/at-mention-parse'
import { AddEvidenceDialog, conversationKey } from './AddEvidenceDialog'

export interface EvidenceSetMembersProps {
  detail: EvidenceSetDetail
  onUpdateDetail: (detail: EvidenceSetDetail) => void
  /**
   * 点 paper 类证据卡的「跳到原文」→ 上层打开 PDF 并滚到对应 cite（复刻旧 PairedCardsList 行为）。
   * 不传 = 不显示跳转入口（如 Sheet 抽屉内暂无 PDF 承载时）。
   */
  onSelectPaperRef?: (row: EvidenceRefWithSource) => void
  /** 点 review 类证据卡的「跳到综述」→ 上层打开综述 HTML（review.bodyPath 存在时才显示）。 */
  onSelectReview?: (review: Review) => void
}

export function EvidenceSetMembers({
  detail,
  onUpdateDetail,
  onSelectPaperRef,
  onSelectReview,
}: EvidenceSetMembersProps): React.ReactElement {
  const { t } = useT('library')
  const setId = detail.set.id
  const workspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const [adding, setAdding] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [addEvidenceOpen, setAddEvidenceOpen] = React.useState(false)

  // review 证据卡解析：ref.source.id（review id）→ Review（取标题 + bodyPath 跳转）
  const reviewById = React.useMemo(() => {
    const map = new Map<string, Review>()
    for (const r of detail.memberReviews) map.set(r.id, r)
    return map
  }, [detail.memberReviews])

  // 「补证据」选择器的去重判定：已在本集的论文（按 zoteroKey）/ 综述（按 id）。
  // 取自 detail 派生成员列表，addPaper / addEvidence 幂等键也是这两者，口径一致。
  const addedZoteroKeys = React.useMemo(
    () => new Set(detail.memberPapers.map((p) => p.zoteroKey).filter((k): k is string => !!k)),
    [detail.memberPapers],
  )
  const addedReviewIds = React.useMemo(
    () => new Set(detail.memberReviews.map((r) => r.id)),
    [detail.memberReviews],
  )
  // 对话回合：幂等键 sessionId+messageUuid，从 memberConversations 的 anchor locationData 取
  const addedConversationKeys = React.useMemo(() => {
    const keys = new Set<string>()
    for (const m of detail.memberConversations) {
      const loc = m.ref.source.anchor.locationData
      if (loc?.kind === 'conversation') keys.add(conversationKey(m.sessionId, loc.messageUuid))
    }
    return keys
  }, [detail.memberConversations])

  const refetch = React.useCallback(async (): Promise<void> => {
    const result = await window.electronAPI.evidenceSets.getDetail({ id: setId })
    if (result) onUpdateDetail(result)
  }, [setId, onUpdateDetail])

  const handleAddNote = React.useCallback(async (): Promise<void> => {
    const body = draft.trim()
    if (!body || busy) return
    setBusy(true)
    try {
      await window.electronAPI.evidenceSets.addNote({ setId, body })
      setDraft('')
      setAdding(false)
      await refetch()
    } finally {
      setBusy(false)
    }
  }, [draft, busy, setId, refetch])

  const handleRemoveNote = React.useCallback(
    async (noteId: ObjectId): Promise<void> => {
      if (busy) return
      setBusy(true)
      try {
        await window.electronAPI.evidenceSets.removeNote({ setId, noteId })
        await refetch()
      } finally {
        setBusy(false)
      }
    },
    [busy, setId, refetch],
  )

  const handleRemoveEvidence = React.useCallback(
    async (refId: ObjectId): Promise<void> => {
      if (busy) return
      setBusy(true)
      try {
        await window.electronAPI.evidenceSets.removeEvidence({ setId, refId })
        await refetch()
      } finally {
        setBusy(false)
      }
    },
    [busy, setId, refetch],
  )

  return (
    <div className="space-y-6">
      {/* ── 笔记区 ── */}
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-muted-foreground" aria-hidden />
          <h3 className="text-sm font-medium text-foreground">{t('evidenceSetDetail.members.notesSection')}</h3>
          <span className="text-xs text-muted-foreground">· {detail.notes.length}</span>
          <div className="flex-1" />
          {!adding && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setAdding(true)}>
              <Plus className="size-3.5" aria-hidden />
              {t('evidenceSetDetail.members.addNote')}
            </Button>
          )}
        </div>

        {adding && (
          <div className="rounded-lg border border-dashed border-foreground/25 p-3">
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t('evidenceSetDetail.members.addNotePlaceholder')}
              className="w-full resize-y min-h-[60px] bg-transparent text-sm outline-none text-foreground"
            />
            <div className="flex justify-end gap-2 mt-2">
              <Button variant="ghost" size="sm" onClick={() => { setAdding(false); setDraft('') }}>
                {t('evidenceSetDetail.members.cancel')}
              </Button>
              <Button size="sm" disabled={!draft.trim() || busy} onClick={handleAddNote}>
                {t('evidenceSetDetail.members.saveNote')}
              </Button>
            </div>
          </div>
        )}

        {detail.notes.length === 0 && !adding ? (
          <p className="text-xs text-muted-foreground px-1 py-1">{t('evidenceSetDetail.members.emptyNotes')}</p>
        ) : (
          detail.notes.map((note) => (
            <div key={note.id} className="group relative rounded-lg bg-card shadow-minimal p-3">
              <button
                type="button"
                aria-label={t('evidenceSetDetail.members.deleteNote')}
                title={t('evidenceSetDetail.members.deleteNote')}
                onClick={() => handleRemoveNote(note.id)}
                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity rounded-md p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
              <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap pr-7">
                {note.body}
              </p>
            </div>
          ))
        )}
      </section>

      {/* ── 证据区 ── */}
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <Quote className="size-4 text-muted-foreground" aria-hidden />
          <h3 className="text-sm font-medium text-foreground">{t('evidenceSetDetail.members.evidenceSection')}</h3>
          <span className="text-xs text-muted-foreground">· {detail.refs.length}</span>
          <div className="flex-1" />
          {workspaceId && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setAddEvidenceOpen(true)}>
              <Plus className="size-3.5" aria-hidden />
              {t('evidenceSetDetail.members.addEvidence')}
            </Button>
          )}
        </div>

        {detail.refs.length === 0 ? (
          <p className="text-xs text-muted-foreground px-1 py-1">{t('evidenceSetDetail.members.emptyEvidence')}</p>
        ) : (
          detail.refs.map((row) => {
            const { ref, sourcePaper, quote } = row
            const review = ref.source.kind === 'review' ? reviewById.get(ref.source.id) : undefined
            const isJumpablePaper =
              ref.source.kind === 'paper' &&
              sourcePaper.state === 'present' &&
              onSelectPaperRef != null
            const isJumpableReview = review != null && !!review.bodyPath && onSelectReview != null
            const sourceLabel =
              ref.source.kind === 'paper' && sourcePaper.state === 'present'
                ? sourcePaper.ref.title
                : ref.source.kind === 'review'
                  ? review?.title ?? t('evidenceSetDetail.members.sourceKind.review')
                  : t(`evidenceSetDetail.members.sourceKind.${ref.source.kind}`)
            return (
              <div key={ref.id} className="group relative rounded-lg bg-card shadow-minimal p-3">
                <button
                  type="button"
                  aria-label={t('evidenceSetDetail.members.removeEvidence')}
                  title={t('evidenceSetDetail.members.removeEvidence')}
                  onClick={() => handleRemoveEvidence(ref.id)}
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity rounded-md p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
                {ref.source.kind === 'conversation' ? (
                  <ConversationQuote snapshot={ref.source.anchor.snapshotText} />
                ) : (
                  quote && (
                    <p className="text-sm leading-snug text-foreground/90 border-l-2 border-border pl-2.5 pr-7">
                      {quote}
                    </p>
                  )
                )}
                <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
                  <span className="truncate font-medium text-foreground/70">{sourceLabel}</span>
                  {isJumpablePaper && (
                    <button
                      type="button"
                      onClick={() => onSelectPaperRef?.(row)}
                      className="ml-auto shrink-0 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-foreground/60 hover:text-foreground hover:bg-accent transition-colors"
                    >
                      {t('evidenceSetDetail.members.jumpToPaper')}
                      <ExternalLink className="size-3" aria-hidden />
                    </button>
                  )}
                  {isJumpableReview && review && (
                    <button
                      type="button"
                      onClick={() => onSelectReview?.(review)}
                      className="ml-auto shrink-0 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-foreground/60 hover:text-foreground hover:bg-accent transition-colors"
                    >
                      {t('evidenceSetDetail.members.jumpToReview')}
                      <ExternalLink className="size-3" aria-hidden />
                    </button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </section>

      {workspaceId && (
        <AddEvidenceDialog
          open={addEvidenceOpen}
          onOpenChange={setAddEvidenceOpen}
          setId={setId}
          workspaceId={workspaceId}
          addedZoteroKeys={addedZoteroKeys}
          addedReviewIds={addedReviewIds}
          addedConversationKeys={addedConversationKeys}
          onAdded={() => { void refetch() }}
        />
      )}
    </div>
  )
}

/**
 * conversation 类证据正文：拆 Q/A，问句小字引出、回答按 markdown 渲染（复用 MessageResponse，
 * 支持表格 / 标题 / 代码 / §引用角标等）。回答可能很长 → 套 max-h 滚动，避免撑爆列表卡片。
 */
function ConversationQuote({ snapshot }: { snapshot: string }): React.ReactElement {
  const { question, answer } = React.useMemo(() => parseQaSnapshot(snapshot), [snapshot])
  // 问题段保持纯文本紧凑预览，但把 @提及 token 解码成可读名（@预训练 / @论文标题）
  const readableQuestion = React.useMemo(
    () => (question ? humanizeMentions(question) : null),
    [question],
  )
  return (
    <div className="space-y-2 pr-7">
      {readableQuestion && (
        <p className="text-xs text-muted-foreground leading-snug whitespace-pre-wrap line-clamp-3 border-l-2 border-border pl-2.5">
          {readableQuestion}
        </p>
      )}
      <div className="max-h-72 overflow-auto rounded-md bg-muted/30 px-3 py-2 scrollbar-thin">
        <MessageResponse>{answer}</MessageResponse>
      </div>
    </div>
  )
}
