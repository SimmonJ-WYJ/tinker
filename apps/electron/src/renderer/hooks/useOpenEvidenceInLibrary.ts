/**
 * 综述引文 → Library PDF 高亮联动 hook
 *
 * 业务流程：
 *   1. 一次 IPC `papers:resolveZoteroKey`：主进程做 SQLite + workspace papers.jsonl
 *      冷热级联，返回 `resolved | no-identifier | paper-not-found | no-zotero-key`
 *   2. resolved 拿到 zoteroKey 后：
 *      - setLibrarySelectedItemKey(zoteroKey) —— 库视图选中条目
 *      - setPendingEvidenceScroll({ quote, traceId }) —— 跨视图信号
 *      - setActiveView('library') —— 切到文献库
 *   3. 其它状态：返回 reason 字符串供调用方按 toast 文案提示
 *
 * 设计要点：
 *   - 解析路径全收口到主进程（详见 workspace-paper-lookup.ts），渲染端只关心结果
 *   - 不缓存：每次 click 都做一次 lookup（频率低，避免缓存失效复杂度）
 *   - "no-zotero-key" 是最常见路径（paper 在 workspace 但用户未 Add to Zotero）
 */
import { useSetAtom } from 'jotai'

import { activeViewAtom } from '@/atoms/active-view'
import { librarySelectedItemKeyAtom } from '@/atoms/library-atoms'
import { activeEvidenceHighlightAtom, pendingEvidenceScrollAtom } from '@/atoms/notes-atoms'

/** §7 reference 携带的 paper 标识（三选一；全空则无法联动） */
export interface EvidencePaperIdentifier {
  zoteroKey?: string | null
  doi?: string | null
  /** 主进程 ObjectId（papers 表主键） */
  paperId?: string | null
}

export interface OpenEvidenceInLibraryArgs {
  identifier: EvidencePaperIdentifier
  /** verbatim 引文（PDF 高亮匹配用） */
  quote: string
  /** 用于在 quoteHighlights 中给本次 trace 一个唯一 key；调用方拼装即可 */
  traceId: string
}

export type OpenEvidenceInLibraryResult =
  | { ok: true }
  | { ok: false; reason: 'no-identifier' }
  | { ok: false; reason: 'paper-not-found' }
  | { ok: false; reason: 'no-zotero-key'; paperTitle: string | null }

/**
 * 返回 async open 函数 —— 调用方在 EvidenceTraceCard.onOpenInLibrary 里调用。
 *
 * 不返回 { canOpen, reason } 的同步预查 —— 因为命中与否需要 IPC，调用方应该按
 * "按钮一直可点 → 点了才显示失败 toast"流程；若已经知道三个标识全空，直接在
 * 调用方层 disable 即可。
 */
export function useOpenEvidenceInLibrary(): (
  args: OpenEvidenceInLibraryArgs,
) => Promise<OpenEvidenceInLibraryResult> {
  const setActiveView = useSetAtom(activeViewAtom)
  const setSelectedLibraryKey = useSetAtom(librarySelectedItemKeyAtom)
  const setPendingEvidenceScroll = useSetAtom(pendingEvidenceScrollAtom)
  const setActiveEvidenceHighlight = useSetAtom(activeEvidenceHighlightAtom)

  return async ({ identifier, quote, traceId }) => {
    const r = await window.electronAPI.papers.resolveZoteroKey({
      zoteroKey: identifier.zoteroKey ?? null,
      doi: identifier.doi ?? null,
      paperId: identifier.paperId ?? null,
    })
    if (r.status === 'resolved') {
      setSelectedLibraryKey(r.zoteroKey)
      if (quote.trim().length > 0) {
        // 信号 atom：一次性，PdfRenderer 滚完即清
        setPendingEvidenceScroll({ quote, traceId })
        // 持续高亮 atom：绑 paperKey；切论文自然失效，下次点击或同 paper 不同引用覆盖
        setActiveEvidenceHighlight({ quote, traceId, paperKey: r.zoteroKey })
      }
      setActiveView('library')
      return { ok: true }
    }
    if (r.status === 'no-identifier') return { ok: false, reason: 'no-identifier' }
    if (r.status === 'paper-not-found') return { ok: false, reason: 'paper-not-found' }
    return { ok: false, reason: 'no-zotero-key', paperTitle: r.paperTitle }
  }
}
