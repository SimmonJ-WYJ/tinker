/**
 * [mockup] Tab 1:集合级笔记 — 搜索 + 列表 + 新建按钮 + 点卡片打开 NoteDetailDialog(edit/delete)
 */
import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Search, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT } from '@/hooks/useT'
import type { ObjectId } from '@asci/shared'
import { nowIso } from '@asci/shared'
import {
  notesByEvidenceSetIdAtom,
  sessionEvidenceSetNotesAtom,
} from '@/atoms/session-evidence-atoms'
import { noteToRuntime } from '@/atoms/notes-atoms'
import { isMac } from '@/lib/shortcut-registry'
import { NoteDetailDialog } from '@/components/library/NoteDetailDialog'
import type { RuntimeNote } from '@/components/library/PaperNotesPanel'
import { CreateSetNoteDialog } from './CreateSetNoteDialog'
import { SetNoteCard } from './SetNoteCard'

interface SetNotesTabProps {
  evidenceSetId: ObjectId
}

export function SetNotesTab({ evidenceSetId }: SetNotesTabProps): React.ReactElement {
  const { t } = useT('library')
  const notes = useAtomValue(notesByEvidenceSetIdAtom(evidenceSetId))
  const setAllNotes = useSetAtom(sessionEvidenceSetNotesAtom)
  const [query, setQuery] = React.useState('')
  const [createOpen, setCreateOpen] = React.useState(false)
  // 用 id 而非整条 note 持有选中态:atom 更新后(edit 后)详情窗能拿到最新 note
  const [openedNoteId, setOpenedNoteId] = React.useState<string | null>(null)
  const openedNote = openedNoteId ? notes.find((n) => n.id === openedNoteId) ?? null : null
  // 必须 memo:noteToRuntime 每次都返回新引用,直接传 prop 会让 NoteDetailDialog 内
  // `useEffect([note])` 在父组件每次 re-render 时把 editing 重置回 false → 用户点了
  // 编辑后任何一次外部 re-render(如 hover、其他 state 变化)都会被踢回预览态。
  const openedRuntimeNote = React.useMemo(
    () => (openedNote ? noteToRuntime(openedNote) : null),
    [openedNote],
  )
  const searchInputRef = React.useRef<HTMLInputElement>(null)

  // 键盘快捷键:Cmd/Ctrl+N 新建集合笔记;Cmd/Ctrl+F 聚焦搜索框。
  // listener 挂在 document 上;SetNotesTab 在切走 tab 时整体 unmount,自动解绑。
  // dialog 打开时(createOpen 或 openedNoteId)让快捷键短路,避免与 dialog 内的输入冲突。
  React.useEffect(() => {
    const handleKeydown = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      // Cmd/Ctrl+N: 新建集合笔记
      if (e.key === 'n' || e.key === 'N') {
        if (createOpen || openedNoteId !== null) return
        e.preventDefault()
        setCreateOpen(true)
        return
      }
      // Cmd/Ctrl+F: 聚焦搜索框 + 全选(便于替换搜索词)
      if (e.key === 'f' || e.key === 'F') {
        if (createOpen || openedNoteId !== null) return
        e.preventDefault()
        const input = searchInputRef.current
        input?.focus()
        input?.select()
      }
    }
    document.addEventListener('keydown', handleKeydown)
    return () => document.removeEventListener('keydown', handleKeydown)
  }, [createOpen, openedNoteId])

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return notes
    return notes.filter((n) => n.body.toLowerCase().includes(q))
  }, [notes, query])

  const handleUpdate = (id: string, patch: Partial<RuntimeNote>): void => {
    setAllNotes((prev) =>
      prev.map((n) => {
        if (n.id !== id) return n
        // 集合级笔记没有 quote(CreateSetNoteDialog 直接写 body=trimmed),所以 body = patch.content
        const nextBody = patch.content !== undefined ? patch.content : n.body
        return {
          ...n,
          body: nextBody,
          updatedAt: nowIso(),
        }
      }),
    )
  }

  const handleDelete = (id: string): void => {
    setAllNotes((prev) => prev.filter((n) => n.id !== id))
    setOpenedNoteId(null)
  }

  return (
    <div className="space-y-3">
      {/* 解释性 hint:第一次进入这个 tab 的用户最容易把"集合笔记"误解成"集合里的论文笔记",
          这行小字把"针对整个集合"和"单篇论文笔记的去处"两个边界一次性说清楚 */}
      <p className="text-sm leading-relaxed text-muted-foreground/70">
        {t('evidenceSetDetail.tabs.setNotesHint')}
      </p>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 pointer-events-none"
          />
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('evidenceSetDetail.search.notesPlaceholder')}
            className="w-full pl-7 pr-2.5 py-1.5 text-xs rounded-md border-[0.5px] border-border/60 bg-muted/30 placeholder:text-muted-foreground/60 focus:outline-none focus:bg-background focus:border-border transition-colors"
          />
        </div>
        <Button
          size="sm"
          onClick={() => setCreateOpen(true)}
          title={t('evidenceSetDetail.actions.newSetNoteTooltip', { shortcut: isMac ? '⌘N' : 'Ctrl+N' })}
        >
          <Plus className="h-3.5 w-3.5" />
          {t('evidenceSetDetail.actions.newSetNote')}
        </Button>
      </div>

      {filtered.length === 0 ? (
        <div className="px-4 py-8 text-xs text-muted-foreground/60 text-center space-y-1">
          <div>
            {notes.length === 0
              ? t('evidenceSetDetail.empty.setNotes')
              : t('evidenceSetDetail.empty.searchNoMatch')}
          </div>
          {notes.length === 0 && (
            <div className="text-muted-foreground/50">
              {t('evidenceSetDetail.empty.setNotesExample')}
            </div>
          )}
        </div>
      ) : (
        <ul className="space-y-2 list-none p-0">
          {filtered.map((n) => (
            <SetNoteCard key={n.id} note={n} onOpen={() => setOpenedNoteId(n.id)} />
          ))}
        </ul>
      )}

      <CreateSetNoteDialog
        open={createOpen}
        evidenceSetId={evidenceSetId}
        onOpenChange={setCreateOpen}
      />

      <NoteDetailDialog
        note={openedRuntimeNote}
        open={openedRuntimeNote !== null}
        onOpenChange={(o) => { if (!o) setOpenedNoteId(null) }}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
      />
    </div>
  )
}
