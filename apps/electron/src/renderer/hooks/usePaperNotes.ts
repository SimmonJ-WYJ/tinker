/**
 * 当前 Paper 的 Note 持久化 hook —— C-1 V4/V5
 *
 * 依赖：
 *   - librarySelectedItemKeyAtom（Zotero item key，作为 lazy upsert 的入口）
 *   - libraryItemDetailAtom（ItemDetail，作为懒创建 Paper 的 fallback 元数据）
 *
 * 行为：
 *   - selectedKey 变化时 IPC listByPaper 拉取最新列表 → 写 paperNotesAtom
 *   - createNote(draft): 调 IPC create → 把返回的 Note 拼到列表前
 *   - updateBody(id, body): 调 IPC updateBody → 更新本地对应项
 *   - deleteNote(id): 调 IPC softDelete → 从本地列表移除
 *
 * 错误策略：失败时 console.error；不显示 toast（C-1 不引入新的 UI 反馈层，
 * 后续 C-* 统一接入若有需要）。
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { toast } from 'sonner'

import { useT } from '@/hooks/useT'
import { librarySelectedItemKeyAtom, libraryItemDetailAtom } from '@/atoms/library-atoms'
import { paperNotesAtom, paperNotesLoadingAtom, composeBody, noteToRuntime } from '@/atoms/notes-atoms'
import { currentAgentWorkspaceIdAtom } from '@/atoms/agent-atoms'

import type { Anchor, NotesPaperFallback, ObjectId } from '@asci/shared'
import type { RuntimeNote } from '@/components/library/PaperNotesPanel'
import type { ItemDetail } from '@asci/core/zotero'

export interface CreateNoteDraft {
  content: string
  quote?: string
  /** 选区所在 PDF 页码(1-based,issue #452);有值时写 pdf anchor,供文本 miss 时回退翻页 */
  pdfPage?: number
}

export interface UsePaperNotes {
  notes: RuntimeNote[]
  setNotes: (updater: (prev: RuntimeNote[]) => RuntimeNote[]) => void
  loading: boolean
  createNote: (draft: CreateNoteDraft) => Promise<RuntimeNote | null>
  updateBody: (id: string, body: string) => Promise<void>
  deleteNote: (id: string) => Promise<void>
}

