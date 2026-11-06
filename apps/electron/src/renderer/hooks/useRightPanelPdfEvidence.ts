/**
 * 右栏 PDF 预览的「对话流引文溯源高亮」接线（#448 S2）。
 *
 * 把 [[rightPanelEvidenceHighlightAtom]]（持续高亮）+ [[rightPanelEvidenceScrollAtom]]
 * （一次性滚动信号）按 **文件 path** 门控后，组装成 PdfRenderer 需要的
 * `quoteHighlights` / `pendingScrollNoteId` / `onScrollComplete`。
 *
 * 与库视图 ItemDetailPanel 的组装逻辑同构，但：
 *   - 门控判据是 path（右栏打开的就是一个具体文件），而非 zoteroKey
 *   - 不合并 paperNotes 高亮（那是库视图的职责，右栏只关心被点击的那条 Claim）
 *
 * 纯逻辑抽成 selectRightPanelPdfEvidence 便于单测；hook 只负责接 atom + 提供清信号回调。
 */
import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import {
  rightPanelEvidenceHighlightAtom,
  rightPanelEvidenceScrollAtom,
} from '@/atoms/notes-atoms.ts'

interface EvidenceSignal {
  path: string
  quote: string
  traceId: string
}

export interface RightPanelPdfEvidence {
  quoteHighlights: ReadonlyArray<{ id: string; quote: string }>
  pendingScrollNoteId: string | null
}

/** 与库视图一致的高亮 id 约定：`evidence:${traceId}` */
function evidenceHighlightId(traceId: string): string {
  return `evidence:${traceId}`
}

/**
 * 按当前预览 path 门控，组装右栏 PDF 的 evidence 高亮 props（纯函数，可单测）。
 * - 持续高亮 highlight：path 匹配且有 quote 时进 quoteHighlights
 * - 一次性滚动 scroll：path 匹配且有 quote 时给出 pendingScrollNoteId，
 *   且其 id 必须同时在 quoteHighlights 里（PdfRenderer 靠 id 反查 quote 来扫页定位）
 */
export function selectRightPanelPdfEvidence(
  path: string,
  highlight: EvidenceSignal | null,
  scroll: EvidenceSignal | null,
): RightPanelPdfEvidence {
  const quoteHighlights: { id: string; quote: string }[] = []

  if (highlight && highlight.path === path && highlight.quote) {
    quoteHighlights.push({ id: evidenceHighlightId(highlight.traceId), quote: highlight.quote })
  }

  let pendingScrollNoteId: string | null = null
  if (scroll && scroll.path === path && scroll.quote) {
    pendingScrollNoteId = evidenceHighlightId(scroll.traceId)
    if (!quoteHighlights.some((h) => h.id === pendingScrollNoteId)) {
      quoteHighlights.push({ id: pendingScrollNoteId, quote: scroll.quote })
    }
  }

  return { quoteHighlights, pendingScrollNoteId }
}

export function useRightPanelPdfEvidence(path: string): {
  quoteHighlights: ReadonlyArray<{ id: string; quote: string }>
  pendingScrollNoteId: string | null
  onScrollComplete: () => void
} {
  const highlight = useAtomValue(rightPanelEvidenceHighlightAtom)
  const [scroll, setScroll] = useAtom(rightPanelEvidenceScrollAtom)

  const { quoteHighlights, pendingScrollNoteId } = React.useMemo(
    () => selectRightPanelPdfEvidence(path, highlight, scroll),
    [path, highlight, scroll],
  )

  // 只清一次性滚动信号，持续高亮（rightPanelEvidenceHighlightAtom）保留，避免高亮闪一下就消失
  const onScrollComplete = React.useCallback(() => {
    setScroll((cur) => (cur && cur.path === path ? null : cur))
  }, [setScroll, path])

  return { quoteHighlights, pendingScrollNoteId, onScrollComplete }
}
