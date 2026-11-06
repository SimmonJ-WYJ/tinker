/**
 * 对话流引文 Claim → **右侧 WorkspacePanel** PDF 高亮联动 hook（#448 S3）。
 *
 * 与 [[useOpenEvidenceInLibrary]] 同构，但目标是"留在对话流、PDF 在右栏打开"，而非切到库视图：
 *   1. `papers:resolveZoteroKey` 把 §7 引用的 doi/标识 解析成 zoteroKey
 *   2. `zotero:lib:get-attachment-path` 拿到该 paper 的本地 PDF 路径
 *   3. 写右栏溯源 atom（按 path 门控）：一次性滚动信号 + 持续高亮
 *   4. `useOpenInRightPanel({ kind:'file', ext:'pdf' })` 在右栏打开该 PDF
 *
 * 失败路径返回 reason 供调用方按 toast 文案提示；不抛异常（除非 IPC 本身 reject）。
 */
import { useSetAtom } from 'jotai'

import {
  rightPanelEvidenceHighlightAtom,
  rightPanelEvidenceScrollAtom,
} from '@/atoms/notes-atoms.ts'
import { useOpenInRightPanel } from '@/hooks/useOpenInRightPanel.ts'
import type { EvidencePaperIdentifier } from '@/hooks/useOpenEvidenceInLibrary.ts'
import { resolvePaperPdf } from '@/lib/paper-pdf.ts'

export interface OpenEvidenceInRightPanelArgs {
  identifier: EvidencePaperIdentifier
  /** verbatim 引文（PDF 高亮匹配用） */
  quote: string
  /** 在 quoteHighlights 中给本次 trace 一个唯一 key，调用方拼装（如 messageUuid#refN） */
  traceId: string
}

export type OpenEvidenceInRightPanelResult =
  | { ok: true }
  | { ok: false; reason: 'no-identifier' }
  | { ok: false; reason: 'paper-not-found' }
  | { ok: false; reason: 'no-zotero-key'; paperTitle: string | null }
  /** 解析到了 paper（有 zoteroKey）但没有可预览的本地 PDF 附件 */
  | { ok: false; reason: 'no-pdf' }

export function useOpenEvidenceInRightPanel(): (
  args: OpenEvidenceInRightPanelArgs,
) => Promise<OpenEvidenceInRightPanelResult> {
  const openInRightPanel = useOpenInRightPanel()
  const setScroll = useSetAtom(rightPanelEvidenceScrollAtom)
  const setHighlight = useSetAtom(rightPanelEvidenceHighlightAtom)

  return async ({ identifier, quote, traceId }) => {
    const r = await resolvePaperPdf(identifier)
    if (!r.ok) return r

    // 先写 atom（按 path 门控）再开 PDF：同一事件内批处理，PdfEvidenceRenderer 挂载即可读到高亮。
    // size 走 0：PDF renderer 不设 maxSize，size 仅头部徽标用，溯源场景可忽略。
    if (quote.trim().length > 0) {
      setScroll({ path: r.path, quote, traceId })
      setHighlight({ path: r.path, quote, traceId })
    }
    openInRightPanel({ kind: 'file', path: r.path, ext: 'pdf', size: 0 })
    return { ok: true }
  }
}
