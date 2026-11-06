/**
 * 当前 Paper 的 Note 列表（C-1 V4/V5 真实数据源，替代 PaperNotesPanel 里的
 * `sessionPaperNotesAtom` mock）。
 *
 * 持有的是 **view 类型** RuntimeNote（quote / content 已从 Note.body 切分出来），
 * 让 UI 组件层无须感知 body 编码细节。Adapter 见 `noteToRuntime()`。
 *
 * - 数据由 usePaperNotes hook 维护（监听 librarySelectedItemKeyAtom 变化触发 IPC 拉取）
 * - 写入也走 hook 暴露的 create / updateBody / softDelete；本文件只持 state
 */

import { atom } from 'jotai'
import type { Note, ObjectId } from '@asci/shared'

import type { RuntimeNote } from '@/components/library/PaperNotesPanel'

/** 当前 Paper 的 Note 列表（按 createdAt DESC，与后端 query 顺序一致） */
export const paperNotesAtom = atom<RuntimeNote[]>([])

/** 拉取中标志（首次切换 paper 时给 UI 一个 loading 信号；当前未在面板上展示，留作扩展） */
export const paperNotesLoadingAtom = atom<boolean>(false)

/**
 * 跨视图跳转信号：Library CITED BY 行点击 → 切换到 Evidence Sets（notes）视图，
 * 列表里自动选中指定 evidence_set 对应的笔记条目。
 *
 * 写入流（PaperContainingEvidenceSetsPanel 的 onClick）：
 *   setPendingNotesViewSelection({ evidenceSetId: s.id })
 *   setActiveView('notes')
 *
 * 消费流（NotesView 在拉完 notes 列表后 useEffect 里）：
 *   notes.find(n => n.evidenceSetId === pending.evidenceSetId) → setSelectedId
 *   随后清空 atom 避免再次进入视图时误触发。
 */
export const pendingNotesViewSelectionAtom = atom<{ evidenceSetId: ObjectId } | null>(null)

/**
 * 跨视图 "待滚动到 PDF 高亮处" 信号。
 *
 * NotesView 用户点 "Open paper in library" → 此 atom 写入 { noteId }
 * → ItemDetailPanel 把 noteId 透传给 PdfRenderer
 * → PdfRenderer 扫页找到 quote 所在页 → 切页 → 高亮渲染后把 [data-note-id] span 滚入视口
 * → 滚动成功 / 超时后 PdfRenderer 调 onScrollComplete 把本 atom 清空
 *
 * 设计要点：
 * - 只持 noteId；quote 字符串由 PdfRenderer 从已有的 quoteHighlights 列表里查回
 * - 跨组件用 atom 而非 prop drilling：NotesView 与 PdfRenderer 不直接父子
 * - 单次使用即清空，避免重进 Notes 视图时旧请求误触发
 */
export const pendingQuoteScrollAtom = atom<{ noteId: string } | null>(null)

/**
 * 跨视图 "评论引文 → Library PDF 高亮 + 滚动" 信号。
 *
 * 与 [[pendingQuoteScrollAtom]] 平行，但 quote 文本由综述带过来（不依赖 paperNotes 反查）：
 * - 综述里 <cite> 触发 EvidenceTraceCard.openInLibrary → 写本 atom + setActiveView('library')
 * - ItemDetailPanel 把 quote 合并进 pdfQuoteHighlights，并用 `evidence:${traceId}` 作为
 *   PdfRenderer 的 pendingScrollNoteId，复用现有翻页 + 高亮 + 滚动机制
 * - 滚动成功 / 超时（PdfRenderer onScrollComplete）→ 清本 atom
 *
 * traceId 仅用于在 quoteHighlights 列表里给 evidence 临时项一个唯一 key，
 * 由调用方生成（综述里的 sectionId + paragraphIndex + citeIndex 拼接即可，无需 ObjectId）。
 */
export const pendingEvidenceScrollAtom = atom<{
  quote: string
  traceId: string
} | null>(null)