export function usePaperNotes(): UsePaperNotes {
  const { t } = useT('library')
  const selectedKey = useAtomValue(librarySelectedItemKeyAtom)
  const itemDetail = useAtomValue(libraryItemDetailAtom)
  // issue #457：论文笔记按当前 workspace scope（读取列表 + 新建均带 workspaceId）。
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const [notes, setNotesAtom] = useAtom(paperNotesAtom)
  const setLoading = useSetAtom(paperNotesLoadingAtom)
  const loading = useAtomValue(paperNotesLoadingAtom)

  // 监听 selectedKey / workspace 变化 → 拉取最新列表
  React.useEffect(() => {
    if (!selectedKey || !currentWorkspaceId) {
      setNotesAtom(() => [])
      return
    }
    let cancelled = false
    setLoading(true)
    window.electronAPI.notes
      .listByPaper({ zoteroKey: selectedKey, workspaceId: currentWorkspaceId })
      .then((rows) => {
        if (cancelled) return
        // B3：quote 由 query 层 JOIN ref.anchor.snapshotText 后随 NoteWithQuote 返回；
        // 不再依赖 noteToRuntime 解析 body 中的 `> quote` 前缀。
        setNotesAtom(() => rows.map((r) => noteToRuntime(r.note, r.quote, r.page)))
      })
      .catch((err: unknown) => {
        if (cancelled) return
        console.error('[notes] listByPaper failed:', err)
        setNotesAtom(() => [])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedKey, currentWorkspaceId, setNotesAtom, setLoading])

  const setNotes = React.useCallback(
    (updater: (prev: RuntimeNote[]) => RuntimeNote[]) => setNotesAtom(updater),
    [setNotesAtom],
  )

  const createNote = React.useCallback(
    async (draft: CreateNoteDraft): Promise<RuntimeNote | null> => {
      if (!selectedKey) {
        console.warn('[notes] createNote skipped — no selected paper')
        return null
      }
      if (!currentWorkspaceId) {
        console.warn('[notes] createNote skipped — no active workspace')
        toast.error(t('notes.toast.noWorkspace'))
        return null
      }
      const fallback: NotesPaperFallback = buildFallback(itemDetail)
      const body = composeBody(draft.quote, draft.content)
      // v0.2 重构：note ↔ paper 关系必经 evidence_ref，需要 source anchor。
      // anchor 表"在原文哪里划的"：有划词用 quote，无划词留空（issue #446 —
      // 正文是用户原创，不构成定位锚点，禁止用正文兜底伪造引文）。
      //
      // issue #452：PDF textLayer 划词时捕获了选区所在页码（draft.pdfPage），写成 pdf anchor
      // （type='pdf' + locationData.page）。文本匹配（quote-match）对复杂文本（公式等）会 miss
      // —— DOM 选区 glyph 序列与 textLayer getTextContent 序列本质不一致 —— 此时 PdfRenderer 回退
      // 到 setPageNum(page) 翻到正确页。无页码（摘要正文划词 / 空白笔记）维持 md anchor。
      // 不调 main 的 buildPdfAnchor（renderer 不引主进程模块）：沿用现有"renderer 手搓 anchor 对象"
      // 模式，结构与 anchor-codec.buildPdfAnchor 对齐。
      const snapshotText = (draft.quote ?? '').slice(0, 200)
      const sourceAnchor: Anchor =
        draft.pdfPage !== undefined
          ? {
              type: 'pdf',
              snapshotText,
              locationData: { kind: 'pdf', page: draft.pdfPage },
            }
          : { type: 'md', snapshotText }
      try {
        const { note } = await window.electronAPI.notes.createFromPaperHighlight({
          body,
          paper: { zoteroKey: selectedKey, fallback },
          sourceAnchor,
          workspaceId: currentWorkspaceId,
        })
        // B3：quote 来自 ref.anchor.snapshotText；创建时即用 draft.quote 回填，与下次
        // listByPaper 拉取时的口径一致。issue #452：page 同样乐观回填，避免新建笔记立即点开
        // 详情时缺页码（要等下次 listByPaper 才补）。
        const view = noteToRuntime(note, draft.quote, draft.pdfPage)
        setNotesAtom((prev) => [view, ...prev])
        toast.success(t('notes.toast.created'))
        return view
      } catch (err) {
        console.error('[notes] createFromPaperHighlight failed:', err)
        return null
      }
    },
    [selectedKey, currentWorkspaceId, itemDetail, setNotesAtom, t],
  )

  const updateBody = React.useCallback(
    async (id: string, body: string): Promise<void> => {
      try {
        const updated = await window.electronAPI.notes.updateBody({
          id: id as ObjectId,
          body,
        })
        // B3：quote 由 EvidenceRef 持有，与 Note.body 编辑无关；这里保留原 view 上的 quote。
        // issue #452：page 同理由 anchor 持有，编辑 body 不动它，保留原 view 上的 page。
        setNotesAtom((prev) =>
          prev.map((n) => (n.id === id ? noteToRuntime(updated, n.quote, n.page) : n)),
        )
      } catch (err) {
        console.error('[notes] updateBody failed:', err)
      }
    },
    [setNotesAtom],
  )

  const deleteNote = React.useCallback(
    async (id: string): Promise<void> => {
      try {
        await window.electronAPI.notes.softDelete({ id: id as ObjectId })
        setNotesAtom((prev) => prev.filter((n) => n.id !== id))
      } catch (err) {
        console.error('[notes] softDelete failed:', err)
      }
    },
    [setNotesAtom],
  )

  return { notes, setNotes, loading, createNote, updateBody, deleteNote }
}

function buildFallback(detail: ItemDetail | null): NotesPaperFallback {
  if (!detail) {
    return { title: '(unknown)', authors: [] }
  }
  return {
    title: detail.title,
    authors: detail.creators,
    abstract: detail.abstract,
    year: parseYear(detail.date),
    venue: detail.venue,
    doi: detail.doi,
    url: detail.url,
  }
}

function parseYear(date: string | undefined): number | undefined {
  if (!date) return undefined
  const m = /\b(\d{4})\b/.exec(date)
  return m ? Number(m[1]) : undefined
}
