/**
 * paper → 本地可预览 PDF 解析（renderer 侧共享口径）。
 *
 * 两步 IPC：
 *   1. `papers:resolveZoteroKey` 把 doi / paperId / zoteroKey 解析成 zoteroKey
 *   2. `zotero:lib:get-attachment-path` 拿本地附件路径（contentType=application/pdf 才算可预览）
 *
 * 调用方按各自语义映射结果：
 *   - [[useOpenEvidenceInRightPanel]]：失败按 reason toast
 *   - [[useEvidencePdfAvailability]]：仅关心 ok? → enabled / disabled
 */

/** PDF 解析标识：doi / paperId / zoteroKey 三选一可组合，主进程按优先级试 */
export interface PaperPdfIdentifier {
  zoteroKey?: string | null
  doi?: string | null
  paperId?: string | null
}

export type ResolvePaperPdfResult =
  | { ok: true; path: string }
  | { ok: false; reason: 'no-identifier' }
  | { ok: false; reason: 'paper-not-found' }
  | { ok: false; reason: 'no-zotero-key'; paperTitle: string | null }
  /** 解析到 paper（有 zoteroKey）但无可预览的本地 PDF 附件 */
  | { ok: false; reason: 'no-pdf' }

/** 解析一篇 paper 的本地可预览 PDF 路径；不抛异常（除非 IPC 本身 reject） */
export async function resolvePaperPdf(
  identifier: PaperPdfIdentifier,
): Promise<ResolvePaperPdfResult> {
  const r = await window.electronAPI.papers.resolveZoteroKey({
    zoteroKey: identifier.zoteroKey ?? null,
    doi: identifier.doi ?? null,
    paperId: identifier.paperId ?? null,
  })
  if (r.status === 'no-identifier') return { ok: false, reason: 'no-identifier' }
  if (r.status === 'paper-not-found') return { ok: false, reason: 'paper-not-found' }
  if (r.status === 'no-zotero-key') {
    return { ok: false, reason: 'no-zotero-key', paperTitle: r.paperTitle }
  }

  const att = await window.electronAPI.zotero.library.getAttachmentPath({
    itemKey: r.zoteroKey,
  })
  if (!att.found || att.contentType !== 'application/pdf') {
    return { ok: false, reason: 'no-pdf' }
  }
  return { ok: true, path: att.path }
}