/**
 * 综述引文 → Library PDF 的 **持续高亮** 状态（与 pendingEvidenceScrollAtom 分离）。
 *
 * 为什么拆两个 atom：
 *   pendingEvidenceScrollAtom 是一次性"信号"，PdfRenderer 滚到目标后 onScrollComplete
 *   就清空，否则下次重进会反复触发跳转。但若把高亮也绑这个 atom，atom 清空 →
 *   pdfQuoteHighlights memo 重算丢掉这条 → textLayer 重渲染丢高亮 →
 *   表现为"黄色闪一下就消失"。
 *
 *   因此把"持续高亮"独立成 activeEvidenceHighlightAtom，scroll 完成不动它；
 *   绑定 `paperKey`（zoteroKey），当 ItemDetailPanel 选中其它 paper 时通过比对
 *   `paperKey !== selectedKey` 自然失效，**无需清空 effect**。下次新的 evidence
 *   点击直接覆盖；同 paper 内不同引用点击也覆盖。
 */
export const activeEvidenceHighlightAtom = atom<{
  quote: string
  traceId: string
  /** 该高亮所属的 zoteroKey；与 ItemDetailPanel 当前 selectedKey 比对，不匹配则不渲染 */
  paperKey: string
} | null>(null)

/**
 * 对话流引文 → **右侧 WorkspacePanel** PDF 预览的溯源高亮（#448）。
 *
 * 与 [[pendingEvidenceScrollAtom]] / [[activeEvidenceHighlightAtom]] 的关系：
 *   那一对服务"综述 → 切到 Library 视图"；本对服务"对话流 Claim → 留在对话、PDF 在右栏打开"。
 *   **故意分开**：右栏与库视图同时可见时，避免共用一个 atom 互相串台（库视图按 zoteroKey 门控，
 *   右栏按 **文件 path** 门控——右栏打开的就是一个具体 PDF 文件，path 是最直接的归属判据）。
 *
 * 同样拆"一次性滚动信号"与"持续高亮"两个 atom，原因同 activeEvidenceHighlightAtom：
 * 若把高亮也绑一次性信号，scroll 完成清空 → 高亮"闪一下就没"。
 */
export const rightPanelEvidenceScrollAtom = atom<{
  /** 目标 PDF 的绝对路径；与右栏当前预览 path 比对，匹配才触发滚动 */
  path: string
  quote: string
  traceId: string
} | null>(null)

export const rightPanelEvidenceHighlightAtom = atom<{
  /** 目标 PDF 的绝对路径；与右栏当前预览 path 比对，不匹配则不渲染（切文件自然失效，无需清空 effect） */
  path: string
  quote: string
  traceId: string
} | null>(null)

/**
 * 把 SQLite Note + 关联 ref 的引文 转成 RuntimeNote。
 *
 * B3 之后：
 *   - quote 不再编码进 Note.body 的 blockquote 前缀
 *   - quote 来自 query 层 JOIN EvidenceRef.anchor.snapshotText 后回传的 `quote` 字段
 *   - Note.body 即用户备注全文（纯文本 / Markdown）
 *
 * 兼容老数据（dev DB 中可能仍有形如 `> quote\n\ncontent` 的 body）：
 * 调用方若传入 fallbackQuote，本函数会把 body 首段 `> ` 行剥离后回填内容；
 * 不传 fallbackQuote 时 body 原样保留。
 */
export function noteToRuntime(n: Note, fallbackQuote?: string, page?: number): RuntimeNote {
  return {
    id: n.id,
    quote: fallbackQuote && fallbackQuote.length > 0 ? fallbackQuote : undefined,
    // issue #452：PDF 锚点页码，供 PdfRenderer 文本匹配 miss 时回退翻页（仅 pdf anchor 有值）
    page,
    content: n.body,
    createdAtMsAgo: 0, // 未使用，formatRelativeTime 用 createdAt
    createdAt: Date.parse(n.createdAt),
  }
}

/**
 * 把 RuntimeNote 草稿合成 body。
 *
 * B3 之后：quote 不再写入 body（引文留在 EvidenceRef.anchor，避免双源）。
 * 保留同名函数以减少调用方变更面：现在它就是恒等映射到 content。
 */
export function composeBody(_quote: string | undefined, content: string): string {
  return content
}
