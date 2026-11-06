/**
 * [mockup] Tab 2:成员论文笔记 — 透传集合内 paperIds 的所有 Note
 *
 * 按 paper 分组展示集合内每个成员论文的 paper-level Note;
 * 点 "↗ 打开论文" 关闭 Sheet + 切到 library view + 选中目标 paper。
 *
 * HTML 嵌套注意: paper group header 不能用 <button> 外层 + 内嵌 <button>/<span role="button">,
 * 否则 React 会报 "interactive element nested in button" warning。这里外层用
 * <div role="button" tabIndex={0}> 承载折叠点击,内部 "↗ 打开论文" 用同样的
 * <span role="button"> + stopPropagation 来阻止冒泡到折叠。
 */
import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Search, ChevronRight, ChevronDown, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT } from '@/hooks/useT'
import type { ObjectId } from '@asci/shared'
import { memberPapersNotesByEvidenceSetIdAtom } from '@/atoms/session-evidence-atoms'
import { openEvidenceSetIdAtom } from '@/atoms/open-evidence-set-atom'
import { activeViewAtom } from '@/atoms/active-view'
import { librarySelectedItemKeyAtom } from '@/atoms/library-atoms'
import { SetNoteCard } from './SetNoteCard'

interface MemberPapersNotesTabProps {
  evidenceSetId: ObjectId
}

export function MemberPapersNotesTab({
  evidenceSetId,
}: MemberPapersNotesTabProps): React.ReactElement {
  const { t } = useT('library')
  const groups = useAtomValue(memberPapersNotesByEvidenceSetIdAtom(evidenceSetId))
  const setOpenId = useSetAtom(openEvidenceSetIdAtom)
  const setActiveView = useSetAtom(activeViewAtom)
  const setSelectedKey = useSetAtom(librarySelectedItemKeyAtom)
  const [query, setQuery] = React.useState('')
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set())

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return groups
    return groups
      .map((g) => ({
        ...g,
        notes: g.notes.filter((n) => n.body.toLowerCase().includes(q)),
      }))
      .filter((g) => g.notes.length > 0)
  }, [groups, query])

  const totalNotes = groups.reduce((acc, g) => acc + g.notes.length, 0)

  const openPaper = (paperId: string): void => {
    setOpenId(null)
    setActiveView('library')
    setSelectedKey(paperId)
  }

  const toggleGroup = (paperId: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(paperId)) next.delete(paperId)
      else next.add(paperId)
      return next
    })
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search
          size={14}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 pointer-events-none"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('evidenceSetDetail.search.notesPlaceholder')}
          className="w-full pl-7 pr-2.5 py-1.5 text-xs rounded-md border-[0.5px] border-border/60 bg-muted/30 placeholder:text-muted-foreground/60 focus:outline-none focus:bg-background focus:border-border transition-colors"
        />
      </div>

      {totalNotes === 0 ? (
        <div className="px-4 py-8 text-xs text-muted-foreground/60 text-center">
          {t('evidenceSetDetail.empty.memberNotes')}
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-4 py-8 text-xs text-muted-foreground/60 text-center">
          {t('evidenceSetDetail.empty.searchNoMatch')}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((group) => {
            const isCollapsed = collapsed.has(group.paperId)
            return (
              <div
                key={group.paperId}
                className="rounded-md border border-border bg-card"
              >
                <div className="flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors rounded-t-md">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => toggleGroup(group.paperId)}
                    className="h-auto justify-start flex-1 min-w-0 p-0 text-left font-normal hover:bg-transparent rounded [&_svg]:size-3.5"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                    <span className="text-xs font-medium text-foreground truncate flex-1">
                      {group.paperId}
                    </span>
                    <span className="text-sm text-muted-foreground tabular-nums shrink-0">
                      {t('evidenceSetDetail.counts.notes', { count: group.notes.length })}
                    </span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => openPaper(group.paperId)}
                    className="h-auto gap-1 px-1.5 py-0.5 rounded text-sm text-primary hover:bg-primary/10 hover:text-primary shrink-0 [&_svg]:size-3"
                    aria-label={t('evidenceSetDetail.actions.openPaper')}
                  >
                    <ExternalLink className="h-3 w-3" />
                    {t('evidenceSetDetail.actions.openPaper')}
                  </Button>
                </div>
                {!isCollapsed && (
                  <ul className="p-2 space-y-2 border-t border-border list-none">
                    {group.notes.map((n) => (
                      <SetNoteCard key={n.id} note={n} />
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
