/**
 * [mockup] Session 内存中的 EvidenceSet
 *
 * 演示用 atom — 刷新 / 重启 Electron 会全部丢失。正式对象模型与磁盘存储见
 * ya-docs/milestones/0.2/north-star.md，由 0.2 P0 sprint 落到 packages/shared
 * + apps/electron/src/main/lib/。本文件仅供 demo UX 与收集反馈。
 *
 * 改造记录(2026-05-22, 证据列表数据模型重构 + UI-main 合并):
 * - EvidenceSet 删 paperIds，新增 noteId（1:1 强绑定 note）；mock 侧通过额外的
 *   sessionEvidenceSetPapersAtom（renderer-only 演示用副车 map）保留"set 有哪些 paper"
 *   的视图状态，真实数据要走 IPC evidenceRefs.listBySourcePaper（下个 PR）
 * - Note 删 targetRef；mock 集合级 note 通过 set.noteId 反向解析（1:1）
 * - 旧 description 演示文案已丢弃；hypothesis_status / kind 等 ObjectMeta 仍保留
 * - 各 atomFamily 使用规约：组件 onOpenChange(false) 时调用 .remove(id) 清理
 */
import { atom } from 'jotai'
import { atomFamily, loadable } from 'jotai/utils'
import type { EvidenceSet, EvidenceSetSummary, Note, ObjectId } from '@asci/shared'
import { dayjs } from '@asci/shared'
import { librarySelectedItemKeyAtom } from './library-atoms'
import { currentAgentWorkspaceIdAtom } from './agent-atoms'

const NOW = dayjs()
const dayAgo = (n: number): string => NOW.subtract(n, 'day').toISOString()
const hourAgo = (n: number): string => NOW.subtract(n, 'hour').toISOString()

/**
 * Mock note ids —— 与 mock sets 1:1 绑定。
 * 新模型 evidence_sets.note_id NOT NULL UNIQUE：每个 set 必须挂一个 note 作"动机/标题"。
 */
const MOCK_NOTE_IDS = {
  set1: 'mock-note-set-1' as ObjectId,
  set2: 'mock-note-set-2' as ObjectId,
  set3: 'mock-note-set-3' as ObjectId,
}

/**
 * 演示用 mock 证据集 v3 — 对齐新模型 EvidenceSet（noteId 1:1，无 paperIds）。
 *
 * paper 成员关系：mock 侧由 sessionEvidenceSetPapersAtom 副车存储；真实数据将通过
 * IPC evidenceRefs.listByTarget('evidence-set', setId) → ref.source.id 反查。
 */
const MOCK_EVIDENCE_SETS: EvidenceSet[] = [
  {
    id: 'mock-set-1' as ObjectId,
    noteId: MOCK_NOTE_IDS.set1,
    persisted: true,
    name: 'ERP 与道德决策',
    evidenceRefIds: [],
    savedAt: dayAgo(7),
    createdAt: dayAgo(7),
    updatedAt: dayAgo(7),
    visibility: 'visible',
    workspaceId: 'mock-workspace',
  },
  {
    id: 'mock-set-2' as ObjectId,
    noteId: MOCK_NOTE_IDS.set2,
    persisted: true,
    name: '价值不一致词汇 ERP 文献',
    evidenceRefIds: [],
    savedAt: dayAgo(3),
    createdAt: dayAgo(3),
    updatedAt: dayAgo(3),
    visibility: 'visible',
    workspaceId: 'mock-workspace',
  },
  {
    id: 'mock-set-3' as ObjectId,
    noteId: MOCK_NOTE_IDS.set3,
    persisted: true,
    name: '态度强度调节信息加工',
    evidenceRefIds: [],
    savedAt: hourAgo(12),
    createdAt: hourAgo(12),
    updatedAt: hourAgo(12),
    visibility: 'visible',
    workspaceId: 'mock-workspace',
  },
]

/**
 * Mock 集合 → 成员 paper id 列表（renderer-only 副车）。
 *
 * 新模型 EvidenceSet 已不带 paperIds 字段，paper 关系由 evidence_refs 表达。
 * Mock 这一层仍需要"set 有哪些 paper"的视图状态来支撑演示（addPaper / removePaper
 * UI 交互），故拆为独立 atom；真实数据接入后本 atom 直接退役。
 */
const MOCK_SET_PAPERS: Record<string, ObjectId[]> = {
  'mock-set-1': ['PAPER_ATTITUDE_STRENGTH' as ObjectId],
  'mock-set-2': ['PAPER_ATTITUDE_STRENGTH' as ObjectId, 'PAPER_CPS_BEHAVIORS' as ObjectId],
  'mock-set-3': [],
}

/**
 * 演示用 mock 集合级笔记 —— 与 mock sets 1:1 绑定（新模型 set.note_id 反查）。
 * 不再带 targetRef：notes 表是纯文本对象，所属关系由 evidence_sets.note_id 反向解析。
 */
