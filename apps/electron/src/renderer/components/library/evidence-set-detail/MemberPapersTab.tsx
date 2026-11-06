/**
 * [mockup] Tab 3:论文成员 - 搜索 + 移除 + 加入更多
 *
 * 移除论文不删除其上的 Note;Note 仍挂在 Paper 上(集合视角中由
 * memberPapersNotesByEvidenceSetIdAtom 透传,移除后自然不再出现在 Tab 2)。
 */
import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Search, Trash2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useT } from '@/hooks/useT'
import type { ObjectId } from '@asci/shared'
import { nowIso } from '@asci/shared'
import {
  evidenceSetByIdAtom,
  sessionEvidenceSetPapersAtom,
  sessionEvidenceSetsAtom,
} from '@/atoms/session-evidence-atoms'
import { AddPapersToSetDialog } from './AddPapersToSetDialog'

interface MemberPapersTabProps {
  evidenceSetId: ObjectId
}

export function MemberPapersTab({
  evidenceSetId,
}: MemberPapersTabProps): React.ReactElement {
  const { t } = useT('library')
  const set = useAtomValue(evidenceSetByIdAtom(evidenceSetId))
  // v0.2 重构后 EvidenceSet 不再带 paperIds；mock 阶段从副车 atom 读，
  // 真实数据接入后改走 IPC evidenceRefs.listByTarget('evidence-set', setId) → ref.source.id
  const [setPapersMap, setSetPapersMap] = useAtom(sessionEvidenceSetPapersAtom)
  const setSets = useSetAtom(sessionEvidenceSetsAtom)
  const paperIds = setPapersMap[evidenceSetId] ?? []
  const [query, setQuery] = React.useState('')
  const [addOpen, setAddOpen] = React.useState(false)
  const [confirmRemove, setConfirmRemove] = React.useState<string | null>(null)

  const filtered = React.useMemo(() => {
    if (!set) return []
    const q = query.trim().toLowerCase()
    if (!q) return paperIds
    return paperIds.filter((id: ObjectId) => id.toLowerCase().includes(q))
  }, [set, paperIds, query])

  const removePaper = (paperId: string): void => {
    setSetPapersMap((prev) => ({
      ...prev,
      [evidenceSetId]: (prev[evidenceSetId] ?? []).filter((p) => p !== paperId),
    }))
    setSets((prev) =>
      prev.map((s) =>
        s.id === evidenceSetId ? { ...s, updatedAt: nowIso() } : s,
      ),
    )
    setConfirmRemove(null)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 pointer-events-none"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('evidenceSetDetail.search.papersPlaceholder')}
            className="w-full pl-7 pr-2.5 py-1.5 text-xs rounded-md border-[0.5px] border-border/60 bg-muted/30 placeholder:text-muted-foreground/60 focus:outline-none focus:bg-background focus:border-border transition-colors"
          />
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="h-3.5 w-3.5" />
          {t('evidenceSetDetail.actions.addMorePapers')}
        </Button>
      </div>

      {!set || paperIds.length === 0 ? (
        <div className="px-4 py-8 text-xs text-muted-foreground/60 text-center">
          {t('evidenceSetDetail.empty.papers')}
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-4 py-8 text-xs text-muted-foreground/60 text-center">
          {t('evidenceSetDetail.empty.searchNoMatch')}
        </div>
      ) : (
        <ul className="space-y-1.5 list-none p-0">
          {filtered.map((paperId) => (
            <li
              key={paperId}
              className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2"
            >
              <span className="text-sm text-foreground truncate flex-1">
                {paperId}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirmRemove(paperId)}
                aria-label={t('evidenceSetDetail.actions.removePaper')}
              >
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <AddPapersToSetDialog
        open={addOpen}
        evidenceSetId={evidenceSetId}
        onOpenChange={setAddOpen}
      />

      <AlertDialog
        open={confirmRemove !== null}
        onOpenChange={(open) => !open && setConfirmRemove(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('evidenceSetDetail.removePaperConfirm.title')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('evidenceSetDetail.removePaperConfirm.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t('evidenceSetDetail.removePaperConfirm.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmRemove && removePaper(confirmRemove)}
            >
              {t('evidenceSetDetail.removePaperConfirm.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
