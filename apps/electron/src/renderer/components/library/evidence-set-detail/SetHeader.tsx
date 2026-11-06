/**
 * EvidenceSetDetailSheet 顶部 Header（#709 容器化）
 *
 * 展示容器名（persisted=1 可 inline rename ✎）+ 临时态徽章 + 容器级 tag chips
 * （增删走 evidenceSets:setTags，增删后 re-fetch 刷新）。
 *
 * tag 是容器组织维度（库列表按 tag 筛选）；用中性 secondary 底色而非状态语义色。
 */
import * as React from 'react'
import { Check, Pencil, Plus, X } from 'lucide-react'
import type { EvidenceSetDetail } from '@asci/shared'
import { Badge } from '@/components/ui/badge.tsx'
import { useT } from '@/hooks/useT'

export interface SetHeaderProps {
  detail: EvidenceSetDetail
  onUpdateDetail: (detail: EvidenceSetDetail) => void
}

export function SetHeader({ detail, onUpdateDetail }: SetHeaderProps): React.ReactElement {
  const { t } = useT('library')
  const { set, tags } = detail
  const title = set.name?.trim() || t('evidenceSetDetail.untitled')

  const [renaming, setRenaming] = React.useState(false)
  const [nameDraft, setNameDraft] = React.useState(title)
  const [addingTag, setAddingTag] = React.useState(false)
  const [tagDraft, setTagDraft] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const refetch = React.useCallback(async (): Promise<void> => {
    const r = await window.electronAPI.evidenceSets.getDetail({ id: set.id })
    if (r) onUpdateDetail(r)
  }, [set.id, onUpdateDetail])

  const commitRename = React.useCallback(async (): Promise<void> => {
    const next = nameDraft.trim()
    setRenaming(false)
    if (!next || next === title || busy) return
    setBusy(true)
    try {
      await window.electronAPI.evidenceSets.rename({ setId: set.id, name: next })
      await refetch()
    } finally {
      setBusy(false)
    }
  }, [nameDraft, title, busy, set.id, refetch])

  const commitTags = React.useCallback(
    async (nextTags: string[]): Promise<void> => {
      if (busy) return
      setBusy(true)
      try {
        await window.electronAPI.evidenceSets.setTags({ setId: set.id, tags: nextTags })
        await refetch()
      } finally {
        setBusy(false)
      }
    },
    [busy, set.id, refetch],
  )

  const addTag = React.useCallback(async (): Promise<void> => {
    const tag = tagDraft.trim()
    setAddingTag(false)
    setTagDraft('')
    if (!tag || tags.includes(tag)) return
    await commitTags([...tags, tag])
  }, [tagDraft, tags, commitTags])

  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        {renaming ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitRename()
              if (e.key === 'Escape') setRenaming(false)
            }}
            className="flex-1 bg-transparent text-lg font-semibold text-foreground leading-tight outline-none border-b border-border"
          />
        ) : (
          <h2 className="text-lg font-semibold text-foreground leading-tight flex items-center gap-1.5">
            {title}
            {set.persisted && (
              <button
                type="button"
                aria-label={t('evidenceSetDetail.actions.edit')}
                title={t('evidenceSetDetail.actions.edit')}
                onClick={() => {
                  setNameDraft(title)
                  setRenaming(true)
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <Pencil className="size-3.5" aria-hidden />
              </button>
            )}
          </h2>
        )}
        {set.persisted === false && (
          <Badge tone="warning" variant="soft" className="shrink-0">
            {t('evidenceSetDetail.persisted.no')}
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs bg-secondary text-secondary-foreground/85"
          >
            {tag}
            <button
              type="button"
              aria-label={t('evidenceSetDetail.members.removeTag')}
              onClick={() => commitTags(tags.filter((x) => x !== tag))}
              className="opacity-50 hover:opacity-100"
            >
              <X className="size-3" aria-hidden />
            </button>
          </span>
        ))}
        {addingTag ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-foreground/30 px-2 py-0.5">
            <input
              autoFocus
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onBlur={addTag}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void addTag()
                if (e.key === 'Escape') {
                  setAddingTag(false)
                  setTagDraft('')
                }
              }}
              className="w-20 bg-transparent text-xs outline-none text-foreground"
            />
            <button type="button" aria-label={t('evidenceSetDetail.members.saveNote')} onClick={addTag}>
              <Check className="size-3 text-muted-foreground" aria-hidden />
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setAddingTag(true)}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-foreground/30 px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-accent"
          >
            <Plus className="size-3" aria-hidden />
            {t('evidenceSetDetail.members.addTag')}
          </button>
        )}
      </div>
    </div>
  )
}