const MOCK_SET_NOTES: Note[] = [
  {
    id: MOCK_NOTE_IDS.set2,
    body: '价值不一致词激活引发的 N400 强度,可能与态度强度呈正相关。',
    createdAt: dayAgo(2),
    updatedAt: dayAgo(2),
    visibility: 'visible',
  },
  {
    id: MOCK_NOTE_IDS.set1,
    body: '这个集合用来收集 N400 / LPP 与道德判断的关键论文,后续 0.3 综述用。',
    createdAt: dayAgo(1),
    updatedAt: dayAgo(1),
    visibility: 'visible',
  },
]

export const sessionEvidenceSetsAtom = atom<EvidenceSet[]>(MOCK_EVIDENCE_SETS)
export const sessionEvidenceSetNotesAtom = atom<Note[]>(MOCK_SET_NOTES)
export const sessionEvidenceSetPapersAtom = atom<Record<string, ObjectId[]>>(MOCK_SET_PAPERS)

// ===== "包含当前 paper 的 evidence set 列表"（CITED BY 区数据源，真实 IPC） =====
//
// 设计要点：
// 1. 选 paper 变化 → 依赖 librarySelectedItemKeyAtom 自动重新 fetch
// 2. Add to evidence set 成功 → 写一次 refreshPaperContainingSetsAtom 触发重拉
// 3. loadable 包装：消费方拿 { state, data }，避免 <Suspense> 把整个详情面板闪掉

const paperContainingSetsRefreshTickAtom = atom(0)

const paperContainingSetsAsyncAtom = atom<Promise<EvidenceSetSummary[]>>(async (get) => {
  // 订阅刷新信号 —— set tick 时整个 async atom 重新计算
  get(paperContainingSetsRefreshTickAtom)
  const key = get(librarySelectedItemKeyAtom)
  if (!key) return []
  // issue #457：CITED BY 区按当前 workspace scope；无 active workspace 时返回空。
  const workspaceId = get(currentAgentWorkspaceIdAtom)
  if (!workspaceId) return []
  return window.electronAPI.evidenceSets.listByPaper({ zoteroKey: key, workspaceId })
})

/**
 * "包含当前 paper 的 evidence set 列表" —— loadable 包装的异步 atom。
 *
 * 消费形态：`useAtomValue` 返回 `{ state: 'loading' | 'hasData' | 'hasError', data?, error? }`
 * 选 paper 变化时自动重 fetch；要在写操作（addPaper / createWithPaper）成功后强制刷新
 * 需 `useSetAtom(refreshPaperContainingSetsAtom)()`。
 */
export const evidenceSetsContainingCurrentPaperAtom = loadable(paperContainingSetsAsyncAtom)

/** 触发"包含当前 paper 的 evidence set 列表"重新拉取的信号 atom（write-only） */
export const refreshPaperContainingSetsAtom = atom(null, (_get, set) => {
  set(paperContainingSetsRefreshTickAtom, (v) => v + 1)
})

// ===== atomFamily selector(用完调 .remove(id) 清理, 见组件 useEffect cleanup) =====

/** 通过 id 取单个 EvidenceSet; id 为 null 时返回 null（用于 sheet 未打开态） */
export const evidenceSetByIdAtom = atomFamily((id: ObjectId | null) =>
  atom((get) =>
    id ? get(sessionEvidenceSetsAtom).find((s) => s.id === id) ?? null : null,
  ),
)

/**
 * 挂在某个集合上的 Note 列表 —— 新模型 1:1 强绑定，至多一条。
 *
 * 由 set.noteId 反查；保持数组返回签名以减少调用方改动（旧 UI 把它当列表渲染，
 * 新模型下数组长度始终 0 或 1）。
 */
export const notesByEvidenceSetIdAtom = atomFamily((id: ObjectId) =>
  atom((get) => {
    const set = get(evidenceSetByIdAtom(id))
    if (!set) return [] as Note[]
    const allNotes = get(sessionEvidenceSetNotesAtom)
    const bound = allNotes.find((n) => n.id === set.noteId)
    return bound ? [bound] : []
  }),
)

/** 集合内单个成员 paper 的笔记分组（atom selector 出参类型） */
export interface MemberPaperNotesGroup {
  paperId: ObjectId
  notes: Note[]
}

/**
 * 集合内每个成员 paper 的 paper-level Note 列表
 *
 * 当前(mock 阶段)返回每个 paper 的空 notes 数组 —— 真实数据接入待 C-* 路径用
 * IPC `notes.listByPaper(zoteroKey)` 落地后,在此处 hydrate 实际 Note[]。
 *
 * paper 列表来自 sessionEvidenceSetPapersAtom 副车（mock 演示用）。
 */
export const memberPapersNotesByEvidenceSetIdAtom = atomFamily((id: ObjectId) =>
  atom<MemberPaperNotesGroup[]>((get) => {
    const set = get(evidenceSetByIdAtom(id))
    if (!set) return []
    const setPapers = get(sessionEvidenceSetPapersAtom)
    const paperIds = setPapers[set.id] ?? []
    return paperIds.map((paperId) => ({
      paperId,
      notes: [] as Note[],
    }))
  }),
)
