/**
 * 右栏 PDF 预览的 evidence 包装器（#448 S2）。
 *
 * 注册到 preview-registry 的 'pdf' 槽位（替代裸 PdfRenderer），在通用预览 props 之外，
 * 读 [[useRightPanelPdfEvidence]] 把对话流引文溯源的 quote 高亮 + 待滚动信号注入 PdfRenderer。
 * 不参与溯源的普通 PDF 打开（无 evidence atom 命中）时，注入的高亮为空，行为与裸 PdfRenderer 一致。
 */
import * as React from 'react'
import type { PreviewRendererProps } from '../preview-registry.ts'
import { useRightPanelPdfEvidence } from '@/hooks/useRightPanelPdfEvidence.ts'
import PdfRenderer from './PdfRenderer.tsx'

export default function PdfEvidenceRenderer({
  path,
  size,
  onError,
}: PreviewRendererProps): React.ReactElement {
  const { quoteHighlights, pendingScrollNoteId, onScrollComplete } = useRightPanelPdfEvidence(path)
  return (
    <PdfRenderer
      path={path}
      size={size}
      onError={onError}
      quoteHighlights={quoteHighlights}
      pendingScrollNoteId={pendingScrollNoteId}
      onScrollComplete={onScrollComplete}
    />
  )
}
